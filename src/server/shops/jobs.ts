/**
 * Shop Console job actions. Every action is scoped to the calling shop (another shop's
 * job is indistinguishable from a missing one: 404), changes the job and the order in
 * ONE transaction (order transitions only via advanceOrder), and emits domain events.
 * Locks are always taken order-first, then job, to avoid deadlocks with dispatch.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Actor } from '../../contracts/common';
import type { JobStatus } from '../../contracts/enums';
import type {
    DeclineJobRequest,
    InspectionMeasurement,
    InspectionResultView,
    InspectionSubmitRequest,
    MilestoneRequest,
    MilestoneView,
    QaUploadRequest,
    QaUploadResponse,
    ShopJobDetail,
    ShopJobSummary,
} from '../../contracts/shop';
import type { CreateShipmentRequest, ShipmentView, TrackingEvent } from '../../contracts/shipments';
import { getDb, withTx, type Tx } from '../db';
import { inspectionPlans, inspectionResults, manufacturingJobs, orders, productionMilestones, shipments, shops } from '../db/schema';
import { dispatchOrder } from '../dispatch';
import { MEASURED_CHECK_KINDS, withinTolerance } from '../dispatch/inspection-plan';
import { signPacket, type StoredPacket } from '../dispatch/packet';
import { emitEvent } from '../events/outbox';
import { ApiError } from '../http';
import { newId, randomBase32 } from '../ids';
import { notify } from '../notify';
import { advanceOrder } from '../orders';
import { getCarrier } from '../shipping';
import { toShipmentView } from '../shipping/views';
import { getStorage, storageKeys } from '../storage';
import { buildJobDetail, toInspectionResultView, toJobSummary, toMilestoneView, type JobRow } from './views';

export const DEFAULT_JOB_LIST_STATUSES: readonly JobStatus[] = ['OFFERED', 'ACCEPTED', 'IN_PRODUCTION', 'QA_PASSED', 'SHIPPED'];
export const QA_UPLOAD_URL_TTL_SECONDS = 900;

const shopActor = (shopId: string): Actor => ({ kind: 'shop', id: shopId });
const notFound = () => new ApiError('NOT_FOUND', 'Job not found');
type OrderRow = typeof orders.$inferSelect;

async function findShopJob(shopId: string, jobId: string): Promise<JobRow> {
    if (!/^job_[A-Za-z0-9_-]+$/.test(jobId) || jobId.length > 64) throw notFound();
    const [job] = await getDb().select().from(manufacturingJobs).where(eq(manufacturingJobs.id, jobId));
    if (!job || job.shopId !== shopId) throw notFound();
    return job;
}

/** Lock order then job (inside `t`); re-checks ownership. */
async function lockShopJob(t: Tx, shopId: string, jobId: string): Promise<{ order: OrderRow; job: JobRow }> {
    const [peek] = await t.select({ orderId: manufacturingJobs.orderId, shopId: manufacturingJobs.shopId }).from(manufacturingJobs).where(eq(manufacturingJobs.id, jobId));
    if (!peek || peek.shopId !== shopId) throw notFound();
    const [order] = await t.select().from(orders).where(eq(orders.id, peek.orderId)).for('update');
    const [job] = await t.select().from(manufacturingJobs).where(eq(manufacturingJobs.id, jobId)).for('update');
    if (!order || !job || job.shopId !== shopId) throw notFound();
    return { order, job };
}

function eventCtx(order: OrderRow) {
    return { correlationId: order.correlationId, buildId: order.buildId, orderId: order.id };
}

/** Uploaded photo keys must live under this job's QA prefix and actually exist in storage. */
async function assertPhotoKeys(jobId: string, keys: string[] | undefined): Promise<string[]> {
    const list = [...new Set(keys ?? [])];
    const prefix = `qa/${jobId}/`;
    for (const key of list) {
        if (!key.startsWith(prefix) || key.includes('..')) {
            throw new ApiError('VALIDATION_FAILED', `Photo ${key} does not belong to this job; upload it via POST /api/shop/jobs/${jobId}/uploads`);
        }
    }
    const storage = getStorage();
    const heads = await Promise.all(list.map((k) => storage.headObject(k)));
    const missing = list.filter((_, i) => !heads[i]);
    if (missing.length) throw new ApiError('VALIDATION_FAILED', `Photo upload not found: ${missing.join(', ')}`);
    return list;
}

