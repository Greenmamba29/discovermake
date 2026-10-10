// @vitest-environment jsdom
/**
 * Manufacturing Route: a binding shop quote keeps the checkout CTA and lists partner offers
 * as extra routes; a quote that is not orderable loses the CTA and offers partner sourcing.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuildSourcingView, QuoteView } from '@/contracts';
import { buildSourcingView, quoteFor, routeOffer, sourcingJobRow } from '../__fixtures__/contracts';
import { RouteScreen } from './route-screen';

let quote: QuoteView;
let sourcing: BuildSourcingView;

beforeEach(() => {
    quote = quoteFor({ materialId: 'mat_al_6061', thicknessOptionId: 'thk_al6061_090', quantity: 10 });
    sourcing = buildSourcingView();
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
            if (url.endsWith(`/api/quotes/${quote.id}`)) return ok(quote);
            if (url.endsWith('/api/builds/bld_test/sourcing')) return ok(sourcing);
            return ok({ error: { code: 'NOT_FOUND', message: 'nope' } }, 404);
        }),
    );
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

function renderRoute() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <RouteScreen quoteId={quote.id} />
        </QueryClientProvider>,
    );
}

describe('RouteScreen', () => {
    it('keeps checkout for a binding quote and adds partner offers under the shop route', async () => {
        sourcing = buildSourcingView({ jobs: [sourcingJobRow('COMPLETE')], offers: [routeOffer()] });
        renderRoute();
        const cta = await screen.findByTestId('route-continue');
        expect(cta.getAttribute('href')).toBe(`/checkout/${quote.id}`);
        expect(screen.getByTestId('route-card')).toBeTruthy();
        expect(screen.getByTestId('route-trust-chip').textContent).toContain('Binding quote');
        const options = await screen.findByTestId('supplier-route-options');
        expect(within(options).getByTestId('offer-trust-chip').textContent).toContain('Supplier-confirmed');
        expect(screen.queryByTestId('build-sourcing-panel')).toBeNull();
        expect(screen.queryByTestId('route-not-orderable')).toBeNull();
    });

    it('renders no partner section for a binding quote that was never sourced', async () => {
        renderRoute();
        await screen.findByTestId('route-continue');
        expect(screen.queryByTestId('supplier-route-options')).toBeNull();
    });

    it('drops the checkout CTA for a quote under review and offers partner sourcing', async () => {
        quote = { ...quote, status: 'REVIEW', trustLevel: 'AI_ESTIMATE', orderable: false };
        renderRoute();
        await screen.findByTestId('route-card');
        expect(screen.queryByTestId('route-continue')).toBeNull();
        expect(screen.getByTestId('route-not-orderable').textContent).toContain('needs a shop review');
        expect(screen.getByTestId('route-trust-chip').textContent).toContain('AI estimate');
        const panel = await screen.findByTestId('build-sourcing-panel');
        const form = await within(panel).findByTestId('sourcing-request-form');
        expect((within(form).getByTestId('sourcing-quantity') as HTMLInputElement).value).toBe('10');
    });

    it('treats a binding quote that is no longer orderable as not orderable', async () => {
        quote = { ...quote, status: 'EXPIRED', orderable: false };
        renderRoute();
        await screen.findByTestId('route-card');
        expect(screen.queryByTestId('route-continue')).toBeNull();
        expect(screen.getByTestId('route-not-orderable').textContent).toContain('expired');
    });
});
