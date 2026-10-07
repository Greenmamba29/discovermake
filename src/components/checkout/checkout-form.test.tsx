// @vitest-environment jsdom
/**
 * Checkout: validates buyer + address client-side, sends ids and buyer details only
 * (never amounts), shows the dev-only test payment, and follows the server's signed link.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckoutRequest, type CheckoutResponse } from '@/contracts';
import { part, quoteFor } from '../__fixtures__/contracts';
import { CheckoutForm } from './checkout-form';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/checkout/qte_x' }));

const quote = quoteFor({ materialId: 'mat_al_6061', thicknessOptionId: 'thk_al6061_090', quantity: 10 });
const calls: { url: string; body: unknown }[] = [];
const assign = vi.fn();

const checkoutResponse: CheckoutResponse = {
    orderId: 'ord_test',
    orderNumber: 'DMO-ABC123',
    status: 'PENDING_PAYMENT',
    orderType: 'SMALL_BATCH',
    totals: { subtotalCents: quote.subtotalCents, shippingCents: 1200, taxCents: 0, totalCents: quote.subtotalCents + 1200, currency: 'usd' },
    promisedShipDate: '2026-10-12',
    payment: { provider: 'dev', providerRef: 'devpay_123', redirectUrl: 'http://localhost:3100/checkout/dev-pay?ref=devpay_123' },
    orderUrl: 'http://localhost:3100/orders/ord_test?t=dmo_token',
};

beforeEach(() => {
    calls.length = 0;
    assign.mockReset();
    HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign } });
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            const body = init?.body ? JSON.parse(String(init.body)) : undefined;
            calls.push({ url, body });
            const ok = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
            if (url.endsWith(`/api/quotes/${quote.id}`)) return ok(quote);
            if (url.endsWith('/api/parts/prt_test')) return ok(part);
            if (url.endsWith('/api/checkout')) return ok(checkoutResponse, 201);
            if (url.endsWith('/api/checkout/dev-confirm')) return ok({ orderId: 'ord_test', status: 'PAID', redirectUrl: checkoutResponse.orderUrl });
            return ok({ error: { code: 'NOT_FOUND', message: 'nope' } }, 404);
        }),
    );
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

function renderForm() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <CheckoutForm quoteId={quote.id} cancelled={false} />
        </QueryClientProvider>,
    );
}

const fill = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } });

describe('CheckoutForm', () => {
    it('blocks submit with field errors until the form is valid', async () => {
        renderForm();
        const pay = await screen.findByTestId('pay-cta');
        expect(pay.textContent).toContain('Pay $247.00 and start production'); // $235 parts + $12 standard shipping
        fireEvent.click(pay);
        await screen.findByText(/before paying/);
        expect(screen.getAllByText('Enter a 5-digit ZIP code.')).toHaveLength(2); // error summary + inline field error
        expect(calls.some((c) => c.url.endsWith('/api/checkout'))).toBe(false);
    });

    it('posts ids + buyer details only, then runs the dev payment and follows the signed order link', async () => {
        renderForm();
        await screen.findByTestId('pay-cta');
        fill('checkout-email', 'Buyer@Example.com');
        fill('checkout-name', 'Avery Buyer');
        fill('checkout-line1', '1 Market St');
        fill('checkout-city', 'San Francisco');
        fill('checkout-region', 'CA');
        fill('checkout-postal', '94105');
        fireEvent.click(screen.getByTestId('checkout-terms'));
        fireEvent.click(screen.getByTestId('pay-cta'));

        await screen.findByTestId('dev-payment-panel');
        const sent = calls.find((c) => c.url.endsWith('/api/checkout'))!.body as Record<string, unknown>;
        expect(CheckoutRequest.safeParse(sent).success).toBe(true);
        expect(sent).toMatchObject({ quoteId: quote.id, shippingMethod: 'STANDARD', acceptTerms: true, buyer: { name: 'Avery Buyer' } });
        expect(JSON.stringify(sent)).not.toMatch(/cents|price|amount|total/i);

        fireEvent.click(screen.getByTestId('dev-pay-button'));
        await waitFor(() => expect(assign).toHaveBeenCalledWith(checkoutResponse.orderUrl));
        expect(calls.find((c) => c.url.endsWith('/api/checkout/dev-confirm'))!.body).toEqual({ providerRef: 'devpay_123', outcome: 'succeeded' });
    });
});