/** Jobs for this shop, newest first. Default filter: every non-terminal status. */
export async function listJobs(shopId: string, filter?: { status?: JobStatus[] }): Promise<ShopJobSummary[]> {
    const statuses = filter?.status?.length ? filter.status : [...DEFAULT_JOB_LIST_STATUSES];
    const rows = await getDb()
        .select()
        .from(manufacturingJobs)
        .where(and(eq(manufacturingJobs.shopId, shopId), inArray(manufacturingJobs.status, statuses)))
        .orderBy(desc(manufacturingJobs.createdAt))
        .limit(200);
    return rows.map(toJobSummary);
}

/** Job detail scoped to the shop (null if not this shop's job). Packet redacted until ACCEPTED. */
export async function getJob(shopId: string, jobId: string): Promise<ShopJobDetail | null> {
    try {
        const job = await findShopJob(shopId, jobId);
        return buildJobDetail(getDb(), job);
    } catch (err) {
        if (err instanceof ApiError && err.code === 'NOT_FOUND') return null;
        throw err;
    }
}

async function detailOrThrow(shopId: string, jobId: string): Promise<ShopJobDetail> {
    const d = await getJob(shopId, jobId);
    if (!d) throw notFound();
    return d;
}

/** Accept an OFFERED, unexpired job. @throws ApiError NOT_FOUND / CONFLICT. */
export async function acceptJob(shopId: string, jobId: string): Promise<ShopJobDetail> {
    await findShopJob(shopId, jobId);
    await withTx(async (t) => {
        const { order, job } = await lockShopJob(t, shopId, jobId);
        if (job.status === 'ACCEPTED' && job.acceptedAt) return; // idempotent replay
        if (job.status !== 'OFFERED') throw new ApiError('CONFLICT', `Job is ${job.status}; only OFFERED jobs can be accepted`);
        const now = new Date();
        if (job.offerExpiresAt && job.offerExpiresAt <= now) throw new ApiError('CONFLICT', 'This offer has expired');
        if (order.status !== 'DISPATCHED') throw new ApiError('CONFLICT', `Order is ${order.status}; it is no longer waiting for a shop`);
        await t.update(manufacturingJobs).set({ status: 'ACCEPTED', acceptedAt: now, updatedAt: now }).where(eq(manufacturingJobs.id, jobId));
        await advanceOrder(order.id, 'ACCEPTED', shopActor(shopId), { reason: 'Shop accepted the job', shopId, data: { jobId } }, t);
        await emitEvent(t, { type: 'job.accepted', payload: { jobId, orderId: order.id, shopId }, actor: shopActor(shopId), ...eventCtx(order) });
    });
    return detailOrThrow(shopId, jobId);
}

/** Decline an OFFERED job with a reason and re-dispatch. @throws ApiError NOT_FOUND / CONFLICT. */
export async function declineJob(shopId: string, jobId: string, input: DeclineJobRequest): Promise<ShopJobDetail> {
    await findShopJob(shopId, jobId);
    const declined = await withTx(async (t) => {
        const { order, job } = await lockShopJob(t, shopId, jobId);
        if (job.status === 'DECLINED') return null; // idempotent replay
        if (job.status !== 'OFFERED') throw new ApiError('CONFLICT', `Job is ${job.status}; only OFFERED jobs can be declined`);
        const now = new Date();
        await t
            .update(manufacturingJobs)
            .set({ status: 'DECLINED', declinedAt: now, declineReason: input.reason, declineNote: input.note ?? null, updatedAt: now })
            .where(eq(manufacturingJobs.id, jobId));
        await emitEvent(t, {
            type: 'job.declined',
            payload: { jobId, orderId: order.id, shopId, reason: input.reason, note: input.note ?? null },
            actor: shopActor(shopId),
            ...eventCtx(order),
        });
        if (order.status === 'DISPATCHED') {
            await advanceOrder(order.id, 'PAID', shopActor(shopId), { reason: `Shop declined (${input.reason})`, data: { jobId, shopId } }, t);
        }
        return { orderId: order.id };
    });
    if (declined) {
        try {
            await dispatchOrder(declined.orderId, { excludeShopIds: [shopId] });
        } catch (err) {
            await notify('ops.alert', {
                subject: `Re-dispatch failed for order ${declined.orderId}`,
                message: `Job ${jobId} was declined and re-dispatch threw: ${err instanceof Error ? err.message : String(err)}`,
                orderId: declined.orderId,
            });
        }
    }
    return detailOrThrow(shopId, jobId);
}

