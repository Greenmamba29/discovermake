/**
 * Dispatch: match a PAID order to a capable shop and offer the job (workflow 05).
 *
 * OWNER: shop agent. Signatures FINAL.
 *
 * R1 algorithm (see ./match.ts): candidates = ACTIVE shops with a shop_capabilities row
 * for the quote's thickness option + process (and press brake when bending is selected),
 * bed fits the part, excluding shops that already declined/expired this order.
 * Score = rate-card cost + queue days + queue depth + quality (lower wins).
 * Offer window = shop.accept_window_minutes.
 */
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { SYSTEM_ACTOR } from '../../contracts/common';
import type { JobStatus } from '../../contracts/enums';
import { getDb, withTx, type DbOrTx } from '../db';
import { builds, inspectionPlans, manufacturingJobs, materials, orders, parts, processes, quotes, services, thicknessOptions } from '../db/schema';
import { env } from '../env';
import { emitEvent } from '../events/outbox';
import { ApiError } from '../http';
import { newId } from '../ids';
import { notify } from '../notify';
import { advanceOrder } from '../orders';
import { buildInspectionChecks, sampleSizeFor, SERVICE_IDS } from './inspection-plan';
import { findCandidates, type JobRequirements } from './match';
import { packingInstructions, signPacket, type UnsignedPacket } from './packet';

export { buildInspectionChecks, sampleSizeFor, withinTolerance, MEASURED_CHECK_KINDS, SERVICE_IDS } from './inspection-plan';
export { estimateShopCostCents, scoreCandidate, findCandidates, fitsBed, type Candidate, type JobRequirements } from './match';
export { packetForConsole, packetSignature, signPacket, verifyPacket, isPacketUnredacted, PACKET_FILE_URL_TTL_SECONDS, type StoredPacket } from './packet';

export type DispatchResult = { jobId: string; shopId: string; offerExpiresAt: Date };

/** Jobs that mean "this order already has a shop working on / considering it". */
/**
 * Jobs that still own the order (block a new dispatch). Includes QA_FAILED (rework in
 * progress). Shop queue depth in match.ts deliberately counts only workload statuses.
 */
export const OPEN_JOB_STATUSES: readonly JobStatus[] = ['OFFERED', 'ACCEPTED', 'IN_PRODUCTION', 'QA_FAILED', 'QA_PASSED', 'SHIPPED', 'DELIVERED'];

type OrderRow = typeof orders.$inferSelect;

async function loadDispatchContext(tx: DbOrTx, order: OrderRow) {
    const [quote] = await tx.select().from(quotes).where(eq(quotes.id, order.quoteId));
    if (!quote) throw new Error(`Order ${order.id} references missing quote ${order.quoteId}`);
    const [[part], [build], [thickness]] = await Promise.all([
        tx.select().from(parts).where(eq(parts.id, quote.partId)),
        tx.select().from(builds).where(eq(builds.id, order.buildId)),
        tx.select().from(thicknessOptions).where(eq(thicknessOptions.id, quote.config.thicknessOptionId)),
    ]);
    if (!part || !build) throw new Error(`Order ${order.id} references a missing part or build`);
    if (!thickness) throw new Error(`Thickness option ${quote.config.thicknessOptionId} not found`);
    // The design is frozen from checkout on (see isDesignFrozen); never send a shop geometry the buyer did not pay for.
    if (part.designVersion !== quote.designVersion) {
        throw new Error(`Part ${part.id} is at design version ${part.designVersion} but order ${order.orderNumber} paid for version ${quote.designVersion}; refund or re-quote instead of dispatching`);
    }
    if (!part.features) throw new Error(`Part ${part.id} has no analyzed features; cannot build a job packet`);
    const [[material], [process]] = await Promise.all([
        tx.select().from(materials).where(eq(materials.id, thickness.materialId)),
        tx.select().from(processes).where(eq(processes.id, thickness.processId)),
    ]);
    if (!material || !process) throw new Error(`Catalog rows for ${thickness.id} are missing`);
    const serviceIds = [...quote.config.services.map((s) => s.serviceId), ...(quote.config.finishServiceId ? [quote.config.finishServiceId] : [])];
    const serviceRows = serviceIds.length ? await tx.select().from(services).where(inArray(services.id, serviceIds)) : [];
    const finish = quote.config.finishServiceId ? (serviceRows.find((s) => s.id === quote.config.finishServiceId) ?? null) : null;
    return { quote, part, build, thickness, material, process, serviceRows, finish, features: part.features };
}

export type DispatchContext = Awaited<ReturnType<typeof loadDispatchContext>>;

