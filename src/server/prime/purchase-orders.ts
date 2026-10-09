/**
 * Purchase orders at the approval boundary (ADR-0005): no PO, supplier deposit or full package
 * release without a human approval record.
 *
 * - `requestPurchaseOrderApprovals(orderId)`: after the buyer's deposit is in (from the
 *   `order.deposit_paid` outbox event). Creates two PENDING ops approvals on the sourcing job:
 *   PLACE_PURCHASE_ORDER and PAY_DEPOSIT (the supplier deposit). Idempotent.
 * - `applyPurchaseOrderDecision(tx, approval, ...)`: called by `decideApproval` when ops decides one
 *   of them. An APPROVED PLACE_PURCHASE_ORDER creates the supplier fulfilment leg (PO number,
 *   supplier, incoterm) and moves the order PAID -> DISPATCHED; an APPROVED PAY_DEPOSIT posts the
 *   supplier deposit. A rejection alerts ops (refund or re-source).
 *
 * LOCK ORDER (same rule as src/server/sourcing): the sourcing_jobs row first, then the order,
 * then the leg. decideApproval already holds the job lock when it calls in here.
 */
import { and, eq, sql } from 'drizzle-orm';
import { actorId, SYSTEM_ACTOR, type Actor } from '../../contracts/common';
import type { ApprovalKind } from '../../contracts/enums';
import { getDb, withTx, type Tx } from '../db';
import { approvals, orderPaymentPlans, orders, shops, sourcingJobs, supplierLegs, supplierOffers, supplierQuotes, suppliers } from '../db/schema';
import { emitEvent } from '../events/outbox';
import { ApiError } from '../http';
import { randomBase32 } from '../ids';
import { advanceOrder } from '../orders/advance';
import { primePolicy } from './config';
import { postSupplierDeposit } from './ledger';

type ApprovalRow = typeof approvals.$inferSelect;
type OrderRow = typeof orders.$inferSelect;

const usd = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const PO_APPROVAL_KINDS: ReadonlySet<ApprovalKind> = new Set<ApprovalKind>(['PLACE_PURCHASE_ORDER', 'PAY_DEPOSIT']);

/** The order an approval belongs to (PO approvals carry it in details.orderId). */
export function approvalOrderId(approval: Pick<ApprovalRow, 'details'>): string | null {
    const id = approval.details?.orderId;
    return typeof id === 'string' && id.startsWith('ord_') ? id : null;
}

export function newPoNumber(): string {
    return `PO-${randomBase32(8)}`;
}

async function findOrderApproval(tx: Tx, orderId: string, kind: ApprovalKind): Promise<ApprovalRow | null> {
    const [row] = await tx
        .select()
        .from(approvals)
        .where(and(eq(approvals.kind, kind), sql`${approvals.details} ->> 'orderId' = ${orderId}`, sql`${approvals.status} in ('PENDING', 'APPROVED')`))
        .limit(1);
    return row ?? null;
}