/** Record a production milestone on an ACCEPTED / IN_PRODUCTION job (also PACKED etc. after QA pass). */
export async function recordMilestone(shopId: string, jobId: string, input: MilestoneRequest): Promise<MilestoneView> {
    await findShopJob(shopId, jobId);
    const photoKeys = await assertPhotoKeys(jobId, input.photoKeys);
    const result = await withTx(async (t) => {
        const { order, job } = await lockShopJob(t, shopId, jobId);
        if (job.status !== 'ACCEPTED' && job.status !== 'IN_PRODUCTION' && job.status !== 'QA_PASSED') {
            throw new ApiError('CONFLICT', `Job is ${job.status}; milestones can only be recorded on accepted jobs in production`);
        }
        const now = new Date();
        const actor = shopActor(shopId);
        let started = false;
        if (job.status === 'ACCEPTED') {
            if (order.status !== 'ACCEPTED' && order.status !== 'QA_FAILED') {
                throw new ApiError('CONFLICT', `Order is ${order.status}; production cannot start`);
            }
            await t.update(manufacturingJobs).set({ status: 'IN_PRODUCTION', startedAt: now, updatedAt: now }).where(eq(manufacturingJobs.id, jobId));
            await advanceOrder(order.id, 'IN_PRODUCTION', actor, { reason: job.reworkOfJobId ? 'Rework started' : 'Production started', data: { jobId, milestone: input.kind } }, t);
            await emitEvent(t, { type: 'production.started', payload: { jobId, orderId: order.id, shopId }, actor, ...eventCtx(order) });
            started = true;
        }
        const [m] = await t
            .insert(productionMilestones)
            .values({ id: newId('milestone'), jobId, orderId: order.id, kind: input.kind, note: input.note ?? null, photoKeys, actorId: `shop:${shopId}`, occurredAt: now })
            .returning();
        await emitEvent(t, {
            type: 'production.milestone',
            payload: { jobId, orderId: order.id, shopId, milestoneId: m.id, kind: m.kind, note: m.note },
            actor,
            ...eventCtx(order),
        });
        return { milestone: m, notifyStart: started && !job.reworkOfJobId ? order : null };
    });
    if (result.notifyStart) {
        const [shop] = await getDb().select({ name: shops.name }).from(shops).where(eq(shops.id, shopId));
        await notify('order.in_production', {
            to: result.notifyStart.buyerEmail,
            orderId: result.notifyStart.id,
            orderNumber: result.notifyStart.orderNumber,
            shopName: shop?.name ?? 'your partner shop',
        });
    }
    return toMilestoneView(result.milestone);
}

const EXT_FOR_TYPE: Record<QaUploadRequest['contentType'], string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
};

/** Signed upload URL for a QA / milestone photo (key `qa/<jobId>/...`). */
export async function createQaUpload(shopId: string, jobId: string, input: QaUploadRequest): Promise<QaUploadResponse> {
    const job = await findShopJob(shopId, jobId);
    if (job.status !== 'ACCEPTED' && job.status !== 'IN_PRODUCTION' && job.status !== 'QA_PASSED') {
        throw new ApiError('CONFLICT', `Job is ${job.status}; photos can only be uploaded while the job is in production`);
    }
    const key = storageKeys.qaPhoto(jobId, randomBase32(16).toLowerCase(), EXT_FOR_TYPE[input.contentType]);
    const signed = await getStorage().getSignedUrl(key, {
        method: 'PUT',
        contentType: input.contentType,
        maxBytes: input.sizeBytes,
        expiresInSeconds: QA_UPLOAD_URL_TTL_SECONDS,
    });
    return { key, upload: { url: signed.url, method: 'PUT', headers: signed.headers, expiresAt: signed.expiresAt.toISOString() } };
}