function requirementsFor(order: OrderRow, ctx: DispatchContext): JobRequirements {
    const { features, quote } = ctx;
    const bendingOrdered = quote.config.services.some((s) => s.serviceId === SERVICE_IDS.bending) && features.bendCount > 0;
    return {
        thicknessOptionId: ctx.thickness.id,
        processId: ctx.process.id,
        processKind: ctx.process.kind,
        bboxWidthMm: features.bboxWidthMm,
        bboxHeightMm: features.bboxHeightMm,
        cutLengthMm: features.cutLengthMm,
        pierceCount: features.pierceCount,
        netAreaMm2: features.netAreaMm2,
        feedRateMmPerMin: ctx.thickness.feedRateMmPerMin,
        pierceTimeS: ctx.thickness.pierceTimeS,
        quantity: order.quantity,
        bending: bendingOrdered ? { bendCount: features.bendCount, longestBendMm: Math.max(0, ...features.bendLines.map((b) => b.lengthMm)) } : null,
        finished: !!ctx.finish,
        requiredServiceIds: [...new Set([...quote.config.services.map((s) => s.serviceId), ...(quote.config.finishServiceId ? [quote.config.finishServiceId] : [])])],
        quotedShopId: quote.shopId,
    };
}

/** Build the (unsigned) packet + inspection checks for a job. */
export function buildPacket(jobId: string, order: OrderRow, ctx: DispatchContext, issuedAt: Date) {
    const { features, quote } = ctx;
    const serviceIds = quote.config.services.map((s) => s.serviceId);
    const checks = buildInspectionChecks({
        features,
        thicknessMm: ctx.thickness.thicknessMm,
        quantity: order.quantity,
        serviceIds,
        finish: ctx.finish ? { name: ctx.finish.name, colorName: ctx.finish.colorName } : null,
    });
    const sampleSize = sampleSizeFor(order.quantity);
    const bent = serviceIds.includes(SERVICE_IDS.bending) && features.bendCount > 0;
    const packet: UnsignedPacket = {
        packetVersion: 1,
        jobId,
        orderNumber: order.orderNumber,
        buildDisplayId: ctx.build.displayId,
        quoteId: quote.id,
        designVersion: quote.designVersion,
        part: {
            filename: ctx.part.filename,
            bboxWidthMm: features.bboxWidthMm,
            bboxHeightMm: features.bboxHeightMm,
            cutLengthMm: features.cutLengthMm,
            pierceCount: features.pierceCount,
            holeCount: features.holes.length,
            bendCount: features.bendCount,
            fileSha256: ctx.part.fileSha256,
            flatPatternSvgPath: ctx.part.preview?.svgPath ?? null,
        },
        material: {
            id: ctx.material.id,
            name: ctx.material.name,
            thicknessOptionId: ctx.thickness.id,
            thicknessMm: ctx.thickness.thicknessMm,
            thicknessLabel: ctx.thickness.label,
        },
        process: { id: ctx.process.id, name: ctx.process.name },
        finish: ctx.finish ? { id: ctx.finish.id, name: ctx.finish.name, colorName: ctx.finish.colorName } : null,
        services: quote.config.services.map((s) => ({
            id: s.serviceId,
            name: ctx.serviceRows.find((r) => r.id === s.serviceId)?.name ?? s.serviceId,
            featureCount: s.featureCount ?? null,
            options: s.options ?? {},
        })),
        quantity: order.quantity,
        qaNotes: [`Inspect ${sampleSize} part(s): first article plus every 25th.`, ...checks.map((c) => (c.critical ? `${c.label} (critical)` : c.label)), 'Upload at least one photo of the inspected parts with the results.'],
        packing: {
            instructions: packingInstructions({ materialCategory: ctx.material.category, finished: !!ctx.finish, bent, quantity: order.quantity }),
            shippingMethod: order.shippingMethod,
        },
        buyerNotes: order.notes,
        shipBy: order.promisedShipDate,
        shipTo: order.shippingAddress,
        issuedAt: issuedAt.toISOString(),
    };
    return { packet, checks, sampleSize };
}

/**
 * Create a manufacturing job OFFERED to the best candidate shop, build + sign the
 * job packet, generate the inspection plan, advanceOrder(PAID -> DISPATCHED), emit
 * `job.offered`, then (after commit) notify the shop.
 * Returns null when no candidate shop remains (order goes/stays PAID; ops alerted).
 * Idempotent: if the order already has an open OFFERED/ACCEPTED job, returns it.
 */
