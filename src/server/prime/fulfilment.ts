/**
 * Supplier fulfilment: the leg after the PO, the partner's receiving job (QA at receipt), and the
 * hooks the R1 shop/shipping flows call. Locks: order first, then the job, then the leg (the
 * same order the Shop Console uses), so these never deadlock with shop actions.
 */
import { and, eq } from 'drizzle-orm';
import { actorId, SYSTEM_ACTOR, type Actor } from '../../contracts/common';
import type { InspectionOutcome, SupplierLegStatus } from '../../contracts/enums';
import type { AdvanceSupplierLegRequest, SupplierLegOpsView } from '../../contracts/promise';
import type { ShopJobDetail } from '../../contracts/shop';
import { withTx, type DbOrTx, type Tx } from '../db';
import { approvals, inspectionPlans, manufacturingJobs, orders, productionMilestones, supplierLegs, suppliers } from '../db/schema';
import { buildPacket, loadDispatchContext } from '../dispatch';
import { signPacket } from '../dispatch/packet';
import { emitEvent } from '../events/outbox';
import { ApiError } from '../http';
import { newId } from '../ids';
import { advanceOrder } from '../orders/advance';
import { onOrderDelivered, recheckOrderPromiseSafely } from '../promise/engine';
import { countryName } from '../sourcing/views';
import { assertLegTransition, IllegalLegTransitionError, OPS_LEG_TARGETS, orderStepsForLeg } from './legs';
import { assertShippable, requestBalancePaymentSafely } from './payments';

type LegRow = typeof supplierLegs.$inferSelect;
type OrderRow = typeof orders.$inferSelect;

const conflict = (m: string) => new ApiError('CONFLICT', m);

async function setLegStatus(tx: DbOrTx, leg: LegRow, order: OrderRow, to: SupplierLegStatus, actor: Actor, now: Date, patch: Partial<typeof supplierLegs.$inferInsert> = {}, note: string | null = null): Promise<LegRow> {
    const [updated] = await tx
        .update(supplierLegs)
        .set({ ...patch, status: to, history: [...leg.history, { status: to, at: now.toISOString(), note, actorId: actorId(actor) }], updatedAt: now })
        .where(eq(supplierLegs.id, leg.id))
        .returning();
    await emitEvent(tx, {
        type: 'supplier_leg.status_changed',
        payload: { orderId: order.id, legId: leg.id, from: leg.status, to, note },
        actor,
        correlationId: order.correlationId,
        buildId: order.buildId,
        orderId: order.id,
        timestamp: now,
    });
    return updated;
}

/** A receiving job at the partner: ACCEPTED (receiving partners are pre-assigned), signed packet + inspection plan. */
async function createReceivingJob(tx: Tx, order: OrderRow, leg: LegRow, now: Date): Promise<string> {
    if (!leg.receivingShopId) throw conflict('This leg ships direct; it has no receiving partner');
    const ctx = await loadDispatchContext(tx, order);
    const jobId = newId('job');
    const { packet, checks, sampleSize } = buildPacket(jobId, order, ctx, now);
    const origin = countryName(await supplierCountry(tx, leg));
    const signed = signPacket({
        ...packet,
        qaNotes: [
            `QA at receipt: inspect ${sampleSize} part(s) from the inbound freight against the plan below before anything ships.`,
            'Count the parts against the PO quantity and check the finish and packaging for transit damage.',
            ...packet.qaNotes,
        ],
        receiving: {
            poNumber: leg.poNumber,
            origin,
            inboundCarrier: leg.inboundCarrier,
            inboundTracking: leg.inboundTracking,
            instructions: 'Tap "Mark freight received" when the shipment arrives, inspect it, then ship to the buyer with the normal label flow. A failed inspection opens a rework job and alerts DiscoverMake.',
        },
    });
    await tx.insert(manufacturingJobs).values({
        id: jobId,
        orderId: order.id,
        shopId: leg.receivingShopId,
        buildId: order.buildId,
        partId: ctx.part.id,
        quoteId: ctx.quote.id,
        status: 'ACCEPTED',
        packet: signed,
        packetSignature: signed.signature,
        sourceFileKey: ctx.part.fileKey,
        sourceFileSha256: ctx.part.fileSha256,
        attempt: 1,
        payoutCents: order.shopCostCents,
        offeredAt: now,
        offerExpiresAt: null,
        acceptedAt: now,
    });
    await tx.insert(inspectionPlans).values({ jobId, orderId: order.id, partId: ctx.part.id, checks, sampleSize, rulesetVersion: ctx.quote.rulesetVersion });
    return jobId;
}