type EvaluatedInspection = { measurements: InspectionMeasurement[]; failedCheckIds: string[]; criticalFailed: string[] };

/** Server-side evaluation of the shop's measurements against the plan (contract: the shop never chooses the outcome). */
export function evaluateInspection(plan: (typeof inspectionPlans.$inferSelect)['checks'], submitted: InspectionMeasurement[]): EvaluatedInspection {
    const byId = new Map<string, InspectionMeasurement>();
    for (const m of submitted) {
        if (byId.has(m.checkId)) throw new ApiError('VALIDATION_FAILED', `Duplicate measurement for check ${m.checkId}`);
        byId.set(m.checkId, m);
    }
    const planIds = new Set(plan.map((c) => c.id));
    const unknown = submitted.filter((m) => !planIds.has(m.checkId)).map((m) => m.checkId);
    if (unknown.length) throw new ApiError('VALIDATION_FAILED', `Unknown inspection checks: ${unknown.join(', ')}`);
    const missing = plan.filter((c) => !byId.has(c.id)).map((c) => c.id);
    if (missing.length) throw new ApiError('VALIDATION_FAILED', `Every check in the inspection plan needs a result. Missing: ${missing.join(', ')}`, 400, { missing });

    const measurements: InspectionMeasurement[] = [];
    const failedCheckIds: string[] = [];
    const criticalFailed: string[] = [];
    for (const check of plan) {
        const m = byId.get(check.id) as InspectionMeasurement;
        let pass: boolean;
        if (MEASURED_CHECK_KINDS.has(check.kind)) {
            if (typeof m.measuredValue !== 'number' || !Number.isFinite(m.measuredValue)) {
                throw new ApiError('VALIDATION_FAILED', `Check ${check.id} (${check.label}) needs a measured value`);
            }
            pass = withinTolerance(check, m.measuredValue);
        } else {
            pass = m.pass;
        }
        measurements.push({ checkId: check.id, ...(typeof m.measuredValue === 'number' ? { measuredValue: m.measuredValue } : {}), pass, ...(m.note ? { note: m.note } : {}) });
        if (!pass) {
            failedCheckIds.push(check.id);
            if (check.critical) criticalFailed.push(check.id);
        }
    }
    return { measurements, failedCheckIds, criticalFailed };
}