export async function dispatchOrder(orderId: string, opts?: { excludeShopIds?: string[] }, tx?: DbOrTx): Promise<DispatchResult | null> {
    type Outcome =
        | { kind: 'existing'; result: DispatchResult }
        | { kind: 'offered'; result: DispatchResult; shop: { name: string; email: string }; orderNumber: string }
        | { kind: 'none'; orderNumber: string; excluded: string[] };

    const outcome = await withTx<Outcome>(async (t) => {
        const [order] = await t.select().from(orders).where(eq(orders.id, orderId)).for('update');
        if (!order) throw new ApiError('NOT_FOUND', 'Order not found');

        const jobs = await t.select().from(manufacturingJobs).where(eq(manufacturingJobs.orderId, orderId)).orderBy(desc(manufacturingJobs.createdAt));
        const open = jobs.find((j) => OPEN_JOB_STATUSES.includes(j.status));
        if (open) {
            return { kind: 'existing', result: { jobId: open.id, shopId: open.shopId, offerExpiresAt: open.offerExpiresAt ?? open.offeredAt } };
        }
        if (order.status !== 'PAID') {
            throw new ApiError('CONFLICT', `Order ${order.orderNumber} is ${order.status}; only PAID orders can be dispatched`);
        }

        const excluded = [...new Set([...(opts?.excludeShopIds ?? []), ...jobs.filter((j) => j.status === 'DECLINED' || j.status === 'EXPIRED').map((j) => j.shopId)])];
        const ctx = await loadDispatchContext(t, order);
        const candidates = await findCandidates(t, requirementsFor(order, ctx), excluded);
        const best = candidates[0];
        if (!best) {
            await emitEvent(t, {
                type: 'dispatch.unmatched',
                payload: { orderId, excludedShopIds: excluded },
                actor: SYSTEM_ACTOR,
                correlationId: order.correlationId,
                buildId: order.buildId,
                orderId,
            });
            return { kind: 'none', orderNumber: order.orderNumber, excluded };
        }

        const now = new Date();
        const offerExpiresAt = new Date(now.getTime() + best.shop.acceptWindowMinutes * 60_000);
        const jobId = newId('job');
        const { packet, checks, sampleSize } = buildPacket(jobId, order, ctx, now);
        const signed = signPacket(packet);

        await t.insert(manufacturingJobs).values({
            id: jobId,
            orderId,
            shopId: best.shop.id,
            buildId: order.buildId,
            partId: ctx.part.id,
            quoteId: ctx.quote.id,
            status: 'OFFERED',
            packet: signed,
            packetSignature: signed.signature,
            // Snapshot the exact file the quote was priced on: the shop downloads this key,
            // whatever happens to the live part row later.
            sourceFileKey: ctx.part.fileKey,
            sourceFileSha256: ctx.part.fileSha256,
            attempt: jobs.length + 1,
            payoutCents: order.shopCostCents,
            offeredAt: now,
            offerExpiresAt,
        });
        await t.insert(inspectionPlans).values({
            jobId,
            orderId,
            partId: ctx.part.id,
            checks,
            sampleSize,
            rulesetVersion: ctx.quote.rulesetVersion,
        });
        await advanceOrder(
            orderId,
            'DISPATCHED',
            SYSTEM_ACTOR,
            { reason: `Offered to ${best.shop.name}`, data: { jobId, shopId: best.shop.id, attempt: jobs.length + 1, score: best.score, estimatedCostCents: best.estimatedCostCents } },
            t,
        );
        await emitEvent(t, {
            type: 'job.offered',
            payload: { jobId, orderId, shopId: best.shop.id, offerExpiresAt: offerExpiresAt.toISOString(), isRework: false },
            actor: SYSTEM_ACTOR,
            correlationId: order.correlationId,
            buildId: order.buildId,
            orderId,
        });
        return {
            kind: 'offered',
            result: { jobId, shopId: best.shop.id, offerExpiresAt },
            shop: { name: best.shop.name, email: best.shop.contactEmail },
            orderNumber: order.orderNumber,
        };
    }, tx);

    if (outcome.kind === 'existing') return outcome.result;
    if (outcome.kind === 'none') {
        await notify('ops.alert', {
            subject: `No partner shop available for ${outcome.orderNumber}`,
            message: `Order ${outcome.orderNumber} is paid but no capable shop could be offered the job${outcome.excluded.length ? ` (excluded after decline/expiry: ${outcome.excluded.join(', ')})` : ''}. Onboard or reactivate a shop and retry POST /api/admin/orders/${orderId}/dispatch, or refund the order.`,
            orderId,
        });
        return null;
    }
    await notify('shop.job_offered', {
        to: outcome.shop.email,
        shopName: outcome.shop.name,
        jobId: outcome.result.jobId,
        orderNumber: outcome.orderNumber,
        offerExpiresAt: outcome.result.offerExpiresAt.toISOString(),
        consoleUrl: new URL(`/shop/jobs/${encodeURIComponent(outcome.result.jobId)}`, env().APP_URL).toString(),
    });
    return outcome.result;
}

/**
 * Expire OFFERED jobs past offer_expires_at (`job.expired`) and re-dispatch to the
 * next shop. Call from a cron route or the admin API. Returns number expired.
 */