/** Request the PO + supplier deposit approvals for a deposit-paid supplier-route order. Idempotent. */
export async function requestPurchaseOrderApprovals(orderId: string, opts: { now?: Date } = {}): Promise<{ poApprovalId: string; depositApprovalId: string } | null> {
    const now = opts.now ?? new Date();
    const db = getDb();
    const [peek] = await db
        .select({ sq: supplierQuotes })
        .from(orders)
        .innerJoin(supplierQuotes, eq(supplierQuotes.quoteId, orders.quoteId))
        .where(eq(orders.id, orderId));
    if (!peek) return null;
    const sq = peek.sq;
    return withTx(async (tx) => {
        // Job row first (LOCK ORDER), then the order.
        const [job] = await tx.select().from(sourcingJobs).where(eq(sourcingJobs.id, sq.jobId)).for('update');
        const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
        if (!job || !order) return null;
        const [plan] = await tx.select().from(orderPaymentPlans).where(eq(orderPaymentPlans.orderId, orderId));
        if (!plan?.depositPaidAt) return null;
        const existingPo = await findOrderApproval(tx, orderId, 'PLACE_PURCHASE_ORDER');
        const existingDeposit = await findOrderApproval(tx, orderId, 'PAY_DEPOSIT');
        if (existingPo && existingDeposit) return { poApprovalId: existingPo.id, depositApprovalId: existingDeposit.id };

        const [offer] = await tx.select().from(supplierOffers).where(eq(supplierOffers.id, sq.offerId));
        const [receiving] = sq.receivingShopId ? await tx.select({ name: shops.name, city: shops.city }).from(shops).where(eq(shops.id, sq.receivingShopId)) : [];
        const c = sq.composition;
        const supplierDepositCents = Math.ceil(c.landed.totalCents * primePolicy().supplierDepositPct);
        const base = { jobId: job.id, buildId: job.buildId, status: 'PENDING' as const, approverRole: 'ops' as const, requestedBy: actorId(SYSTEM_ACTOR), supplierId: sq.supplierId, supplierOfferId: sq.offerId, createdAt: now, updatedAt: now };
        const created: ApprovalRow[] = [];
        const insert = async (values: Pick<typeof approvals.$inferInsert, 'kind' | 'reason' | 'details'>): Promise<ApprovalRow> => {
            const [row] = await tx.insert(approvals).values({ ...base, ...values }).returning();
            created.push(row);
            return row;
        };
        const po =
            existingPo ??
            (await insert({
                kind: 'PLACE_PURCHASE_ORDER',
                reason: `Buyer paid the deposit on ${order.orderNumber}. Place the purchase order for ${offer?.quantity ?? c.quantity} units (landed ${usd(c.landed.totalCents)}, ${offer?.incoterm ?? c.supplierStatus.incoterm}).`,
                details: {
                    orderId,
                    orderNumber: order.orderNumber,
                    quantity: c.quantity,
                    designVersion: c.designVersion,
                    landedCents: c.landed.totalCents,
                    incoterm: c.supplierStatus.incoterm,
                    receivingPartner: receiving ? `${receiving.name}, ${receiving.city}` : 'direct ship',
                    riskTier: c.risk.tier,
                },
            }));
        const deposit =
            existingDeposit ??
            (await insert({
                kind: 'PAY_DEPOSIT',
                reason: `Pay the supplier deposit of ${usd(supplierDepositCents)} for ${order.orderNumber} (${Math.round(primePolicy().supplierDepositPct * 100)}% of the landed cost). Production starts only after this is approved.`,
                details: { orderId, orderNumber: order.orderNumber, amountCents: supplierDepositCents },
            }));
        for (const a of created) {
            await emitEvent(tx, {
                type: 'sourcing.approval_requested',
                payload: { approvalId: a.id, jobId: job.id, buildId: job.buildId, kind: a.kind, approverRole: 'ops' },
                actor: SYSTEM_ACTOR,
                correlationId: job.buildId,
                buildId: job.buildId,
                timestamp: now,
            });
        }
        if (created.length) {
            await emitEvent(tx, {
                type: 'po.approval_requested',
                payload: { orderId, approvalId: po.id, depositApprovalId: deposit.id, offerId: sq.offerId },
                actor: SYSTEM_ACTOR,
                correlationId: order.correlationId,
                buildId: order.buildId,
                orderId,
                timestamp: now,
            });
        }
        return { poApprovalId: po.id, depositApprovalId: deposit.id };
    });
}

