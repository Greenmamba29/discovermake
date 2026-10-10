/**
 * Ops sourcing desk API (`/api/admin/sourcing/**`): auth, queue views, job detail,
 * cancel/requeue, approvals, and the desk fallback (suppliers + offers without MCP).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApprovalView, SourcingJobView, SupplierOfferView } from '@/contracts/sourcing';
import { GET as listJobsRoute, POST as createJobRoute } from '@/app/api/admin/sourcing/jobs/route';
import { GET as jobDetailRoute } from '@/app/api/admin/sourcing/jobs/[jobId]/route';
import { POST as cancelRoute } from '@/app/api/admin/sourcing/jobs/[jobId]/cancel/route';
import { POST as requeueRoute } from '@/app/api/admin/sourcing/jobs/[jobId]/requeue/route';
import { POST as deskSupplierRoute } from '@/app/api/admin/sourcing/jobs/[jobId]/suppliers/route';
import { POST as deskOfferRoute } from '@/app/api/admin/sourcing/jobs/[jobId]/offers/route';
import { GET as approvalsRoute } from '@/app/api/admin/sourcing/approvals/route';
import { POST as decisionRoute } from '@/app/api/admin/sourcing/approvals/[approvalId]/decision/route';
import { GET as clientsRoute } from '@/app/api/admin/sourcing/clients/route';
import { requestApproval } from '@/server/sourcing/approvals';
import { SourcingDocumentView, SourcingNegotiationView } from '@/server/sourcing/views';
import { useTestDb } from '../support/db';
import { createQuoteFixture } from '../shop/fixtures';
import { ADMIN_HEADERS, createJobFixture, leaseJob, newClient, offerInput, params, quietConsole, req, supplierFor } from './fixtures';

const JobDetail = z.object({
    job: SourcingJobView,
    offers: z.array(SupplierOfferView),
    approvals: z.array(ApprovalView),
    negotiations: z.array(SourcingNegotiationView),
    documents: z.array(SourcingDocumentView),
});

describe('admin sourcing routes', () => {
    const ctx = useTestDb({ seed: true });
    beforeAll(() => quietConsole());

    it('every route requires the admin token', async () => {
        const id = 'src_x';
        const checks: Promise<Response>[] = [
            listJobsRoute(req('/api/admin/sourcing/jobs'), params({})),
            createJobRoute(req('/api/admin/sourcing/jobs', { method: 'POST', body: {} }), params({})),
            jobDetailRoute(req(`/api/admin/sourcing/jobs/${id}`), params({ jobId: id })),
            cancelRoute(req(`/api/admin/sourcing/jobs/${id}/cancel`, { method: 'POST' }), params({ jobId: id })),
            requeueRoute(req(`/api/admin/sourcing/jobs/${id}/requeue`, { method: 'POST' }), params({ jobId: id })),
            deskSupplierRoute(req(`/api/admin/sourcing/jobs/${id}/suppliers`, { method: 'POST', body: {} }), params({ jobId: id })),
            deskOfferRoute(req(`/api/admin/sourcing/jobs/${id}/offers`, { method: 'POST', body: {} }), params({ jobId: id })),
            approvalsRoute(req('/api/admin/sourcing/approvals'), params({})),
            decisionRoute(req('/api/admin/sourcing/approvals/apr_x/decision', { method: 'POST', body: { decision: 'APPROVED' } }), params({ approvalId: 'apr_x' })),
            clientsRoute(req('/api/admin/sourcing/clients'), params({})),
        ];
        for (const r of await Promise.all(checks)) expect(r.status).toBe(401);
    });

    it('creates a job for a build (SourcingJobView back), lists and filters the queue', async () => {
        const { build, part } = await createQuoteFixture(ctx.db, { quantity: 20 });
        const res = await createJobRoute(req('/api/admin/sourcing/jobs', { method: 'POST', headers: ADMIN_HEADERS, body: { buildId: build.id, partId: part.id, quantity: 20, notes: 'Desk request' } }), params({}));
        expect(res.status).toBe(201);
        const job = SourcingJobView.parse(await res.json());
        expect(job).toMatchObject({ buildId: build.id, status: 'QUEUED', channel: 'accio', offerCount: 0, pendingApprovalCount: 0 });
        expect(job.request.notes).toBe('Desk request');
        const desk = await createJobRoute(req('/api/admin/sourcing/jobs', { method: 'POST', headers: ADMIN_HEADERS, body: { buildId: build.id, quantity: 5, channel: 'desk' } }), params({}));
        expect(SourcingJobView.parse(await desk.json()).channel).toBe('desk');
        expect((await createJobRoute(req('/api/admin/sourcing/jobs', { method: 'POST', headers: ADMIN_HEADERS, body: { quantity: 5 } }), params({}))).status).toBe(400);

        const queued = z.array(SourcingJobView).parse(await (await listJobsRoute(req('/api/admin/sourcing/jobs?status=QUEUED,LEASED', { headers: ADMIN_HEADERS }), params({}))).json());
        expect(queued.map((j) => j.id)).toContain(job.id);
        const deskOnly = z.array(SourcingJobView).parse(await (await listJobsRoute(req('/api/admin/sourcing/jobs?channel=desk', { headers: ADMIN_HEADERS }), params({}))).json());
        expect(deskOnly.every((j) => j.channel === 'desk')).toBe(true);
        const none = z.array(SourcingJobView).parse(await (await listJobsRoute(req('/api/admin/sourcing/jobs?status=COMPLETE', { headers: ADMIN_HEADERS }), params({}))).json());
        expect(none.map((j) => j.id)).not.toContain(job.id);
        expect((await listJobsRoute(req('/api/admin/sourcing/jobs?status=BOGUS', { headers: ADMIN_HEADERS }), params({}))).status).toBe(400);
    });

    it('desk fallback: ops register a supplier and an offer without a lease, then see the full job detail', async () => {
        const { job } = await createJobFixture(ctx.db);
        const sup = await deskSupplierRoute(
            req(`/api/admin/sourcing/jobs/${job.id}/suppliers`, {
                method: 'POST',
                headers: ADMIN_HEADERS,
                body: { name: 'Called-in Fabricator', platform: 'direct', country: 'US', verified: false, evidence: [{ kind: 'website', url: 'https://example.com', note: 'Phone quote' }] },
            }),
            params({ jobId: job.id }),
        );
        expect(sup.status).toBe(201);
        const { supplierId } = await sup.json();
        const { sourcing_request_id: _omit, ...body } = offerInput(job.id, supplierId, { idempotency_key: 'desk-quote-0001' });
        void _omit;
        const off = await deskOfferRoute(req(`/api/admin/sourcing/jobs/${job.id}/offers`, { method: 'POST', headers: ADMIN_HEADERS, body }), params({ jobId: job.id }));
        expect(off.status).toBe(201);
        const offer = SupplierOfferView.parse(await off.json());
        expect(offer).toMatchObject({ trustLevel: 'SUPPLIER_CONFIRMED', supplier: { name: 'Called-in Fabricator', platform: 'direct' } });
        const retry = await deskOfferRoute(req(`/api/admin/sourcing/jobs/${job.id}/offers`, { method: 'POST', headers: ADMIN_HEADERS, body }), params({ jobId: job.id }));
        expect(retry.status).toBe(200);
        const stale = await deskOfferRoute(req(`/api/admin/sourcing/jobs/${job.id}/offers`, { method: 'POST', headers: ADMIN_HEADERS, body: { ...body, idempotency_key: 'desk-quote-0002', design_version: 3 } }), params({ jobId: job.id }));
        expect(stale.status).toBe(409);
        expect((await stale.json()).error.details.sourcingCode).toBe('STALE_DESIGN_VERSION');

        const detail = JobDetail.parse(await (await jobDetailRoute(req(`/api/admin/sourcing/jobs/${job.id}`, { headers: ADMIN_HEADERS }), params({ jobId: job.id }))).json());
        expect(detail.job.offerCount).toBe(1);
        expect(detail.offers[0].id).toBe(offer.id);
        expect(detail.job.status).toBe('QUEUED'); // desk writes do not lease
        expect((await jobDetailRoute(req('/api/admin/sourcing/jobs/src_missing', { headers: ADMIN_HEADERS }), params({ jobId: 'src_missing' }))).status).toBe(404);
    });

    it('approvals queue and decisions; cancel and requeue', async () => {
        const { job } = await createJobFixture(ctx.db);
        const client = await newClient();
        const { writer } = await leaseJob(ctx.db, job.id, client.clientId);
        const s = await supplierFor(job.id, writer);
        const { approval } = await requestApproval({ sourcing_request_id: job.id, kind: 'RELEASE_FULL_PACKAGE', supplier_id: s.id, reason: 'Needs CAD', details: {} }, writer);

        const pending = z.array(ApprovalView).parse(await (await approvalsRoute(req('/api/admin/sourcing/approvals?status=PENDING', { headers: ADMIN_HEADERS }), params({}))).json());
        expect(pending.map((a) => a.id)).toContain(approval.id);
        const decided = await decisionRoute(
            req(`/api/admin/sourcing/approvals/${approval.id}/decision`, { method: 'POST', headers: ADMIN_HEADERS, body: { decision: 'APPROVED', note: 'NDA on file' } }),
            params({ approvalId: approval.id }),
        );
        expect(decided.status).toBe(200);
        expect(ApprovalView.parse(await decided.json())).toMatchObject({ status: 'APPROVED', decidedBy: 'admin:ops', decisionNote: 'NDA on file' });
        expect((await decisionRoute(req(`/api/admin/sourcing/approvals/${approval.id}/decision`, { method: 'POST', headers: ADMIN_HEADERS, body: { decision: 'MAYBE' } }), params({ approvalId: approval.id }))).status).toBe(400);

        const desk = await requeueRoute(req(`/api/admin/sourcing/jobs/${job.id}/requeue`, { method: 'POST', headers: ADMIN_HEADERS, body: { channel: 'desk' } }), params({ jobId: job.id }));
        expect(SourcingJobView.parse(await desk.json())).toMatchObject({ status: 'QUEUED', channel: 'desk', leaseExpiresAt: null });
        const cancelled = await cancelRoute(req(`/api/admin/sourcing/jobs/${job.id}/cancel`, { method: 'POST', headers: ADMIN_HEADERS }), params({ jobId: job.id }));
        expect(SourcingJobView.parse(await cancelled.json()).status).toBe('CANCELLED');
    });
});