export async function expireStaleOffers(now: Date = new Date()): Promise<number> {
    const db = getDb();
    const stale = await db
        .select({ id: manufacturingJobs.id, orderId: manufacturingJobs.orderId })
        .from(manufacturingJobs)
        .where(and(eq(manufacturingJobs.status, 'OFFERED'), lt(manufacturingJobs.offerExpiresAt, now)));

    let expired = 0;
    for (const { id, orderId } of stale) {
        const result = await expireOffer(id, orderId, now);
        if (!result) continue;
        expired++;
        try {
            await dispatchOrder(orderId, { excludeShopIds: [result.shopId] });
        } catch (err) {
            console.error(`[dispatch] re-dispatch after expiry of ${id} failed`, err);
            await notify('ops.alert', {
                subject: `Re-dispatch failed for order ${orderId}`,
                message: `Offer ${id} expired and re-dispatch threw: ${err instanceof Error ? err.message : String(err)}`,
                orderId,
            });
        }
    }
    return expired;
}

/**
 * Best-effort, throttled maintenance for request paths (shop job list, admin board):
 * expire stale offers and relay pending outbox events. Vercel Hobby only allows
 * daily crons, so neither may depend on the cron alone.
 * Runs at most once per minute per server instance and never throws.
 */
let lastLazySweepAt = 0;
const LAZY_SWEEP_INTERVAL_MS = 60_000;

export async function sweepStaleOffersLazily(now: Date = new Date()): Promise<void> {
    if (now.getTime() - lastLazySweepAt < LAZY_SWEEP_INTERVAL_MS) return;
    lastLazySweepAt = now.getTime();
    try {
        await expireStaleOffers(now);
    } catch (err) {
        console.error('[dispatch] lazy offer sweep failed', err);
    }
    // Same reason for the outbox relay: redeliver side effects a crashed request left behind.
    try {
        const { ensureSubscribers } = await import('../events/registry');
        const { publishPendingEvents } = await import('../events/outbox');
        await ensureSubscribers();
        await publishPendingEvents({ limit: 100 });
    } catch (err) {
        console.error('[dispatch] lazy outbox relay failed', err);
    }
}

/** Test hook: let the next lazy sweep run immediately. */
export function resetLazySweepThrottle(): void {
    lastLazySweepAt = 0;
}

/** Expire one offer (order -> job lock order). Returns null if it was no longer expirable. */
async function expireOffer(jobId: string, orderId: string, now: Date): Promise<{ shopId: string } | null> {
    return withTx(async (t) => {
        const [order] = await t.select().from(orders).where(eq(orders.id, orderId)).for('update');
        const [job] = await t.select().from(manufacturingJobs).where(eq(manufacturingJobs.id, jobId)).for('update');
        if (!order || !job || job.status !== 'OFFERED' || !job.offerExpiresAt || job.offerExpiresAt >= now) return null;
        await t.update(manufacturingJobs).set({ status: 'EXPIRED', updatedAt: now }).where(eq(manufacturingJobs.id, jobId));
        await emitEvent(t, {
            type: 'job.expired',
            payload: { jobId, orderId, shopId: job.shopId },
            actor: SYSTEM_ACTOR,
            correlationId: order.correlationId,
            buildId: order.buildId,
            orderId,
        });
        if (order.status === 'DISPATCHED') {
            await advanceOrder(orderId, 'PAID', SYSTEM_ACTOR, { reason: 'Shop offer expired', data: { jobId, shopId: job.shopId } }, t);
        }
        return { shopId: job.shopId };
    });
}

/**
 * Cancel every open job of an order (refund / cancellation by ops), emitting `job.cancelled`
 * per job. Call inside the same transaction as the order transition. Returns the cancelled
 * job ids. Idempotent.
 */
export async function cancelOpenJobs(orderId: string, tx?: DbOrTx, reason = 'Order refunded'): Promise<string[]> {
    return withTx(async (t) => {
        const [order] = await t.select().from(orders).where(eq(orders.id, orderId));
        if (!order) return [];
        const now = new Date();
        const rows = await t
            .update(manufacturingJobs)
            .set({ status: 'CANCELLED', offerExpiresAt: null, updatedAt: now })
            .where(and(eq(manufacturingJobs.orderId, orderId), inArray(manufacturingJobs.status, ['OFFERED', 'ACCEPTED', 'IN_PRODUCTION', 'QA_PASSED'])))
            .returning({ id: manufacturingJobs.id, shopId: manufacturingJobs.shopId });
        for (const row of rows) {
            await emitEvent(t, {
                type: 'job.cancelled',
                payload: { jobId: row.id, orderId, shopId: row.shopId, reason },
                actor: SYSTEM_ACTOR,
                correlationId: order.correlationId,
                buildId: order.buildId,
                orderId,
                timestamp: now,
            });
        }
        return rows.map((r) => r.id);
    }, tx);
}