async function supplierCountry(tx: DbOrTx, leg: LegRow): Promise<string> {
    const [s] = await tx.select({ country: suppliers.country }).from(suppliers).where(eq(suppliers.id, leg.supplierId));
    return s?.country ?? 'US';
}

/**
 * Ops (Sourcing desk) records supplier-side news on the leg: production started (needs the
 * supplier deposit approved), shipped inbound (tracking; creates the partner's receiving job, or for
 * direct ship records the pre-shipment inspection), delivered (direct ship only).
 */
export async function advanceSupplierLeg(legId: string, req: AdvanceSupplierLegRequest, actor: Actor, opts: { now?: Date } = {}): Promise<SupplierLegOpsView> {
    const now = opts.now ?? new Date();
    if (!OPS_LEG_TARGETS.has(req.to)) throw conflict(`${req.to} is not set from the desk`);
    const result = await withTx(async (tx) => {
        const [peek] = await tx.select({ orderId: supplierLegs.orderId }).from(supplierLegs).where(eq(supplierLegs.id, legId));
        if (!peek) throw new ApiError('NOT_FOUND', 'Supplier leg not found');
        const [order] = await tx.select().from(orders).where(eq(orders.id, peek.orderId)).for('update');
        const [leg] = await tx.select().from(supplierLegs).where(eq(supplierLegs.id, legId)).for('update');
        if (!order || !leg) throw new ApiError('NOT_FOUND', 'Supplier leg not found');
        if (leg.status === req.to) return { order, leg, requestBalance: false };
        try {
            assertLegTransition(leg.status, req.to, { directShip: leg.directShip });
        } catch (err) {
            if (err instanceof IllegalLegTransitionError) throw conflict(`The leg is ${leg.status}; it cannot move to ${req.to}${leg.directShip ? ' (direct ship)' : ''}`);
            throw err;
        }
        const reasonFor = (s: string) => ({ reason: s, data: { legId: leg.id }, at: now });
        let patch: Partial<typeof supplierLegs.$inferInsert> = {};
        let requestBalance = false;
        switch (req.to) {
            case 'IN_PRODUCTION_AT_SUPPLIER': {
                const [deposit] = leg.depositApprovalId ? await tx.select({ status: approvals.status }).from(approvals).where(eq(approvals.id, leg.depositApprovalId)) : [];
                if (deposit?.status !== 'APPROVED') throw conflict('Approve the supplier deposit first: production starts only after a human approved paying it.');
                for (const to of orderStepsForLeg(req.to, leg)) {
                    await advanceOrder(order.id, to, actor, { ...reasonFor('Partner started production'), ...(leg.receivingShopId ? { shopId: leg.receivingShopId } : {}) }, tx);
                }
                patch = { productionStartedAt: now };
                break;
            }
            case 'SHIPPED_INBOUND': {
                if (!req.inboundTracking || !req.inboundCarrier) throw new ApiError('VALIDATION_FAILED', 'Inbound carrier and tracking number are required');
                patch = { inboundCarrier: req.inboundCarrier, inboundTracking: req.inboundTracking, shippedInboundAt: now };
                if (leg.directShip) {
                    if (req.preShipmentInspection !== 'PASS') throw conflict('Direct ship needs a passing pre-shipment inspection recorded first.');
                    patch.preShipmentInspection = 'PASS';
                    for (const to of orderStepsForLeg(req.to, leg)) await advanceOrder(order.id, to, actor, reasonFor('Pre-shipment inspection passed at origin'), tx);
                    requestBalance = true;
                } else {
                    const freshLeg = { ...leg, ...patch } as LegRow;
                    patch.receivingJobId = await createReceivingJob(tx, order, freshLeg, now);
                }
                break;
            }
            case 'DELIVERED': {
                if (order.status !== 'QA_PASSED' && order.status !== 'SHIPPED') throw conflict(`Order is ${order.status}; a direct-ship delivery needs the pre-shipment inspection first`);
                await assertShippable(tx, order.id);
                for (const to of orderStepsForLeg(req.to, leg)) {
                    const [cur] = await tx.select({ status: orders.status }).from(orders).where(eq(orders.id, order.id));
                    if (cur?.status === to) continue;
                    await advanceOrder(order.id, to, actor, reasonFor(to === 'SHIPPED' ? `Shipped direct via ${leg.inboundCarrier ?? 'carrier'}` : 'Delivered (direct ship)'), tx);
                }
                await onOrderDelivered(tx, { orderId: order.id, deliveredAt: now });
                patch = { deliveredAt: now };
                break;
            }
            default:
                throw conflict(`${req.to} is not set from the desk`);
        }
        const updated = await setLegStatus(tx, leg, order, req.to, actor, now, patch, req.note ?? null);
        return { order, leg: updated, requestBalance };
    });
    if (result.requestBalance) await requestBalancePaymentSafely(result.order.id);
    await recheckOrderPromiseSafely(result.order.id);
    const { legOpsView } = await import('./views');
    return legOpsView(result.leg.id);
}

