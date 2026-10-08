/**
 * Sourcing queue: frozen requests, leases, expiry, requeue, desk channel, and
 * concurrent next_job never double-leasing.
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { SourcingRequest } from '@/contracts/sourcing';
import { builds, domainEvents, sourcingJobs } from '@/server/db/schema';
import { newBuildDisplayId } from '@/server/ids';
import { SourcingError } from '@/server/sourcing/errors';
import { LEASE_TTL_MS } from '@/server/sourcing/constants';
import { cancelJob, completeJob, createSourcingJob, leaseNextJob, requeueJob, switchJobToDesk } from '@/server/sourcing/jobs';
import { submitOffer } from '@/server/sourcing/offers';
import { revokeSourcingClient } from '@/server/sourcing/clients';
import { useTestDb } from '../support/db';
import { ADMIN, bumpDesignVersion, createJobFixture, leaseJob, newClient, offerInput, quietConsole, supplierFor } from './fixtures';

async function expectCode(p: Promise<unknown>, code: string) {
    await expect(p).rejects.toBeInstanceOf(SourcingError);
    await p.catch((e: SourcingError) => expect(e.sourcingCode).toBe(code));
}

describe('sourcing jobs', () => {
    const ctx = useTestDb({ seed: true });
    beforeAll(() => quietConsole());

    it('freezes a SourcingRequest from the part and its latest quote, with bounds from the targets', async () => {
        const { job, build, part } = await createJobFixture(ctx.db, { quantity: 25, finish: true, targetUnitCostCents: 1800, targetDeliveryDate: '2099-01-31' });
        expect(job.status).toBe('QUEUED');
        expect(job.channel).toBe('accio');
        expect(job.displayId).toMatch(/^SRC-[0-9A-Z]{5}$/);
        const r = SourcingRequest.parse(job.request);
        expect(r.sourcing_request_id).toBe(job.id);
        expect(r.build_id).toBe(build.id);
        expect(r.part_id).toBe(part.id);
        expect(r.quantity).toBe(25);
        expect(r.material).toContain('Aluminum 5052-H32');
        expect(r.process).toEqual(['Fiber laser cutting', 'Powder coat · Black']);
        expect(r.surface_finish).toBe('Powder coat · Black');
        expect(r.dimensions_mm).toEqual({ x: 120, y: 80, z: 1.6 });
        expect(r.approval_policy).toMatchObject({ allow_purchase: false, allow_full_package: false, allow_sample_request: false, max_unit_price_cents: 1800 });
        expect(r.approval_policy.max_total_lead_days).toBeGreaterThan(1000);
        const [ev] = await ctx.db
            .select()
            .from(domainEvents)
            .where(and(eq(domainEvents.eventType, 'sourcing.requested'), eq(domainEvents.buildId, build.id)));
        expect(ev.payload).toMatchObject({ jobId: job.id, channel: 'accio', quantity: 25, designVersion: 1 });
    });

    it('needs material + process for builds without a quoted part, and rejects past target dates', async () => {
        const [build] = await ctx.db.insert(builds).values({ displayId: newBuildDisplayId(), name: 'Walnut lamp' }).returning();
        await expectCode(createSourcingJob({ buildId: build.id, quantity: 5, actor: ADMIN }), 'VALIDATION_FAILED');
        const { job } = await createSourcingJob({ buildId: build.id, quantity: 5, material: 'Black walnut', process: ['CNC routing'], actor: ADMIN });
        expect(job.request.part_id).toBeNull();
        expect(job.request.dimensions_mm).toBeNull();
        await expectCode(createSourcingJob({ buildId: build.id, quantity: 5, material: 'Oak', process: ['CNC'], targetDeliveryDate: '2001-01-01', actor: ADMIN }), 'VALIDATION_FAILED');
        await expectCode(createSourcingJob({ buildId: 'bld_doesnotexist', quantity: 5, material: 'Oak', process: ['CNC'], actor: ADMIN }), 'NOT_FOUND');
    });

    it('leases with a fresh uuid and 30-minute visibility timeout, emitting sourcing.job_leased', async () => {
        const { job } = await createJobFixture(ctx.db, { priority: 50 });
        const client = await newClient();
        const now = new Date();
        const lease = await leaseNextJob(client.clientId, { now });
        expect(lease.job?.id).toBe(job.id);
        expect(lease.leaseId).toMatch(/^[0-9a-f-]{36}$/);
        expect(lease.leaseExpiresAt?.getTime()).toBe(now.getTime() + LEASE_TTL_MS);
        expect(lease.job?.status).toBe('LEASED');
        expect(lease.job?.leaseCount).toBe(1);
        const [ev] = await ctx.db
            .select()
            .from(domainEvents)
            .where(and(eq(domainEvents.eventType, 'sourcing.job_leased'), eq(domainEvents.buildId, job.buildId)));
        expect(ev.payload).toMatchObject({ jobId: job.id, clientId: client.clientId });
    });

    it('filters by process', async () => {
        const [build] = await ctx.db.insert(builds).values({ displayId: newBuildDisplayId(), name: 'Anodized arm' }).returning();
        const { job } = await createSourcingJob({ buildId: build.id, quantity: 250, material: '6061-T6', process: ['CNC milling', 'Anodizing'], priority: 60, actor: ADMIN });
        const client = await newClient();
        expect((await leaseNextJob(client.clientId, { processes: ['injection molding'] })).job).toBeNull();
        expect((await leaseNextJob(client.clientId, { processes: ['cnc'] })).job?.id).toBe(job.id);
    });

    it('first write moves LEASED -> IN_PROGRESS and extends the lease; wrong lease or client is LEASE_INVALID', async () => {
        const { job } = await createJobFixture(ctx.db);
        const client = await newClient();
        const other = await newClient('other workspace');
        const { leaseId, writer } = await leaseJob(ctx.db, job.id, client.clientId);
        const [before] = await ctx.db.select().from(sourcingJobs).where(eq(sourcingJobs.id, job.id));
        await expectCode(supplierFor(job.id, { kind: 'agent', clientId: other.clientId, leaseId }), 'LEASE_INVALID');
        await expectCode(supplierFor(job.id, { kind: 'agent', clientId: client.clientId, leaseId: '00000000-0000-4000-8000-000000000000' }), 'LEASE_INVALID');
        await supplierFor(job.id, writer);
        const [after] = await ctx.db.select().from(sourcingJobs).where(eq(sourcingJobs.id, job.id));
        expect(before.status).toBe('LEASED');
        expect(after.status).toBe('IN_PROGRESS');
        expect(after.leaseExpiresAt!.getTime()).toBeGreaterThanOrEqual(before.leaseExpiresAt!.getTime());
    });

    it('returns expired leases to the queue; the old lease stops working', async () => {
        const { job } = await createJobFixture(ctx.db);
        const a = await newClient();
        const b = await newClient();
        const { writer } = await leaseJob(ctx.db, job.id, a.clientId);
        await ctx.db
            .update(sourcingJobs)
            .set({ leaseExpiresAt: new Date(Date.now() - 1000), priority: 1000 })
            .where(eq(sourcingJobs.id, job.id));
        await expectCode(supplierFor(job.id, writer), 'LEASE_INVALID');
        const again = await leaseNextJob(b.clientId);
        expect(again.job?.id).toBe(job.id);
        expect(again.job?.leaseCount).toBe(2);
        expect(again.job?.leasedByClientId).toBe(b.clientId);
        const released = await ctx.db
            .select()
            .from(domainEvents)
            .where(and(eq(domainEvents.eventType, 'sourcing.lease_released'), eq(domainEvents.buildId, job.buildId)));
        expect(released.map((e) => e.payload)).toEqual([{ jobId: job.id, reason: 'expired' }]);
        await ctx.db.update(sourcingJobs).set({ priority: 0 }).where(eq(sourcingJobs.id, job.id));
    });

    it('revoking a client returns its leases to the queue once; revoking again is a no-op', async () => {
        const { job } = await createJobFixture(ctx.db);
        const c = await newClient('revoked');
        await leaseJob(ctx.db, job.id, c.clientId);
        expect(await revokeSourcingClient(c.clientId)).toEqual({ releasedJobs: 1 });
        const [row] = await ctx.db.select().from(sourcingJobs).where(eq(sourcingJobs.id, job.id));
        expect(row).toMatchObject({ status: 'QUEUED', leaseId: null });
        expect(await revokeSourcingClient(c.clientId)).toEqual({ releasedJobs: 0 });
        const released = await ctx.db
            .select()
            .from(domainEvents)
            .where(and(eq(domainEvents.eventType, 'sourcing.lease_released'), eq(domainEvents.buildId, job.buildId)));
        expect(released.map((e) => e.payload)).toEqual([{ jobId: job.id, reason: 'client_revoked' }]);
    });

    it('concurrent next_job calls never lease the same job twice', async () => {
        // Drain whatever earlier tests left queued.
        const drain = await newClient('drain');
        while ((await leaseNextJob(drain.clientId)).job) {
            /* drain */
        }
        const jobs = await Promise.all([0, 1, 2].map(() => createJobFixture(ctx.db)));
        const clients = await Promise.all([0, 1, 2, 3, 4, 5, 6, 7].map((i) => newClient(`ws-${i}`)));
        const leases = await Promise.all(clients.map((c) => leaseNextJob(c.clientId)));
        const leased = leases.filter((l) => l.job).map((l) => l.job!.id);
        expect(leased.sort()).toEqual(jobs.map((j) => j.job.id).sort());
        expect(new Set(leased).size).toBe(3);
        expect(leases.filter((l) => !l.job)).toHaveLength(5);
    });

    it('ops can cancel, requeue and switch a job to the desk channel; desk jobs are never leased by agents', async () => {
        const { job } = await createJobFixture(ctx.db);
        const client = await newClient();
        await leaseJob(ctx.db, job.id, client.clientId);
        const desk = await switchJobToDesk(job.id, ADMIN);
        expect(desk).toMatchObject({ status: 'QUEUED', channel: 'desk', leaseId: null });
        await ctx.db.update(sourcingJobs).set({ priority: 1000 }).where(eq(sourcingJobs.id, job.id));
        expect((await leaseNextJob(client.clientId)).job?.id).not.toBe(job.id);
        const back = await requeueJob(job.id, ADMIN, { channel: 'accio' });
        expect(back.channel).toBe('accio');
        const cancelled = await cancelJob(job.id, ADMIN, { reason: 'buyer withdrew' });
        expect(cancelled.status).toBe('CANCELLED');
        expect(cancelled.summary).toContain('buyer withdrew');
        expect((await cancelJob(job.id, ADMIN)).status).toBe('CANCELLED');
        const requested = await ctx.db
            .select()
            .from(domainEvents)
            .where(and(eq(domainEvents.eventType, 'sourcing.requested'), eq(domainEvents.buildId, job.buildId)));
        expect(requested.map((e) => (e.payload as { channel: string }).channel).sort()).toEqual(['accio', 'accio', 'desk']);
        const cancelledEvents = await ctx.db
            .select()
            .from(domainEvents)
            .where(and(eq(domainEvents.eventType, 'sourcing.cancelled'), eq(domainEvents.buildId, job.buildId)));
        expect(cancelledEvents.map((e) => e.payload)).toEqual([{ jobId: job.id, reason: 'buyer withdrew' }]);
    });

    it('a job whose build moved to a newer design version cannot be requeued', async () => {
        const { job, part } = await createJobFixture(ctx.db);
        await cancelJob(job.id, ADMIN);
        await bumpDesignVersion(ctx.db, part.id);
        await expectCode(requeueJob(job.id, ADMIN), 'STALE_DESIGN_VERSION');
    });

    it('complete_job closes the job; needs_desk requeues it on the desk; offers_submitted needs an offer', async () => {
        const client = await newClient();
        const a = await createJobFixture(ctx.db);
        const la = await leaseJob(ctx.db, a.job.id, client.clientId);
        await expectCode(completeJob({ sourcing_request_id: a.job.id, outcome: 'offers_submitted', summary: 'done' }, la.writer), 'VALIDATION_FAILED');
        const s = await supplierFor(a.job.id, la.writer);
        await submitOffer(offerInput(a.job.id, s.id), la.writer);
        const done = await completeJob({ sourcing_request_id: a.job.id, outcome: 'offers_submitted', summary: 'One confirmed offer from Vietnam' }, la.writer);
        expect(done.job).toMatchObject({ status: 'COMPLETE', outcome: 'offers_submitted', leaseId: null });
        expect(done.offerCount).toBe(1);
        await expectCode(completeJob({ sourcing_request_id: a.job.id, outcome: 'no_viable_suppliers', summary: 'again' }, la.writer), 'LEASE_INVALID');

        const b = await createJobFixture(ctx.db);
        const lb = await leaseJob(ctx.db, b.job.id, client.clientId);
        const desk = await completeJob({ sourcing_request_id: b.job.id, outcome: 'needs_desk', summary: 'Needs a phone call' }, lb.writer);
        expect(desk.job).toMatchObject({ status: 'QUEUED', channel: 'desk' });
        const completed = await ctx.db
            .select()
            .from(domainEvents)
            .where(and(eq(domainEvents.eventType, 'sourcing.completed'), eq(domainEvents.buildId, b.job.buildId)));
        expect(completed[0].payload).toMatchObject({ outcome: 'needs_desk', offerCount: 0 });
    });
});
