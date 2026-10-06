import Stripe from 'stripe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '@/server/env';
import { StripePaymentProvider } from '@/server/payments';
import { sessionExpiry, setStripeClientForTests } from '@/server/payments/stripe';

describe('StripePaymentProvider (no network: SDK fetch client stubbed)', () => {
    afterEach(() => {
        setStripeClientForTests(null);
        delete process.env.STRIPE_SECRET_KEY;
        resetEnvCache();
    });

    function stubStripe(responder: (url: string, init: RequestInit) => unknown) {
        process.env.STRIPE_SECRET_KEY = 'sk_test_orders_suite';
        resetEnvCache();
        const calls: { url: string; init: RequestInit }[] = [];
        const fetchFn = vi.fn(async (url: string | URL, init?: RequestInit) => {
            calls.push({ url: String(url), init: init ?? {} });
            return new Response(JSON.stringify(responder(String(url), init ?? {})), { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } });
        });
        setStripeClientForTests(new Stripe('sk_test_orders_suite', { httpClient: Stripe.createFetchHttpClient(fetchFn as unknown as typeof fetch), maxNetworkRetries: 0 }));
        return calls;
    }

    it('creates a Checkout Session for the server-priced total with an order-scoped idempotency key', async () => {
        const calls = stubStripe(() => ({ id: 'cs_test_123', object: 'checkout.session', url: 'https://checkout.stripe.com/c/pay/cs_test_123' }));
        const validUntil = new Date(Date.now() + 3 * 3600_000);
        const r = await new StripePaymentProvider().createPayment({
            orderId: 'ord_abc',
            orderNumber: 'DMO-ABC123',
            amountCents: 7900,
            currency: 'usd',
            buyerEmail: 'maker@example.com',
            description: 'DMO-ABC123 · 10 x bracket.dxf',
            successUrl: 'http://localhost:3100/orders/ord_abc?t=dmo_x',
            cancelUrl: 'http://localhost:3100/build/bld_x/approve?quote=qte_x&cancelled=1',
            metadata: { dm_quote_id: 'qte_x', dm_app: 'localhost:3100' },
            expiresAt: validUntil,
        });
        expect(r).toEqual({ providerRef: 'cs_test_123', redirectUrl: 'https://checkout.stripe.com/c/pay/cs_test_123' });
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toContain('/v1/checkout/sessions');
        const headers = new Headers(calls[0].init.headers as HeadersInit);
        expect(headers.get('idempotency-key')).toBe('checkout:ord_abc');
        const body = new URLSearchParams(String(calls[0].init.body));
        expect(body.get('mode')).toBe('payment');
        expect(body.get('line_items[0][price_data][unit_amount]')).toBe('7900');
        expect(body.get('line_items[0][quantity]')).toBe('1');
        expect(body.get('client_reference_id')).toBe('ord_abc');
        expect(body.get('metadata[dm_order_id]')).toBe('ord_abc');
        expect(body.get('payment_intent_data[metadata][dm_order_id]')).toBe('ord_abc');
        expect(body.get('expires_at')).toBe(String(Math.floor(validUntil.getTime() / 1000)));
        expect(body.has('payment_method_types[0]')).toBe(false); // dynamic payment methods (card, ACH, wallets)
    });

    it('refunds by PaymentIntent with an idempotency key', async () => {
        const calls = stubStripe(() => ({ id: 're_test_1', object: 'refund' }));
        const r = await new StripePaymentProvider().refund({ providerRef: 'cs_test_1', providerPaymentId: 'pi_test_1', amountCents: 7900, reason: 'ops' });
        expect(r.refundRef).toBe('re_test_1');
        const body = new URLSearchParams(String(calls[0].init.body));
        expect(body.get('payment_intent')).toBe('pi_test_1');
        expect(body.get('amount')).toBe('7900');
        expect(new Headers(calls[0].init.headers as HeadersInit).get('idempotency-key')).toBe('refund:cs_test_1:7900');
    });

    it('fails clearly without keys and clamps session expiry to Stripe limits', async () => {
        await expect(new StripePaymentProvider().parseWebhook('{}', new Headers())).rejects.toThrow(/STRIPE_WEBHOOK_SECRET/);
        const now = new Date('2026-10-06T12:00:00Z');
        const nowS = now.getTime() / 1000;
        expect(sessionExpiry(new Date(now.getTime() + 60_000), now)).toBe(nowS + 31 * 60);
        expect(sessionExpiry(new Date(now.getTime() + 7 * 86400_000), now)).toBe(nowS + 24 * 3600 - 60);
    });
});
