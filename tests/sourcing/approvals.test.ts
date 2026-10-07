/**
 * Every APPROVAL_REQUIRED path, human approval decisions, supplier selection, and the
 * buyer view (which never exposes the supplier identity).
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { BuildSourcingView, RouteOfferView } from '@/contracts/sourcing';
import { domainEvents, quotes, sourcingAccessLog, sourcingJobs, supplierOffers } from '@/server/db/schema';
import { ApiError } from '@/server/http';
import { decideApproval, listApprovals, requestApproval } from '@/server/sourcing/approvals';
import { getAttachments } from '@/server/sourcing/attachments';
import { enforceBoundary } from '@/server/sourcing/boundary';
import { SourcingError } from '@/server/sourcing/errors';
import { updateNegotiation } from '@/server/sourcing/negotiations';
import { submitOffer } from '@/server/sourcing/offers';
import { BOUNDARY_RULES, type AgentAction } from '@/server/sourcing/policy';
import { GET as buyerGet, POST as buyerPost } from '@/app/api/builds/[buildId]/sourcing/route';
import { POST as buyerSelect } from '@/app/api/builds/[buildId]/sourcing/offers/[offerId]/select/route';
import { useTestDb } from '../support/db';
import { ADMIN, bumpDesignVersion, createJobFixture, leaseJob, newClient, offerInput, params, quietConsole, req, supplierFor } from './fixtures';

async function rejectsWith(p: Promise<unknown>) {
    return p.then(
        () => {
            throw new Error('expected a rejection');
        },
        (e: unknown) => e,
    );
}

describe('sourcing approvals + buyer view', () => {
    const ctx = useTestDb({ seed: true });
    beforeAll(() => quietConsole());

    async function leased() {
        const f = await createJobFixture(ctx.db);
        const client = await newClient();
        const lease = await leaseJob(ctx.db, f.job.id, client.clientId);
        const supplier = await supplierFor(f.job.id, lease.writer);
        return { ...f, client, supplier, ...lease };
    }

    async function blockedEvents(jobId: string) {
        const rows = await ctx.db.select().from(domainEvents).where(eq(domainEvents.eventType, 'sourcing.boundary_blocked'));
        return rows.map((r) => r.payload as { jobId: string; approvalKind: string; tool: string }).filter((p) => p.jobId === jobId);
    }

    it('every human-only or gated action is APPROVAL_REQUIRED with its kind, and is recorded', async () => {
        const { job, client } = await leased();
        const actor = { kind: 'sourcing_agent', id: client.clientId } as const;
        const gated: AgentAction[] = ['fetch_full_package', 'request_sample', 'pay_deposit', 'place_purchase_order', 'approve_tooling', 'start_production', 'change_compliance', 'change_tolerance', 'change_material', 'select_offer'];
        for (const action of gated) {
            const err = await rejectsWith(enforceBoundary(action, { job, actor, tool: `probe:${action}`, supplierId: 'sup_any' }));
            expect(err, action).toBeInstanceOf(SourcingError);
            expect((err as SourcingError).sourcingCode).toBe('APPROVAL_REQUIRED');
            expect((err as SourcingError).approvalKind).toBe((BOUNDARY_RULES[action] as { approvalKind: string }).approvalKind);
            expect((err as SourcingError).toToolError().error.approval_kind).toBe((err as SourcingError).approvalKind);
        }
        const recorded = await blockedEvents(job.id);
        expect(recorded.map((r) => r.approvalKind).sort()).toEqual(
            ['RELEASE_FULL_PACKAGE', 'REQUEST_SAMPLE', 'PAY_DEPOSIT', 'PLACE_PURCHASE_ORDER', 'APPROVE_TOOLING', 'START_PRODUCTION', 'CHANGE_COMPLIANCE', 'ACCEPT_TOLERANCE_CHANGE', 'ACCEPT_MATERIAL_SUBSTITUTION', 'SELECT_SUPPLIER_OFFER'].sort(),
        );
    });

    it('get_attachments FULL needs an APPROVED RELEASE_FULL_PACKAGE for that exact supplier', async () => {
        const { job, client, leaseId, writer, supplier, part } = await leased();
        const other = await supplierFor(job.id, writer, { country: 'CN' });
        const full = { sourcing_request_id: job.id, lease_id: leaseId, tier: 'FULL' as const };
        const noSupplier = await rejectsWith(getAttachments(full, client.clientId));
        expect((noSupplier as SourcingError).approvalKind).toBe('RELEASE_FULL_PACKAGE');
        expect((await rejectsWith(getAttachments({ ...full, supplier_id: supplier.id }, client.clientId)) as SourcingError).sourcingCode).toBe('APPROVAL_REQUIRED');

        const { approval } = await requestApproval({ sourcing_request_id: job.id, kind: 'RELEASE_FULL_PACKAGE', supplier_id: supplier.id, reason: 'Supplier needs the DXF to confirm', details: {} }, writer);
        expect(approval).toMatchObject({ status: 'PENDING', approverRole: 'ops' });
        expect((await rejectsWith(getAttachments({ ...full, supplier_id: supplier.id }, client.clientId)) as SourcingError).sourcingCode).toBe('APPROVAL_REQUIRED');
        await decideApproval(approval.id, { decision: 'APPROVED' }, ADMIN);
        expect((await rejectsWith(getAttachments({ ...full, supplier_id: other.id }, client.clientId)) as SourcingError).sourcingCode).toBe('APPROVAL_REQUIRED');

        const files = await getAttachments({ ...full, supplier_id: supplier.id }, client.clientId);
        expect(files.find((f) => f.tier === 'FULL')?.name).toBe(part.filename);
        const log = await ctx.db.select().from(sourcingAccessLog).where(and(eq(sourcingAccessLog.jobId, job.id), eq(sourcingAccessLog.tier, 'FULL')));
        expect(log).toHaveLength(1);
        expect(log[0]).toMatchObject({ supplierId: supplier.id, fileKey: part.fileKey });
        expect((await blockedEvents(job.id)).filter((b) => b.tool === 'get_attachments')).toHaveLength(4);
    });

    it('update_negotiation is APPROVAL_REQUIRED when the job policy disallows negotiation', async () => {
        const { job, writer, supplier } = await leased();
        await ctx.db
            .update(sourcingJobs)
            .set({ approvalPolicy: { ...job.approvalPolicy, allow_negotiation: false } })
            .where(eq(sourcingJobs.id, job.id));
        const err = (await rejectsWith(updateNegotiation({ sourcing_request_id: job.id, supplier_id: supplier.id, status: 'negotiating', note: 'try' }, writer))) as SourcingError;
        expect(err.sourcingCode).toBe('APPROVAL_REQUIRED');
        expect(err.approvalKind).toBeUndefined();
    });

    it('agents can only request approvals; humans decide; agents and the system never can', async () => {
        const { job, writer, supplier, client } = await leased();
        const po = await requestApproval({ sourcing_request_id: job.id, kind: 'PLACE_PURCHASE_ORDER', supplier_id: supplier.id, reason: 'Supplier wants a PO', details: { amountCents: 70000 } }, writer);
        expect(po.created).toBe(true);
        expect(po.approval.status).toBe('PENDING');
        const again = await requestApproval({ sourcing_request_id: job.id, kind: 'PLACE_PURCHASE_ORDER', supplier_id: supplier.id, reason: 'again', details: {} }, writer);
        expect(again).toMatchObject({ created: false, approval: { id: po.approval.id } });
        await expect(requestApproval({ sourcing_request_id: job.id, kind: 'PAY_DEPOSIT', reason: 'no supplier', details: {} }, writer)).rejects.toMatchObject({ sourcingCode: 'VALIDATION_FAILED' });
        await expect(requestApproval({ sourcing_request_id: job.id, kind: 'SELECT_SUPPLIER_OFFER', reason: 'no offer', details: {} }, writer)).rejects.toMatchObject({ sourcingCode: 'VALIDATION_FAILED' });

        const tol = await requestApproval({ sourcing_request_id: job.id, kind: 'ACCEPT_TOLERANCE_CHANGE', reason: '±0.2 instead of ±0.1', details: {} }, writer);
        expect(tol.approval.approverRole).toBe('customer');

        for (const actor of [
            { kind: 'sourcing_agent', id: client.clientId },
            { kind: 'system', id: 'discovermake' },
            { kind: 'buyer', id: `guest:${job.buildId}` }, // ops approval: buyer may not decide
        ] as const) {
            const err = await rejectsWith(decideApproval(po.approval.id, { decision: 'APPROVED' }, actor));
            expect(err).toBeInstanceOf(ApiError);
            expect((err as ApiError).code).toBe('FORBIDDEN');
        }
        // The buyer decides customer approvals on their own build only.
        await expect(decideApproval(tol.approval.id, { decision: 'REJECTED' }, { kind: 'buyer', id: 'guest:bld_someoneelse' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
        const rejected = await decideApproval(tol.approval.id, { decision: 'REJECTED', note: 'Keep ±0.1' }, { kind: 'buyer', id: `guest:${job.buildId}` });
        expect(rejected).toMatchObject({ status: 'REJECTED', decisionNote: 'Keep ±0.1', decidedBy: `buyer:guest:${job.buildId}` });

        const decided = await decideApproval(po.approval.id, { decision: 'REJECTED', note: 'Not yet' }, ADMIN);
        expect(decided.status).toBe('REJECTED');
        expect((await decideApproval(po.approval.id, { decision: 'REJECTED' }, ADMIN)).status).toBe('REJECTED');
        await expect(decideApproval(po.approval.id, { decision: 'APPROVED' }, ADMIN)).rejects.toMatchObject({ sourcingCode: 'CONFLICT' });
        const decidedEvents = await ctx.db
            .select()
            .from(domainEvents)
            .where(and(eq(domainEvents.eventType, 'sourcing.approval_decided'), eq(domainEvents.buildId, job.buildId)));
        expect(decidedEvents).toHaveLength(2);
        expect((await listApprovals({ statuses: ['PENDING'], jobId: job.id })).length).toBe(0);
    });

    it('approving SELECT_SUPPLIER_OFFER selects the offer, rejects the others and emits supplier.selected', async () => {
        const { job, writer, supplier } = await leased();
        const s2 = await supplierFor(job.id, writer, { country: 'CN', verified: false });
        const a = await submitOffer(offerInput(job.id, supplier.id), writer);
        const b = await submitOffer(offerInput(job.id, s2.id, { unit_price_cents: 650 }), writer);
        const selA = await requestApproval({ sourcing_request_id: job.id, kind: 'SELECT_SUPPLIER_OFFER', supplier_offer_id: a.offer.id, reason: 'Best lead time', details: {} }, writer);
        const selB = await requestApproval({ sourcing_request_id: job.id, kind: 'SELECT_SUPPLIER_OFFER', supplier_offer_id: b.offer.id, reason: 'Cheapest', details: {} }, writer);
        expect(selA.approval).toMatchObject({ approverRole: 'customer', supplierId: supplier.id });

        await decideApproval(selA.approval.id, { decision: 'APPROVED' }, ADMIN);
        const offers = await ctx.db.select().from(supplierOffers).where(eq(supplierOffers.jobId, job.id));
        expect(offers.find((o) => o.id === a.offer.id)?.status).toBe('SELECTED');
        expect(offers.find((o) => o.id === b.offer.id)?.status).toBe('REJECTED');
        const [cancelled] = await listApprovals({ jobId: job.id, statuses: ['CANCELLED'] });
        expect(cancelled.id).toBe(selB.approval.id);
        const [selected] = await ctx.db
            .select()
            .from(domainEvents)
            .where(and(eq(domainEvents.eventType, 'supplier.selected'), eq(domainEvents.buildId, job.buildId)));
        expect(selected.payload).toMatchObject({ jobId: job.id, offerId: a.offer.id, approvalId: selA.approval.id, buildId: job.buildId });
        // Selection does not create a checkout: quotes are untouched.
        expect((await ctx.db.select().from(quotes).where(eq(quotes.buildId, job.buildId))).every((q) => q.status === 'READY')).toBe(true);
    });

    it('buyer view hides the supplier identity and computes totals in cents', async () => {
        const { job, writer, build } = await leased();
        const s = await supplierFor(job.id, writer, { name: 'Hanoi Laser Works Co.', country: 'VN', verified: true });
        const s2 = await supplierFor(job.id, writer, { name: 'Ningbo Metal Factory', country: 'CN', verified: false });
        await submitOffer(offerInput(job.id, s.id, { unit_price_cents: 700, tooling_cents: 5000, shipping_cents: 2500 }), writer);
        await submitOffer(offerInput(job.id, s2.id, { unit_price_cents: 600, shipping_cents: null, incoterm: 'FOB', negotiation_status: 'supplier-estimate' }), writer);

        const res = await buyerGet(req(`/api/builds/${build.id}/sourcing`), params({ buildId: build.id }));
        expect(res.status).toBe(200);
        const raw = await res.text();
        expect(raw).not.toContain('Hanoi');
        expect(raw).not.toContain('Ningbo');
        expect(raw.toLowerCase()).not.toContain('alibaba');
        expect(raw).not.toContain(s.id);
        const view = BuildSourcingView.parse(JSON.parse(raw));
        expect(view.jobs.map((j) => j.id)).toContain(job.id);
        expect(view.offers).toHaveLength(2);
        const [cheap, vn] = view.offers;
        expect(cheap).toMatchObject({ label: 'Partner · China', totalCents: 6000, shippingIncluded: false, trustLevel: 'SUPPLIER_ESTIMATE', selection: null });
        expect(vn).toMatchObject({ label: 'Verified partner · Vietnam', totalCents: 700 * 10 + 5000 + 2500, shippingIncluded: true, totalLeadDays: 16, trustLevel: 'SUPPLIER_CONFIRMED' });
        for (const o of view.offers) expect(Object.keys(o)).not.toEqual(expect.arrayContaining(['supplier', 'name', 'platform']));
    });

    it('buyer selection only accepts ACTIVE, SUPPLIER_CONFIRMED offers and is idempotent', async () => {
        const { job, writer, build } = await leased();
        const s = await supplierFor(job.id, writer);
        const conf = await submitOffer(offerInput(job.id, s.id), writer);
        const est = await submitOffer(offerInput(job.id, s.id, { idempotency_key: 'estimate-select-1', negotiation_status: 'supplier-estimate' }), writer);

        const bad = await buyerSelect(req(`/api/builds/${build.id}/sourcing/offers/${est.offer.id}/select`, { method: 'POST' }), params({ buildId: build.id, offerId: est.offer.id }));
        expect(bad.status).toBe(409);
        const wrongBuild = await buyerSelect(req(`/api/builds/bld_other/sourcing/offers/${conf.offer.id}/select`, { method: 'POST' }), params({ buildId: 'bld_other', offerId: conf.offer.id }));
        expect(wrongBuild.status).toBe(404);

        const first = await buyerSelect(req(`/api/builds/${build.id}/sourcing/offers/${conf.offer.id}/select`, { method: 'POST' }), params({ buildId: build.id, offerId: conf.offer.id }));
        expect(first.status).toBe(201);
        const view = RouteOfferView.parse(await first.json());
        expect(view.selection?.status).toBe('PENDING');
        const second = await buyerSelect(req(`/api/builds/${build.id}/sourcing/offers/${conf.offer.id}/select`, { method: 'POST' }), params({ buildId: build.id, offerId: conf.offer.id }));
        expect(second.status).toBe(200);
        expect(RouteOfferView.parse(await second.json()).selection?.approvalId).toBe(view.selection?.approvalId);
        const [approval] = await listApprovals({ jobId: job.id, statuses: ['PENDING'] });
        expect(approval).toMatchObject({ kind: 'SELECT_SUPPLIER_OFFER', approverRole: 'ops', requestedBy: `buyer:guest:${build.id}` });

        // Ops confirms -> SELECTED.
        await decideApproval(approval.id, { decision: 'APPROVED' }, ADMIN);
        const [after] = (await (await buyerGet(req(`/api/builds/${build.id}/sourcing`), params({ buildId: build.id }))).json()).offers.filter((o: { id: string }) => o.id === conf.offer.id);
        expect(after.status).toBe('SELECTED');

        // A design change makes remaining offers stale and unselectable.
        const other = await createJobFixture(ctx.db);
        const c2 = await newClient();
        const l2 = await leaseJob(ctx.db, other.job.id, c2.clientId);
        const s2 = await supplierFor(other.job.id, l2.writer);
        const o2 = await submitOffer(offerInput(other.job.id, s2.id), l2.writer);
        await bumpDesignVersion(ctx.db, other.part.id);
        const stale = await buyerSelect(req(`/api/builds/${other.build.id}/sourcing/offers/${o2.offer.id}/select`, { method: 'POST' }), params({ buildId: other.build.id, offerId: o2.offer.id }));
        expect(stale.status).toBe(409);
        expect((await stale.json()).error.details.sourcingCode).toBe('STALE_DESIGN_VERSION');
    });

    it('buyer POST queues one job per part/version/quantity and validates input', async () => {
        const f = await createJobFixture(ctx.db, { quantity: 40 });
        await ctx.db.update(sourcingJobs).set({ status: 'CANCELLED' }).where(eq(sourcingJobs.id, f.job.id));
        const body = { partId: f.part.id, quantity: 40, targetRegions: ['vn', 'CN'] };
        const headers = { 'x-real-ip': '203.0.113.7' };
        const r1 = await buyerPost(req(`/api/builds/${f.build.id}/sourcing`, { method: 'POST', body, headers }), params({ buildId: f.build.id }));
        expect(r1.status).toBe(201);
        const j1 = await r1.json();
        expect(j1).toMatchObject({ status: 'QUEUED', quantity: 40, designVersion: 1 });
        const r2 = await buyerPost(req(`/api/builds/${f.build.id}/sourcing`, { method: 'POST', body, headers }), params({ buildId: f.build.id }));
        expect(r2.status).toBe(200);
        expect((await r2.json()).id).toBe(j1.id);
        const [job] = await ctx.db.select().from(sourcingJobs).where(eq(sourcingJobs.id, j1.id));
        expect(job.request.target_regions).toEqual(['VN', 'CN']);
        expect(job.createdBy).toBe(`buyer:guest:${f.build.id}`);
        const bad = await buyerPost(req(`/api/builds/${f.build.id}/sourcing`, { method: 'POST', body: { quantity: -1 }, headers }), params({ buildId: f.build.id }));
        expect(bad.status).toBe(400);
        const missing = await buyerPost(req('/api/builds/bld_nope/sourcing', { method: 'POST', body, headers }), params({ buildId: 'bld_nope' }));
        expect(missing.status).toBe(404);
        // 5 per minute per IP.
        const statuses: number[] = [];
        for (let i = 0; i < 3; i++) statuses.push((await buyerPost(req(`/api/builds/${f.build.id}/sourcing`, { method: 'POST', body, headers }), params({ buildId: f.build.id }))).status);
        expect(statuses).toEqual([200, 429, 429]);
    });
});