/**
 * The receiving partner marks the inbound freight received (Shop Console). Starts the receiving
 * job (order -> IN_PRODUCTION) with a "Material staged" milestone and moves the leg to
 * RECEIVED_AT_PARTNER, in one transaction. Then the normal QA form applies (QA at receipt).
 */
export async function receiveFreight(shopId: string, jobId: string, input: { note?: string } = {}, opts: { now?: Date } = {}): Promise<ShopJobDetail> {
    const now = opts.now ?? new Date();
    const notFound = () => new ApiError('NOT_FOUND', 'Job not found');
    const orderId = await withTx(async (tx) => {
        const [peek] = await tx.select({ orderId: manufacturingJobs.orderId, shopId: manufacturingJobs.shopId }).from(manufacturingJobs).where(eq(manufacturingJobs.id, jobId));
        if (!peek || peek.shopId !== shopId) throw notFound();
        const [order] = await tx.select().from(orders).where(eq(orders.id, peek.orderId)).for('update');
        const [job] = await tx.select().from(manufacturingJobs).where(eq(manufacturingJobs.id, jobId)).for('update');
        const [leg] = await tx.select().from(supplierLegs).where(and(eq(supplierLegs.orderId, peek.orderId), eq(supplierLegs.receivingJobId, jobId))).for('update');
        if (!order || !job || job.shopId !== shopId) throw notFound();
        if (!leg) throw conflict('This job is not a receiving job');
        if (leg.status === 'RECEIVED_AT_PARTNER' && job.status === 'IN_PRODUCTION') return order.id; // replay
        if (leg.status !== 'SHIPPED_INBOUND') throw conflict(`The freight is ${leg.status.toLowerCase().replace(/_/g, ' ')}; it can be received once it has shipped`);
        if (job.status !== 'ACCEPTED' || order.status !== 'ACCEPTED') throw conflict(`Job is ${job.status} and order is ${order.status}; freight cannot be received now`);
        const actor: Actor = { kind: 'shop', id: shopId };
        const ctx = { actor, correlationId: order.correlationId, buildId: order.buildId, orderId: order.id, timestamp: now };
        await tx.update(manufacturingJobs).set({ status: 'IN_PRODUCTION', startedAt: now, updatedAt: now }).where(eq(manufacturingJobs.id, jobId));
        await advanceOrder(order.id, 'IN_PRODUCTION', actor, { reason: 'Supplier freight received at the partner', data: { jobId, legId: leg.id }, at: now }, tx);
        await emitEvent(tx, { type: 'production.started', payload: { jobId, orderId: order.id, shopId }, ...ctx });
        const note = input.note?.trim() || `Freight for ${leg.poNumber} received`;
        const [m] = await tx
            .insert(productionMilestones)
            .values({ id: newId('milestone'), jobId, orderId: order.id, kind: 'MATERIAL_STAGED', note, actorId: `shop:${shopId}`, occurredAt: now })
            .returning();
        await emitEvent(tx, { type: 'production.milestone', payload: { jobId, orderId: order.id, shopId, milestoneId: m.id, kind: m.kind, note: m.note }, ...ctx });
        await setLegStatus(tx, leg, order, 'RECEIVED_AT_PARTNER', actor, now, { receivedAt: now }, note);
        return order.id;
    });
    await recheckOrderPromiseSafely(orderId);
    const { getJob } = await import('../shops/jobs');
    const detail = await getJob(shopId, jobId);
    if (!detail) throw notFound();
    return detail;
}

