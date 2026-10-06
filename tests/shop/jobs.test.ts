import { and, asc, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { domainEvents, inspectionPlans, manufacturingJobs, orders, shipments } from '@/server/db/schema';
import { verifyPacket } from '@/server/dispatch';
import {
    acceptJob,
    createQaUpload,
    createShipment,
    declineJob,
    getJob,
    listJobs,
    recordMilestone,
    submitInspection,
} from '@/server/shops';
import { useTestDb } from '../support/db';
import { createAcceptedJob, createPaidOrder, createQaPassedJob, createShopFixture, measurementsFor, quietConsole, uploadQaPhoto } from './fixtures';
import { dispatchOrder } from '@/server/dispatch';
import { ManualCarrier } from '@/server/shipping';

const parcel = { lengthIn: 10, widthIn: 8, heightIn: 2, weightOz: 24 };
const manual = { carrier: 'UPS', service: 'Ground', trackingNumber: '1Z999AA10123456784' };

async function orderStatus(db: ReturnType<typeof useTestDb>['db'], orderId: string) {
    const [o] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId));
    return o.status;
}

describe('shop console jobs', () => {
    const ctx = useTestDb({ seed: true });
    let intruder: string;

    beforeAll(async () => {
        quietConsole();
        // A second ACTIVE shop that can never be dispatched these jobs (bed too small).
        intruder = (await createShopFixture(ctx.db, { name: 'Intruder Fab', bed: { w: 20, h: 20 } })).shopId;
    });

    it("a shop cannot see or act on another shop's job", async () => {
        const { order } = await createPaidOrder(ctx.db);
        const d = await dispatchOrder(order.id);
        expect(d!.shopId).not.toBe(intruder);
        expect(await getJob(intruder, d!.jobId)).toBeNull();
        expect(await listJobs(intruder)).toEqual([]);
        await expect(acceptJob(intruder, d!.jobId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
        await expect(declineJob(intruder, d!.jobId, { reason: 'OTHER' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
        await expect(recordMilestone(intruder, d!.jobId, { kind: 'CUTTING' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
        await expect(createQaUpload(intruder, d!.jobId, { filename: 'a.jpg', contentType: 'image/jpeg', sizeBytes: 1000 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
        await expect(createShipment(intruder, d!.jobId, { parcel, manual })).rejects.toMatchObject({ code: 'NOT_FOUND' });

        // Nothing changed.
        expect(await orderStatus(ctx.db, order.id)).toBe('DISPATCHED');
        const listed = await listJobs(d!.shopId, { status: ['OFFERED'] });
        expect(listed.map((j) => j.id)).toContain(d!.jobId);
    });

    it('first milestone moves the order ACCEPTED -> IN_PRODUCTION and emits production events', async () => {
        const job = await createAcceptedJob(ctx.db);
        expect(await orderStatus(ctx.db, job.order.id)).toBe('ACCEPTED');
        const m1 = await recordMilestone(job.shopId, job.jobId, { kind: 'MATERIAL_STAGED', note: 'Sheet pulled from rack 3' });
        expect(m1.label).toBe('Material staged');
        expect(await orderStatus(ctx.db, job.order.id)).toBe('IN_PRODUCTION');
        await recordMilestone(job.shopId, job.jobId, { kind: 'CUTTING' });
        const types = (await ctx.db.select().from(domainEvents).where(eq(domainEvents.orderId, job.order.id))).map((e) => e.eventType);
        expect(types.filter((t) => t === 'production.started')).toHaveLength(1);
        expect(types.filter((t) => t === 'production.milestone')).toHaveLength(2);
        const detail = await getJob(job.shopId, job.jobId);
        expect(detail?.milestones.map((m) => m.kind)).toEqual(['MATERIAL_STAGED', 'CUTTING']);
        expect(detail?.nextAction).toBe('SUBMIT_INSPECTION');
    });

    it('blocks shipment until QA has passed', async () => {
        const job = await createAcceptedJob(ctx.db);
        await expect(createShipment(job.shopId, job.jobId, { parcel, manual })).rejects.toMatchObject({ code: 'CONFLICT' });
        await recordMilestone(job.shopId, job.jobId, { kind: 'CUTTING' });
        await expect(createShipment(job.shopId, job.jobId, { parcel, manual })).rejects.toMatchObject({ code: 'CONFLICT' });
        expect(await ctx.db.select().from(shipments).where(eq(shipments.orderId, job.order.id))).toHaveLength(0);
        expect(await orderStatus(ctx.db, job.order.id)).toBe('IN_PRODUCTION');
    });

    it('validates inspection submissions server-side (every check, real photos, measured values)', async () => {
        const job = await createAcceptedJob(ctx.db);
        const photo = await uploadQaPhoto(job.jobId);
        // Before production started.
        await expect(submitInspection(job.shopId, job.jobId, { measurements: await measurementsFor(ctx.db, job.jobId), photoKeys: [photo], inspectorName: 'Sam' })).rejects.toMatchObject({
            code: 'CONFLICT',
        });
        await recordMilestone(job.shopId, job.jobId, { kind: 'CUTTING' });
        const all = await measurementsFor(ctx.db, job.jobId);
        await expect(submitInspection(job.shopId, job.jobId, { measurements: all.slice(1), photoKeys: [photo], inspectorName: 'Sam' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
        await expect(submitInspection(job.shopId, job.jobId, { measurements: all, photoKeys: [`qa/${job.jobId}/never-uploaded.jpg`], inspectorName: 'Sam' })).rejects.toMatchObject({
            code: 'VALIDATION_FAILED',
        });
        await expect(submitInspection(job.shopId, job.jobId, { measurements: all, photoKeys: ['qa/job_someoneelse/x.jpg'], inspectorName: 'Sam' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
        const noValue = all.map((m) => (m.checkId === 'chk_bbox_w' ? { checkId: m.checkId, pass: true } : m));
        await expect(submitInspection(job.shopId, job.jobId, { measurements: noValue, photoKeys: [photo], inspectorName: 'Sam' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
        expect(await orderStatus(ctx.db, job.order.id)).toBe('IN_PRODUCTION');
    });

    it('QA fail -> rework job (same shop, ACCEPTED) -> rework milestone -> QA pass -> shipment', async () => {
        const job = await createAcceptedJob(ctx.db);
        await recordMilestone(job.shopId, job.jobId, { kind: 'CUTTING' });
        const photo = await uploadQaPhoto(job.jobId);
        // The shop claims every check passed, but the measured hole is out of tolerance: the server decides.
        const failing = await submitInspection(job.shopId, job.jobId, { measurements: await measurementsFor(ctx.db, job.jobId, ['chk_hole_1']), photoKeys: [photo], inspectorName: 'Sam' });
        expect(failing.outcome).toBe('FAIL');
        expect(failing.reworkJobId).toMatch(/^job_/);
        expect(failing.measurements.find((m) => m.checkId === 'chk_hole_1')?.pass).toBe(false);
        expect(await orderStatus(ctx.db, job.order.id)).toBe('QA_FAILED');
        await expect(createShipment(job.shopId, job.jobId, { parcel, manual })).rejects.toMatchObject({ code: 'CONFLICT' });

        const jobs = await ctx.db.select().from(manufacturingJobs).where(eq(manufacturingJobs.orderId, job.order.id)).orderBy(asc(manufacturingJobs.createdAt));
        expect(jobs.map((j) => j.status)).toEqual(['QA_FAILED', 'ACCEPTED']);
        const rework = jobs[1];
        expect(rework.id).toBe(failing.reworkJobId);
        expect(rework.shopId).toBe(job.shopId);
        expect(rework.reworkOfJobId).toBe(job.jobId);
        expect(rework.packet.jobId).toBe(rework.id);
        expect(verifyPacket(rework.packet)).toBe(true);
        expect(await ctx.db.select().from(inspectionPlans).where(eq(inspectionPlans.jobId, rework.id))).toHaveLength(1);
        const failedEvent = await ctx.db.select().from(domainEvents).where(and(eq(domainEvents.orderId, job.order.id), eq(domainEvents.eventType, 'inspection.failed')));
        expect(failedEvent[0].payload).toMatchObject({ reworkJobId: rework.id, failedCheckIds: ['chk_hole_1'] });

        // The old job is closed for further work.
        await expect(recordMilestone(job.shopId, job.jobId, { kind: 'CUTTING' })).rejects.toMatchObject({ code: 'CONFLICT' });

        const reworkDetail = await getJob(job.shopId, rework.id);
        expect(reworkDetail?.isRework).toBe(true);
        expect(reworkDetail?.packet.files).toHaveLength(1);
        await recordMilestone(job.shopId, rework.id, { kind: 'CUTTING', note: 'Re-cut with new nozzle' });
        expect(await orderStatus(ctx.db, job.order.id)).toBe('IN_PRODUCTION');
        const reworkPhoto = await uploadQaPhoto(rework.id);
        const passing = await submitInspection(job.shopId, rework.id, { measurements: await measurementsFor(ctx.db, rework.id), photoKeys: [reworkPhoto], inspectorName: 'Sam' });
        expect(passing.outcome).toBe('PASS');
        expect(await orderStatus(ctx.db, job.order.id)).toBe('QA_PASSED');

        const shipment = await createShipment(job.shopId, rework.id, { parcel, manual });
        expect(shipment.provider).toBe('manual');
        expect(shipment.trackingUrl).toContain('ups.com');
        expect(shipment.status).toBe('LABEL_CREATED');
        expect(await orderStatus(ctx.db, job.order.id)).toBe('SHIPPED');
        // Idempotent replay returns the same shipment.
        expect((await createShipment(job.shopId, rework.id, { parcel, manual })).id).toBe(shipment.id);
    });

    it('concurrent label requests buy exactly one label and return the same shipment', async () => {
        const job = await createQaPassedJob(ctx.db);
        const buy = vi.spyOn(ManualCarrier.prototype, 'buyLabel');
        try {
            const [a, b] = await Promise.all([createShipment(job.shopId, job.jobId, { parcel, manual }), createShipment(job.shopId, job.jobId, { parcel, manual })]);
            expect(a.id).toBe(b.id);
            expect(buy).toHaveBeenCalledTimes(1);
        } finally {
            buy.mockRestore();
        }
        expect(await ctx.db.select().from(shipments).where(eq(shipments.jobId, job.jobId))).toHaveLength(1);
    });

    it('a non-critical failure still passes; QA upload URLs are scoped to the job', async () => {
        const { shopId, jobId, order } = await createAcceptedJob(ctx.db);
        const upload = await createQaUpload(shopId, jobId, { filename: 'inspection.png', contentType: 'image/png', sizeBytes: 2048 });
        expect(upload.key).toMatch(new RegExp(`^qa/${jobId}/[a-z0-9]+\\.png$`));
        expect(upload.upload.headers['content-type'] ?? upload.upload.headers['Content-Type']).toBe('image/png');
        await recordMilestone(shopId, jobId, { kind: 'CUTTING' });
        const photo = await uploadQaPhoto(jobId);
        const result = await submitInspection(shopId, jobId, { measurements: await measurementsFor(ctx.db, jobId, ['chk_flatness', 'chk_edges']), photoKeys: [photo], inspectorName: 'Sam' });
        expect(result.outcome).toBe('PASS');
        expect(await orderStatus(ctx.db, order.id)).toBe('QA_PASSED');
    });

    it('createQaPassedJob fixture reaches QA_PASSED', async () => {
        const job = await createQaPassedJob(ctx.db);
        expect(job.inspection.outcome).toBe('PASS');
        expect((await getJob(job.shopId, job.jobId))?.nextAction).toBe('CREATE_SHIPMENT');
    });
});