async function placePurchaseOrder(tx: Tx, approval: ApprovalRow, order: OrderRow, actor: Actor, now: Date): Promise<void> {
    const [existing] = await tx.select().from(supplierLegs).where(eq(supplierLegs.orderId, order.id));
    if (existing) return;
    if (order.status !== 'PAID') throw new ApiError('CONFLICT', `Order ${order.orderNumber} is ${order.status}; a purchase order is placed only for a paid order`);
    const [sq] = await tx.select().from(supplierQuotes).where(eq(supplierQuotes.quoteId, order.quoteId));
    if (!sq) throw new ApiError('CONFLICT', 'This approval is not for a supplier-route order');
    if (approval.supplierOfferId !== sq.offerId) throw new ApiError('CONFLICT', 'The approval and the order are for different offers');
    const [offer] = await tx.select().from(supplierOffers).where(eq(supplierOffers.id, sq.offerId)).for('update');
    if (!offer || offer.status !== 'SELECTED') throw new ApiError('CONFLICT', 'The selected offer is no longer available; re-source this order or refund it');
    const deposit = await findOrderApproval(tx, order.id, 'PAY_DEPOSIT');
    const poNumber = newPoNumber();
    const [leg] = await tx
        .insert(supplierLegs)
        .values({
            orderId: order.id,
            quoteId: order.quoteId,
            offerId: offer.id,
            jobId: sq.jobId,
            supplierId: sq.supplierId,
            poApprovalId: approval.id,
            depositApprovalId: deposit?.id ?? null,
            supplierDepositCents: typeof deposit?.details?.amountCents === 'number' ? (deposit.details.amountCents as number) : 0,
            poNumber,
            incoterm: offer.incoterm,
            directShip: sq.receivingShopId === null,
            receivingShopId: sq.receivingShopId,
            status: 'PO_PLACED',
            history: [{ status: 'PO_PLACED', at: now.toISOString(), note: `PO ${poNumber} approved`, actorId: actorId(actor) }],
            createdAt: now,
            updatedAt: now,
        })
        .returning();
    await advanceOrder(order.id, 'DISPATCHED', actor, { reason: 'Purchase order placed with a verified partner', data: { legId: leg.id, poNumber }, at: now }, tx);
    await emitEvent(tx, {
        type: 'po.placed',
        payload: { orderId: order.id, legId: leg.id, poNumber, approvalId: approval.id, supplierId: sq.supplierId },
        actor,
        correlationId: order.correlationId,
        buildId: order.buildId,
        orderId: order.id,
        timestamp: now,
    });
    // Production authorization for the supplier route is the human PO approval (spec §12.4).
    await emitEvent(tx, {
        type: 'production.authorized',
        payload: { orderId: order.id, quoteId: order.quoteId, designVersion: sq.composition.designVersion },
        actor,
        correlationId: order.correlationId,
        buildId: order.buildId,
        orderId: order.id,
        timestamp: now,
    });
}

async function approveSupplierDeposit(tx: Tx, approval: ApprovalRow, order: OrderRow, actor: Actor, now: Date): Promise<void> {
    const amount = typeof approval.details?.amountCents === 'number' ? (approval.details.amountCents as number) : 0;
    if (!approval.supplierId) throw new ApiError('CONFLICT', 'A supplier deposit approval needs its supplier');
    await postSupplierDeposit(tx, order, amount, approval.supplierId);
    const [leg] = await tx.select().from(supplierLegs).where(eq(supplierLegs.orderId, order.id)).for('update');
    if (leg && !leg.depositApprovalId) await tx.update(supplierLegs).set({ depositApprovalId: approval.id, supplierDepositCents: amount, updatedAt: now }).where(eq(supplierLegs.id, leg.id));
    await emitEvent(tx, {
        type: 'po.deposit_approved',
        payload: { orderId: order.id, legId: leg?.id ?? null, approvalId: approval.id, amountCents: amount },
        actor,
        correlationId: order.correlationId,
        buildId: order.buildId,
        orderId: order.id,
        timestamp: now,
    });
}

/**
 * Apply a human decision on a PO / supplier-deposit approval inside decideApproval's transaction
 * (the job row is already locked). No-op for approvals that are not tied to an order.
 */
export async function applyPurchaseOrderDecision(tx: Tx, approval: ApprovalRow, decision: 'APPROVED' | 'REJECTED', actor: Actor, now: Date): Promise<void> {
    if (!PO_APPROVAL_KINDS.has(approval.kind)) return;
    const orderId = approvalOrderId(approval);
    if (!orderId) return;
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
    if (!order) throw new ApiError('NOT_FOUND', 'The order for this approval no longer exists');
    if (decision === 'REJECTED') {
        await emitEvent(tx, {
            type: 'ops.alert_requested',
            payload: {
                subject: `${approval.kind === 'PLACE_PURCHASE_ORDER' ? 'Purchase order' : 'Supplier deposit'} rejected for ${order.orderNumber}`,
                message: `The buyer has paid a deposit. Re-source the order or refund it (POST /api/admin/orders/${order.id}/refund).`,
                orderId: order.id,
            },
            actor,
            correlationId: order.correlationId,
            buildId: order.buildId,
            orderId: null,
            timestamp: now,
        });
        return;
    }
    if (approval.kind === 'PLACE_PURCHASE_ORDER') await placePurchaseOrder(tx, approval, order, actor, now);
    else await approveSupplierDeposit(tx, approval, order, actor, now);
}

/** Ops display of the supplier (never buyer-facing). */
export async function supplierSummary(tx: Tx, supplierId: string): Promise<{ id: string; name: string; country: string }> {
    const [s] = await tx.select({ id: suppliers.id, name: suppliers.name, country: suppliers.country }).from(suppliers).where(eq(suppliers.id, supplierId));
    return s ?? { id: supplierId, name: 'Unknown supplier', country: '--' };
}