/**
 * Hook from submitInspection (inside its transaction, order + job locked): QA at receipt moves the
 * leg (fail -> QA_FAILED; a passing re-inspection -> RECEIVED_AT_PARTNER). Returns whether the
 * order is a supplier-route order (the caller then requests the balance after commit on a pass).
 */
export async function onReceivingInspection(tx: DbOrTx, input: { orderId: string; outcome: InspectionOutcome; actor: Actor; now: Date }): Promise<boolean> {
    const [leg] = await tx.select().from(supplierLegs).where(eq(supplierLegs.orderId, input.orderId)).for('update');
    if (!leg) return false;
    const [order] = await tx.select().from(orders).where(eq(orders.id, input.orderId));
    if (!order) return false;
    if (input.outcome === 'FAIL' && leg.status === 'RECEIVED_AT_PARTNER') {
        await setLegStatus(tx, leg, order, 'QA_FAILED', input.actor, input.now, {}, 'Failed QA at receipt: rework opened');
    } else if (input.outcome === 'PASS' && leg.status === 'QA_FAILED') {
        await setLegStatus(tx, leg, order, 'RECEIVED_AT_PARTNER', input.actor, input.now, {}, 'Passed QA at receipt after rework');
    }
    return true;
}

/** After a receiving inspection commits: ask for the balance on a pass, recheck the promise. */
export async function afterReceivingInspection(orderId: string, outcome: InspectionOutcome): Promise<void> {
    if (outcome === 'PASS') await requestBalancePaymentSafely(orderId);
    await recheckOrderPromiseSafely(orderId);
}

/**
 * Hook from markShipmentDelivered (inside the delivery transaction, after the order is DELIVERED):
 * Delivery Promise outcome (observations, kept/missed, auto-credit) and the leg's DELIVERED.
 */
export async function onOrderDeliveredPrime(tx: DbOrTx, input: { orderId: string; deliveredAt: Date }): Promise<void> {
    await onOrderDelivered(tx, input);
    const [leg] = await tx.select().from(supplierLegs).where(eq(supplierLegs.orderId, input.orderId)).for('update');
    if (!leg || leg.status !== 'RECEIVED_AT_PARTNER') return;
    const [order] = await tx.select().from(orders).where(eq(orders.id, input.orderId));
    if (!order) return;
    await setLegStatus(tx, leg, order, 'DELIVERED', SYSTEM_ACTOR, new Date(), { deliveredAt: input.deliveredAt }, 'Delivered to the buyer');
}