/** Submit QA against the job's inspection plan; outcome computed server-side. */
export async function submitInspection(shopId: string, jobId: string, input: InspectionSubmitRequest): Promise<InspectionResultView> {
    await findShopJob(shopId, jobId);
    const photoKeys = await assertPhotoKeys(jobId, input.photoKeys);
    if (!photoKeys.length) throw new ApiError('VALIDATION_FAILED', 'At least one inspection photo is required');

    const out = await withTx(async (t) => {
        const { order, job } = await lockShopJob(t, shopId, jobId);
        if (job.status !== 'IN_PRODUCTION') {
            throw new ApiError(
                'CONFLICT',
                job.status === 'ACCEPTED' ? 'Record a production milestone before submitting inspection' : `Job is ${job.status}; inspection can only be submitted while in production`,
            );
        }
        if (order.status !== 'IN_PRODUCTION') throw new ApiError('CONFLICT', `Order is ${order.status}; inspection is not expected now`);
        const [plan] = await t.select().from(inspectionPlans).where(eq(inspectionPlans.jobId, jobId));
        if (!plan) throw new Error(`Job ${jobId} has no inspection plan`);

        const evaluated = evaluateInspection(plan.checks, input.measurements);
        const outcome = evaluated.criticalFailed.length === 0 ? 'PASS' : 'FAIL';
        const now = new Date();
        const actor = shopActor(shopId);
        const resultId = newId('inspectionResult');
        let reworkJobId: string | null = null;

        if (outcome === 'PASS') {
            await t.update(manufacturingJobs).set({ status: 'QA_PASSED', qaPassedAt: now, updatedAt: now }).where(eq(manufacturingJobs.id, jobId));
        } else {
            await t.update(manufacturingJobs).set({ status: 'QA_FAILED', completedAt: now, updatedAt: now }).where(eq(manufacturingJobs.id, jobId));
            const [{ n }] = await t.select({ n: sql<number>`count(*)::int` }).from(manufacturingJobs).where(eq(manufacturingJobs.orderId, order.id));
            reworkJobId = newId('job');
            const reworkPacket = signPacket({ ...stripSignature(job.packet), jobId: reworkJobId, issuedAt: now.toISOString() });
            await t.insert(manufacturingJobs).values({
                id: reworkJobId,
                orderId: order.id,
                shopId,
                buildId: job.buildId,
                partId: job.partId,
                quoteId: job.quoteId,
                status: 'ACCEPTED',
                packet: reworkPacket,
                packetSignature: reworkPacket.signature,
                sourceFileKey: job.sourceFileKey,
                sourceFileSha256: job.sourceFileSha256,
                reworkOfJobId: job.id,
                attempt: n + 1,
                payoutCents: job.payoutCents,
                offeredAt: now,
                offerExpiresAt: null,
                acceptedAt: now,
            });
            await t.insert(inspectionPlans).values({ jobId: reworkJobId, orderId: order.id, partId: job.partId, checks: plan.checks, sampleSize: plan.sampleSize, rulesetVersion: plan.rulesetVersion });
        }

        const [result] = await t
            .insert(inspectionResults)
            .values({
                id: resultId,
                planId: plan.id,
                jobId,
                orderId: order.id,
                outcome,
                measurements: evaluated.measurements,
                photoKeys,
                inspectorName: input.inspectorName,
                notes: input.notes ?? null,
                reworkJobId,
                actorId: `shop:${shopId}`,
                createdAt: now,
            })
            .returning();

        if (outcome === 'PASS') {
            await advanceOrder(order.id, 'QA_PASSED', actor, { reason: 'Inspection passed', data: { jobId, resultId } }, t);
            await emitEvent(t, { type: 'inspection.passed', payload: { jobId, orderId: order.id, resultId, planId: plan.id }, actor, ...eventCtx(order) });
            await emitEvent(t, { type: 'production.completed', payload: { jobId, orderId: order.id, shopId }, actor, ...eventCtx(order) });
        } else {
            await advanceOrder(order.id, 'QA_FAILED', actor, { reason: `Inspection failed: ${evaluated.criticalFailed.join(', ')}`, data: { jobId, resultId, reworkJobId } }, t);
            await emitEvent(t, {
                type: 'inspection.failed',
                payload: { jobId, orderId: order.id, resultId, planId: plan.id, reworkJobId, failedCheckIds: evaluated.failedCheckIds },
                actor,
                ...eventCtx(order),
            });
        }
        const [{ fails }] = await t
            .select({ fails: sql<number>`count(*)::int` })
            .from(inspectionResults)
            .where(and(eq(inspectionResults.orderId, order.id), eq(inspectionResults.outcome, 'FAIL')));
        return { result, order, repeatedFailure: outcome === 'FAIL' && fails >= 2 };
    });

    if (out.repeatedFailure) {
        await notify('ops.alert', {
            subject: `QA failed again for ${out.order.orderNumber}`,
            message: `Inspection failed more than once on order ${out.order.orderNumber} (latest job ${jobId}). Review the rework or refund the order.`,
            orderId: out.order.id,
        });
    }
    return toInspectionResultView(out.result);
}

function stripSignature(p: StoredPacket) {
    const { signature: _s, ...rest } = p;
    void _s;
    return rest;
}

