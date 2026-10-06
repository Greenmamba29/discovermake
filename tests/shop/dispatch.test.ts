import { and, asc, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEV_SHOP_ID } from '@/server/db/seed';
import { domainEvents, inspectionPlans, manufacturingJobs, orders } from '@/server/db/schema';
import { buildInspectionChecks, dispatchOrder, estimateShopCostCents, expireStaleOffers, verifyPacket, withinTolerance } from '@/server/dispatch';
import { acceptJob, declineJob, getJob } from '@/server/shops';
import { useTestDb } from '../support/db';
import { createPaidOrder, createShopFixture, plateFeatures, quietConsole } from './fixtures';

describe('dispatch', () => {
    const ctx = useTestDb({ seed: true });
    let cheap: string;
    let tinyBed: string;
    let suspended: string;
    let noBrake: string;

    beforeAll(async () => {
        quietConsole();
        // Seeded Philadelphia Precision Works: fiber $150/h + press brake.
        cheap = (await createShopFixture(ctx.db, { name: 'Camden Cutters', fiberCentsPerHour: 9000, brake: true })).shopId;
        tinyBed = (await createShopFixture(ctx.db, { name: 'Tiny Bed Lasers', fiberCentsPerHour: 6000, brake: true, bed: { w: 100, h: 50 } })).shopId;
        suspended = (await createShopFixture(ctx.db, { name: 'Suspended Metal', fiberCentsPerHour: 5000, brake: true, status: 'SUSPENDED' })).shopId;
        noBrake = (await createShopFixture(ctx.db, { name: 'Flat Only Co', fiberCentsPerHour: 4000, brake: false })).shopId;
    });

    it('offers the job to the cheapest capable shop, signs the packet, plans QA and moves the order to DISPATCHED', async () => {
        const { order } = await createPaidOrder(ctx.db, { bend: true, quantity: 100, widthMm: 600, heightMm: 400 });
        const result = await dispatchOrder(order.id);
        expect(result).not.toBeNull();
        // tinyBed (bed too small), suspended (not ACTIVE) and noBrake (bending ordered) are not capable.
        expect(result!.shopId).toBe(cheap);
        expect(result!.offerExpiresAt.getTime()).toBeGreaterThan(Date.now() + 110 * 60_000);

        const [job] = await ctx.db.select().from(manufacturingJobs).where(eq(manufacturingJobs.id, result!.jobId));
        expect(job.status).toBe('OFFERED');
        expect(job.payoutCents).toBe(order.shopCostCents);
        expect(verifyPacket(job.packet)).toBe(true);
        expect(job.packet.shipTo).toEqual(order.shippingAddress);
        expect(job.packet.material.thicknessOptionId).toBe('thk_al5052_063');
        expect(job.packet.services.map((s) => s.id)).toEqual(['svc_bending']);

        const [plan] = await ctx.db.select().from(inspectionPlans).where(eq(inspectionPlans.jobId, job.id));
        expect(plan.checks.map((c) => c.id)).toEqual(expect.arrayContaining(['chk_bbox_w', 'chk_bbox_h', 'chk_hole_1', 'chk_bend_1', 'chk_count']));

        const [o] = await ctx.db.select().from(orders).where(eq(orders.id, order.id));
        expect(o.status).toBe('DISPATCHED');
        const events = await ctx.db.select().from(domainEvents).where(and(eq(domainEvents.orderId, order.id), eq(domainEvents.eventType, 'job.offered')));
        expect(events).toHaveLength(1);
        expect(events[0].payload).toMatchObject({ jobId: job.id, shopId: cheap, isRework: false });

        // Idempotent: a second dispatch returns the open offer.
        const again = await dispatchOrder(order.id);
        expect(again?.jobId).toBe(job.id);
        const jobs = await ctx.db.select().from(manufacturingJobs).where(eq(manufacturingJobs.orderId, order.id));
        expect(jobs).toHaveLength(1);
    });

    it('redacts the packet until the shop accepts, then serves a fresh signed DXF link', async () => {
        const { order } = await createPaidOrder(ctx.db);
        const d = await dispatchOrder(order.id);
        const before = await getJob(d!.shopId, d!.jobId);
        expect(before?.packet.files).toEqual([]);
        expect(before?.packet.shipTo).toBeNull();
        expect(before?.nextAction).toBe('ACCEPT_OR_DECLINE');
        const after = await acceptJob(d!.shopId, d!.jobId);
        expect(after.packet.files).toHaveLength(1);
        expect(after.packet.files[0].url).toMatch(/^http:\/\/localhost:3100\/api\/storage\/local\/parts\//);
        expect(after.packet.shipTo?.postalCode).toBe('19106');
        expect(after.nextAction).toBe('RECORD_MILESTONE');
        const [o] = await ctx.db.select().from(orders).where(eq(orders.id, order.id));
        expect(o.status).toBe('ACCEPTED');
        expect(o.shopId).toBe(d!.shopId);
    });

    it('re-dispatches to the next shop on decline and leaves the order PAID with no candidates left', async () => {
        const { order } = await createPaidOrder(ctx.db, { bend: true });
        const first = await dispatchOrder(order.id);
        // With bending ordered only Camden Cutters and the seeded Philadelphia shop are capable.
        const capable = [cheap, DEV_SHOP_ID];
        expect(capable).toContain(first!.shopId);
        const other = capable.find((s) => s !== first!.shopId)!;

        const declined = await declineJob(first!.shopId, first!.jobId, { reason: 'CAPACITY', note: 'Fully booked this week' });
        expect(declined.status).toBe('DECLINED');
        expect(declined.declineReason).toBe('CAPACITY');

        const jobs = await ctx.db.select().from(manufacturingJobs).where(eq(manufacturingJobs.orderId, order.id)).orderBy(asc(manufacturingJobs.createdAt));
        expect(jobs.map((j) => [j.shopId, j.status])).toEqual([
            [first!.shopId, 'DECLINED'],
            [other, 'OFFERED'],
        ]);
        expect(jobs[1].attempt).toBe(2);
        let [o] = await ctx.db.select().from(orders).where(eq(orders.id, order.id));
        expect(o.status).toBe('DISPATCHED');

        await declineJob(other, jobs[1].id, { reason: 'MATERIAL_UNAVAILABLE' });
        [o] = await ctx.db.select().from(orders).where(eq(orders.id, order.id));
        expect(o.status).toBe('PAID');
        expect(await dispatchOrder(order.id)).toBeNull();
        const types = (await ctx.db.select().from(domainEvents).where(eq(domainEvents.orderId, order.id))).map((e) => e.eventType);
        expect(types.filter((t) => t === 'job.declined')).toHaveLength(2);
        void tinyBed;
        void suspended;
        void noBrake;
    });

    it('expires stale offers and re-offers to another shop', async () => {
        const { order } = await createPaidOrder(ctx.db);
        const first = await dispatchOrder(order.id);
        await ctx.db.update(manufacturingJobs).set({ offerExpiresAt: new Date(Date.now() - 60_000) }).where(eq(manufacturingJobs.id, first!.jobId));

        // An expired offer cannot be accepted.
        await expect(acceptJob(first!.shopId, first!.jobId)).rejects.toMatchObject({ code: 'CONFLICT' });

        const expired = await expireStaleOffers();
        expect(expired).toBe(1);
        const jobs = await ctx.db.select().from(manufacturingJobs).where(eq(manufacturingJobs.orderId, order.id)).orderBy(asc(manufacturingJobs.createdAt));
        expect(jobs[0].status).toBe('EXPIRED');
        expect(jobs[1].status).toBe('OFFERED');
        expect(jobs[1].shopId).not.toBe(first!.shopId);
        const types = (await ctx.db.select().from(domainEvents).where(eq(domainEvents.orderId, order.id))).map((e) => e.eventType);
        expect(types).toContain('job.expired');
    });

    it('refuses to dispatch an order that is not PAID', async () => {
        const { order } = await createPaidOrder(ctx.db);
        await ctx.db.update(orders).set({ status: 'PENDING_PAYMENT' }).where(eq(orders.id, order.id));
        await expect(dispatchOrder(order.id)).rejects.toMatchObject({ code: 'CONFLICT' });
    });
});

describe('dispatch scoring + inspection plan (pure)', () => {
    it('estimates a lower cost on a cheaper rate card', () => {
        const req = {
            thicknessOptionId: 't',
            processId: 'p',
            processKind: 'FIBER_LASER' as const,
            bboxWidthMm: 100,
            bboxHeightMm: 50,
            cutLengthMm: 3000,
            pierceCount: 5,
            netAreaMm2: 5000,
            feedRateMmPerMin: 10000,
            pierceTimeS: 0.3,
            quantity: 10,
            bending: null,
            finished: false,
            quotedShopId: 'x',
        };
        const card = { fiberLaserCentsPerHour: 15000, co2LaserCentsPerHour: 9000, brakeCentsPerBend: 250, brakeSetupCents: 2000, orderSetupCents: 1500, partHandlingCents: 50, finishingCentsPerFt2: 350, finishBatchSetupCents: 3500, qaCentsPerPart: 25, packagingBaseCents: 400 };
        expect(estimateShopCostCents(req, { ...card, fiberLaserCentsPerHour: 9000 })).toBeLessThan(estimateShopCostCents(req, card));
    });

    it('derives critical dimensions, holes, finish and count checks from features', () => {
        const checks = buildInspectionChecks({ features: plateFeatures(), thicknessMm: 1.6, quantity: 25, serviceIds: [], finish: { name: 'Powder coat', colorName: 'Black' } });
        const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
        expect(byId.chk_bbox_w).toMatchObject({ kind: 'DIMENSION', nominalMm: 120, critical: true });
        expect(byId.chk_hole_1).toMatchObject({ kind: 'HOLE_DIAMETER', nominalMm: 6.35, critical: true });
        expect(byId.chk_flatness.kind).toBe('FLATNESS');
        expect(byId.chk_finish.label).toContain('Black');
        expect(byId.chk_count.label).toContain('25');
        expect(withinTolerance(byId.chk_bbox_w, 120.1)).toBe(true);
        expect(withinTolerance(byId.chk_bbox_w, 120.2)).toBe(false);
    });
});
