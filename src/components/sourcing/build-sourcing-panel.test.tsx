// @vitest-environment jsdom
/**
 * Buyer sourcing panel: request form → "Finding manufacturing partners…" → offer cards with
 * trust labels, exceptions and the select action. Customers never see the supplier platform.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuildSourcingView } from '@/contracts';
import { approvalView, buildSourcingView, routeOffer, sourcingJobRow } from '../__fixtures__/contracts';
import { BuildSourcingPanel, sortOffers } from './build-sourcing-panel';

let state: BuildSourcingView;
const posts: { url: string; body: unknown }[] = [];

beforeEach(() => {
    posts.length = 0;
    state = buildSourcingView();
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
            if (url.endsWith('/api/builds/bld_test/sourcing') && (!init?.method || init.method === 'GET')) return ok(state);
            if (url.endsWith('/api/builds/bld_test/sourcing') && init?.method === 'POST') {
                posts.push({ url, body: JSON.parse(String(init.body)) });
                state = buildSourcingView({ jobs: [sourcingJobRow('QUEUED')] });
                return ok({ id: 'src_job1', displayId: 'SRC-7K3QX', status: 'QUEUED' }, 201);
            }
            const sel = url.match(/\/sourcing\/offers\/([^/]+)\/select$/);
            if (sel && init?.method === 'POST') {
                posts.push({ url, body: null });
                state = { ...state, offers: state.offers.map((o) => (o.id === sel[1] ? { ...o, selection: { approvalId: 'apr_sel', status: 'PENDING' } } : o)) };
                return ok(approvalView({ id: 'apr_sel', kind: 'SELECT_SUPPLIER_OFFER', supplierOfferId: sel[1], approverRole: 'ops' }), 201);
            }
            return ok({ error: { code: 'NOT_FOUND', message: 'nope' } }, 404);
        }),
    );
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

function renderPanel() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <BuildSourcingPanel buildId="bld_test" partId="prt_test" defaultQuantity={50} />
        </QueryClientProvider>,
    );
}

describe('BuildSourcingPanel', () => {
    it('sends a sourcing request in cents and switches to the live progress state', async () => {
        renderPanel();
        await screen.findByTestId('sourcing-request-form');
        expect((screen.getByTestId('sourcing-quantity') as HTMLInputElement).value).toBe('50');
        fireEvent.change(screen.getByTestId('sourcing-quantity'), { target: { value: '250' } });
        fireEvent.change(screen.getByTestId('sourcing-target-price'), { target: { value: '3.5' } });
        fireEvent.click(screen.getByTestId('sourcing-region-VN'));
        expect(screen.getByTestId('sourcing-region-VN').getAttribute('aria-pressed')).toBe('true');
        fireEvent.change(screen.getByTestId('sourcing-notes'), { target: { value: '  Anodized black  ' } });
        await act(async () => {
            fireEvent.click(screen.getByTestId('sourcing-submit'));
        });
        await waitFor(() => expect(posts).toHaveLength(1));
        expect(posts[0].body).toEqual({ partId: 'prt_test', quantity: 250, targetUnitCostCents: 350, targetRegions: ['VN'], notes: 'Anodized black' });

        const progress = await screen.findByTestId('sourcing-progress');
        expect(progress.textContent).toContain('Finding manufacturing partners…');
        expect(within(progress).getByRole('status').getAttribute('aria-live')).toBe('polite');
        expect(screen.queryByTestId('sourcing-request-form')).toBeNull();
    });

    it('validates the form before sending anything', async () => {
        renderPanel();
        await screen.findByTestId('sourcing-request-form');
        fireEvent.change(screen.getByTestId('sourcing-quantity'), { target: { value: '0' } });
        fireEvent.change(screen.getByTestId('sourcing-target-price'), { target: { value: 'cheap' } });
        await act(async () => {
            fireEvent.click(screen.getByTestId('sourcing-submit'));
        });
        expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual([expect.stringMatching(/whole number/), expect.stringMatching(/price like/)]);
        expect(posts).toHaveLength(0);
    });

    it('shows offers with trust labels, totals, lead days and exceptions, and asks ops to confirm a selection', async () => {
        state = buildSourcingView({
            jobs: [sourcingJobRow('COMPLETE')],
            offers: [
                routeOffer({ id: 'off_est', label: 'Partner · China', country: 'CN', verified: false, trustLevel: 'SUPPLIER_ESTIMATE', totalCents: 150000, exceptions: ['Material: 5052 instead of 6061'], shippingIncluded: false, totalLeadDays: 18 }),
                routeOffer(),
            ],
        });
        renderPanel();
        const confirmed = await screen.findByTestId('route-offer-off_confirmed');
        const estimate = screen.getByTestId('route-offer-off_est');

        // Confirmed offers sort before estimates.
        const cards = screen.getAllByRole('article');
        expect(cards[0]).toBe(confirmed);

        expect(within(confirmed).getByTestId('offer-trust-chip').textContent).toContain('Supplier-confirmed');
        expect(within(confirmed).getByTestId('offer-trust-chip-orderable').textContent).toBe('Orderable after approval');
        expect(within(confirmed).getByTestId('offer-total').textContent).toBe('$2,170.00');
        expect(within(confirmed).getByTestId('offer-lead').textContent).toContain('24 days to your door');
        expect(confirmed.textContent).toContain('Made in Vietnam');

        expect(within(estimate).getByTestId('offer-trust-chip').textContent).toContain('Supplier estimate');
        expect(within(estimate).getByTestId('offer-trust-chip-orderable').textContent).toBe('Not orderable');
        expect(within(estimate).getByTestId('offer-exceptions').textContent).toContain('5052 instead of 6061');
        expect(within(estimate).getByTestId('offer-lead').textContent).toContain('18 days to ship');

        // Customers never see the sourcing platform.
        expect(document.body.textContent?.toLowerCase()).not.toMatch(/alibaba|accio|1688/);

        fireEvent.click(within(confirmed).getByTestId('select-offer-off_confirmed'));
        expect(within(confirmed).getByRole('group', { name: 'Confirm action' }).textContent).toContain("We'll confirm this route with you before anything is ordered");
        await act(async () => {
            fireEvent.click(within(confirmed).getByTestId('select-offer-off_confirmed-confirm'));
        });
        await waitFor(() => expect(posts.map((p) => p.url)).toEqual([expect.stringMatching(/\/api\/builds\/bld_test\/sourcing\/offers\/off_confirmed\/select$/)]));
        await screen.findByTestId('offer-selection-pending');
        expect(screen.getByTestId('sourcing-select-notice').textContent).toContain('before anything is ordered');
        // While one route waits for confirmation, the others cannot be chosen.
        expect(within(screen.getByTestId('route-offer-off_est')).queryByTestId('select-offer-off_est')).toBeNull();
        expect(screen.getByTestId('route-offer-off_est').textContent).toContain('Another route is waiting for confirmation');
    });

    it('shows an approved selection honestly: nothing ordered yet', async () => {
        state = buildSourcingView({ jobs: [sourcingJobRow('COMPLETE')], offers: [routeOffer({ selection: { approvalId: 'apr_sel', status: 'APPROVED' } })] });
        renderPanel();
        const approved = await screen.findByTestId('offer-selection-approved');
        expect(approved.textContent).toMatch(/nothing has been ordered or charged/);
        expect(screen.queryByTestId('route-continue')).toBeNull();
    });

    it('keeps showing offers that arrive while partners are still quoting', async () => {
        state = buildSourcingView({ jobs: [sourcingJobRow('IN_PROGRESS')], offers: [routeOffer()] });
        renderPanel();
        const progress = await screen.findByTestId('sourcing-progress');
        expect(progress.textContent).toContain('1 offer so far');
        expect(screen.getByTestId('route-offer-off_confirmed')).toBeTruthy();
        expect(screen.queryByTestId('sourcing-request-again')).toBeNull();
    });
});

describe('sortOffers', () => {
    it('orders live before stale, confirmed before estimates, then cheapest', () => {
        const ids = sortOffers([
            routeOffer({ id: 'off_stale', status: 'STALE', totalCents: 1 }),
            routeOffer({ id: 'off_est_cheap', trustLevel: 'SUPPLIER_ESTIMATE', totalCents: 10 }),
            routeOffer({ id: 'off_conf_dear', totalCents: 900 }),
            routeOffer({ id: 'off_conf_cheap', totalCents: 500 }),
        ]).map((o) => o.id);
        expect(ids).toEqual(['off_conf_cheap', 'off_conf_dear', 'off_est_cheap', 'off_stale']);
    });
});