/** Buy (easypost) or record (manual) the shipping label. Requires QA_PASSED. */
export async function createShipment(shopId: string, jobId: string, input: CreateShipmentRequest): Promise<ShipmentView> {
    const job = await findShopJob(shopId, jobId);
    const db = getDb();
    const [existing] = await db.select().from(shipments).where(eq(shipments.jobId, jobId)).limit(1);
    if (existing) return toShipmentView(existing, { includeLabel: true });
    const [order] = await db.select().from(orders).where(eq(orders.id, job.orderId));
    if (!order) throw notFound();
    if (job.status !== 'QA_PASSED' || order.status !== 'QA_PASSED') {
        throw new ApiError('CONFLICT', 'Inspection must pass before a shipping label can be created');
    }
    const [shop] = await db.select().from(shops).where(eq(shops.id, shopId));
    if (!shop) throw notFound();

    const carrier = getCarrier();
    const label = await carrier.buyLabel({
        from: shop.address,
        to: order.shippingAddress,
        parcel: input.parcel,
        method: order.shippingMethod,
        reference: order.orderNumber,
        manual: input.manual,
    });

    let row: typeof shipments.$inferSelect;
    try {
        row = await withTx(async (t) => {
            const locked = await lockShopJob(t, shopId, jobId);
            const [dup] = await t.select().from(shipments).where(eq(shipments.jobId, jobId)).limit(1);
            if (dup) return dup;
            if (locked.job.status !== 'QA_PASSED' || locked.order.status !== 'QA_PASSED') {
                throw new ApiError('CONFLICT', 'Inspection must pass before a shipping label can be created');
            }
            const now = new Date();
            const first: TrackingEvent = {
                status: 'LABEL_CREATED',
                message: `Label created · ${label.carrier} ${label.service}`,
                location: `${shop.city}, ${shop.region}`,
                occurredAt: now.toISOString(),
            };
            const [created] = await t
                .insert(shipments)
                .values({
                    orderId: locked.order.id,
                    jobId,
                    provider: carrier.name,
                    providerShipmentId: label.providerShipmentId,
                    carrier: label.carrier,
                    service: label.service,
                    trackingNumber: label.trackingNumber,
                    trackingUrl: label.trackingUrl,
                    labelUrl: label.labelUrl,
                    rateCents: label.rateCents,
                    status: 'LABEL_CREATED',
                    events: [first],
                    parcel: input.parcel,
                    fromAddress: shop.address,
                    toAddress: locked.order.shippingAddress,
                    estimatedDeliveryDate: label.estimatedDeliveryDate,
                    shippedAt: now,
                })
                .returning();
            await t.update(manufacturingJobs).set({ status: 'SHIPPED', shippedAt: now, updatedAt: now }).where(eq(manufacturingJobs.id, jobId));
            await advanceOrder(locked.order.id, 'SHIPPED', shopActor(shopId), { reason: `Shipped via ${label.carrier} ${label.service}`, data: { shipmentId: created.id, trackingNumber: label.trackingNumber } }, t);
            await emitEvent(t, {
                type: 'shipment.created',
                payload: { shipmentId: created.id, orderId: locked.order.id, jobId, carrier: label.carrier, service: label.service, trackingNumber: label.trackingNumber },
                actor: shopActor(shopId),
                ...eventCtx(locked.order),
            });
            return created;
        });
    } catch (err) {
        if (label.providerShipmentId) {
            await notify('ops.alert', {
                subject: `Orphaned shipping label for ${order.orderNumber}`,
                message: `A ${label.carrier} label (${label.trackingNumber}, provider id ${label.providerShipmentId}) was bought but recording the shipment failed: ${err instanceof Error ? err.message : String(err)}. Void or reuse it.`,
                orderId: order.id,
            });
        }
        throw err;
    }

    await notify('order.shipped', {
        to: order.buyerEmail,
        orderId: order.id,
        orderNumber: order.orderNumber,
        carrier: row.carrier,
        trackingNumber: row.trackingNumber,
        trackingUrl: row.trackingUrl,
    });
    return toShipmentView(row, { includeLabel: true });
}
