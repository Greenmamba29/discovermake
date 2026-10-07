// @vitest-environment jsdom
/**
 * Configurator behaviour (DoorDash rules): the CTA counts missing required choices,
 * re-quotes on change, and only an exact, orderable quote unlocks checkout.
 * Network is stubbed at fetch(); the request bodies carry ids only, never amounts.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
vi.mock('next/navigation', () => ({
    useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
    usePathname: () => '/parts/prt_test',
}));

import { PartConfigurator } from './part-configurator';
import { catalog, part, quoteFor } from '../__fixtures__/contracts';

const quoteBodies: unknown[] = [];

beforeEach(() => {
    push.mockReset();
    // jsdom has no WebGL: the viewer falls back to the flat pattern (the same path as old browsers).
    HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
    quoteBodies.length = 0;
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
            if (url.endsWith('/api/parts/prt_test')) return ok(part);
            if (url.endsWith('/api/catalog')) return ok(catalog);
            if (url.endsWith('/api/quotes') && init?.method === 'POST') {
                const body = JSON.parse(String(init.body));
                quoteBodies.push(body);
                return ok(quoteFor(body), 201);
            }
            return ok({ error: { code: 'NOT_FOUND', message: 'nope' } }, 404);
        }),
    );
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

function renderConfigurator() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <PartConfigurator partId="prt_test" />
        </QueryClientProvider>,
    );
}

describe('PartConfigurator', () => {
    it('counts required selections, re-quotes by id, and unlocks checkout with the server price', async () => {
        renderConfigurator();
        const cta = await screen.findByTestId('checkout-cta');
        expect(cta.textContent).toContain('Make 2 required selections');
        expect((cta as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByTestId('part-dimensions').textContent).toContain('120.0 mm');

        // Aluminum has a single usable thickness, so it is pre-selected.
        fireEvent.click(screen.getByTestId('material-option-mat_al_6061').querySelector('input')!);
        await waitFor(() => expect(screen.getByTestId('checkout-cta').textContent).toContain('Continue to checkout · $23.50'), { timeout: 3000 });

        // The request carries ids and quantity only.
        expect(quoteBodies[0]).toEqual({ partId: 'prt_test', materialId: 'mat_al_6061', thicknessOptionId: 'thk_al6061_090', finishServiceId: null, services: [], quantity: 1 });
        expect(JSON.stringify(quoteBodies[0])).not.toMatch(/cents|price/i);
        expect(screen.getByTestId('trust-chip').textContent).toContain('Binding quote');

        // Changing quantity invalidates the price until the new quote arrives.
        await act(async () => {
            fireEvent.click(screen.getByTestId('qty-stepper-inc'));
        });
        expect(screen.getByTestId('checkout-cta').textContent).toContain('Updating price');
        await waitFor(() => expect(screen.getByTestId('checkout-cta').textContent).toContain('$47.00'), { timeout: 3000 });

        fireEvent.click(screen.getByTestId('checkout-cta'));
        expect(push).toHaveBeenCalledWith('/checkout/qte_mat_al_6061_2');
    });

    it('requires a thickness when the material has several', async () => {
        renderConfigurator();
        await screen.findByTestId('checkout-cta');
        fireEvent.click(screen.getByTestId('material-option-mat_steel_crs').querySelector('input')!);
        await waitFor(() => expect(screen.getByTestId('checkout-cta').textContent).toContain('Make 1 required selection'));
        expect(quoteBodies).toHaveLength(0);
        fireEvent.click(screen.getByTestId('thickness-option-thk_crs_14ga').querySelector('input')!);
        await waitFor(() => expect(quoteBodies).toHaveLength(1), { timeout: 3000 });
    });
});
