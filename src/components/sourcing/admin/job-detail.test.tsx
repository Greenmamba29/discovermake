// @vitest-environment jsdom
/**
 * Sourcing job detail: full supplier identity for ops, approvals at the boundary, job
 * controls, and the desk fallback forms (MCP inputs minus the lease, money in cents).
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SourcingJobView } from '@/contracts';
import { approvalView, sourcingJobView, supplierOfferView } from '../../__fixtures__/contracts';
import { ADMIN_TOKEN_KEY } from './admin-gate';
import { SourcingJobDetailScreen, offerTotalCents } from './job-detail';

type Call = { method: string; url: string; body: unknown };
let calls: Call[];
let job: SourcingJobView;

beforeEach(() => {
    calls = [];
    job = sourcingJobView();
    window.sessionStorage.setItem(ADMIN_TOKEN_KEY, 'good-token');
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            const method = init?.method ?? 'GET';
            calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null });
            const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
            if (url === '/api/admin/sourcing/jobs/src_job1' && method === 'GET')
                return ok({
                    job,
                    offers: [supplierOfferView(), supplierOfferView({ id: 'off_est', trustLevel: 'SUPPLIER_ESTIMATE', exceptions: ['Tolerance ±0.2 instead of ±0.1'], shippingCents: null })],
                    approvals: [approvalView({ id: 'apr_done', status: 'APPROVED', decidedBy: 'admin', decisionNote: 'ok', createdAt: '2026-10-05T12:00:00.000Z' }), approvalView()],
                    negotiations: [{ id: 'neg_1', supplierId: 'sup_hanoi', status: 'negotiating', notes: [{ at: '2026-10-06T12:00:00.000Z', status: 'negotiating', note: 'Asked for 5% off at 1k' }] }],
                    documents: [{ id: 'sdoc_1', kind: 'QUOTE', filename: 'quote.pdf', supplierId: 'sup_hanoi', sizeBytes: 20480, createdAt: '2026-10-06T12:00:00.000Z' }],
                });
            if (url === '/api/admin/sourcing/jobs/src_job1/cancel') {
                job = { ...job, status: 'CANCELLED' };
                return ok(job);
            }
            if (url === '/api/admin/sourcing/jobs/src_job1/suppliers') return ok({ supplier_id: 'sup_new' }, 201);
            if (url === '/api/admin/sourcing/jobs/src_job1/offers') return ok({ offer_id: 'off_new' }, 201);
            if (url.startsWith('/api/admin/sourcing/approvals/')) return ok(approvalView({ status: 'REJECTED' }));
            return ok({ error: { code: 'NOT_FOUND', message: 'nope' } }, 404);
        }),
    );
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
});

function renderDetail() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <SourcingJobDetailScreen jobId="src_job1" />
        </QueryClientProvider>,
    );
}

describe('SourcingJobDetailScreen', () => {
    it('shows the request, offers with supplier identity, negotiations, documents and approvals', async () => {
        renderDetail();
        const table = await screen.findByTestId('desk-offers-table');
        const row = within(table).getByTestId('desk-offer-off_confirmed');
        expect(row.textContent).toContain('Hanoi Precision Metal Co.');
        expect(row.textContent).toContain('alibaba · VN');
        expect(row.textContent).toContain('$2,170.00');
        expect(within(row).getByTestId('desk-offer-trust-off_confirmed').textContent).toContain('Supplier-confirmed');
        expect(within(table).getByTestId('desk-offer-off_est').textContent).toContain('Tolerance ±0.2 instead of ±0.1');

        expect(screen.getByText('Sensor bracket')).toBeTruthy();
        expect(screen.getByText(/Asked for 5% off at 1k/)).toBeTruthy();
        expect(screen.getByText('quote.pdf')).toBeTruthy();
        // Pending approvals are listed before decided ones.
        const cards = screen.getAllByTestId(/^approval-apr_/);
        expect(cards.map((c) => c.getAttribute('data-testid'))).toEqual(['approval-apr_1', 'approval-apr_done']);
        expect(within(cards[1]).queryByTestId('approve-apr_done')).toBeNull();
    });

    it('rejects an approval and cancels the job', async () => {
        renderDetail();
        const card = await screen.findByTestId('approval-apr_1');
        fireEvent.click(within(card).getByTestId('reject-apr_1'));
        await act(async () => {
            fireEvent.click(within(card).getByTestId('reject-apr_1-confirm'));
        });
        expect(calls.find((c) => c.url.endsWith('/approvals/apr_1/decision'))?.body).toEqual({ decision: 'REJECTED' });

        fireEvent.click(screen.getByTestId('job-cancel'));
        await act(async () => {
            fireEvent.click(screen.getByTestId('job-cancel-confirm'));
        });
        await waitFor(() => expect(screen.getByTestId('job-status').textContent).toBe('CANCELLED'));
        expect(screen.queryByTestId('job-cancel')).toBeNull();
    });

    it('desk fallback: adds a supplier, then its offer in cents without a lease', async () => {
        renderDetail();
        const supplierForm = await screen.findByTestId('desk-supplier-form');
        fireEvent.change(within(supplierForm).getByTestId('desk-supplier-name'), { target: { value: 'Shenzhen Laser Works' } });
        fireEvent.change(within(supplierForm).getByTestId('desk-supplier-country'), { target: { value: 'cn' } });
        await act(async () => {
            fireEvent.click(within(supplierForm).getByTestId('desk-supplier-submit'));
        });
        const sup = calls.find((c) => c.url.endsWith('/suppliers'));
        expect(sup?.body).toMatchObject({ sourcing_request_id: 'src_job1', name: 'Shenzhen Laser Works', platform: 'alibaba', country: 'CN', verified: false });
        expect(sup?.body).not.toHaveProperty('lease_id');
        expect(within(supplierForm).getByText(/sup_new/)).toBeTruthy();

        const offerForm = screen.getByTestId('desk-offer-form');
        fireEvent.change(within(offerForm).getByTestId('desk-offer-supplier'), { target: { value: 'sup_new' } });
        fireEvent.change(within(offerForm).getByTestId('desk-offer-unit'), { target: { value: '2.95' } });
        fireEvent.change(within(offerForm).getByTestId('desk-offer-prod-days'), { target: { value: '12' } });
        fireEvent.change(within(offerForm).getByTestId('desk-offer-ship-days'), { target: { value: '9' } });
        await act(async () => {
            fireEvent.click(within(offerForm).getByTestId('desk-offer-submit'));
        });
        const off = calls.find((c) => c.url.endsWith('/offers'));
        expect(off?.body).toMatchObject({
            sourcing_request_id: 'src_job1',
            supplier_id: 'sup_new',
            design_version: 1,
            quantity: 500,
            unit_price_cents: 295,
            tooling_cents: 0,
            production_lead_days: 12,
            shipping_lead_days: 9,
            incoterm: 'FOB',
            material: 'Aluminum 6061',
            processes: ['laser cutting', 'bending'],
            negotiation_status: 'supplier-estimate',
        });
        expect((off?.body as { idempotency_key: string }).idempotency_key).toMatch(/^desk-/);
        expect(off?.body).not.toHaveProperty('lease_id');
    });

    it('computes offer totals from cents', () => {
        expect(offerTotalCents(supplierOfferView())).toBe(320 * 500 + 15000 + 42000);
        expect(offerTotalCents(supplierOfferView({ shippingCents: null, toolingCents: 0 }))).toBe(160000);
    });
});
