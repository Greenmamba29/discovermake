import { and, eq } from 'drizzle-orm';
import Stripe from 'stripe';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { domainEvents, ledgerEntries, orderStatusHistory, orders, payments, quotes, webhookEvents } from '@/server/db/schema';
import { resetEnvCache } from '@/server/env';
import { createCheckout, handlePaymentFailed, handlePaymentSucceeded, IllegalTransitionError, advanceOrder } from '@/server/orders';
import { DevPaymentProvider, isDevPaymentEnabled, normalizeStripeEvent } from '@/server/payments';
import { POST as devPaymentRoute } from '@/app/api/webhooks/dev-payment/route';
import { POST as devConfirmAlias } from '@/app/api/checkout/dev-confirm/route';
import { POST as stripeRoute } from '@/app/api/webhooks/stripe/route';
import { useTestDb } from '../support/db';
import { checkoutBody, createQuoteFixture, quietConsole } from './fixtures';

const { dispatchOrderMock } = vi.hoisted(() => ({ dispatchOrderMock: vi.fn(async (_id: string) => null) }));
// Dispatch is a spy so order suites stay deterministic (tests/shop covers dispatch); the rest is real.
vi.mock('@/server/dispatch', async (orig) => ({ ...(await orig<typeof import('@/server/dispatch')>()), dispatchOrder: (id: string) => dispatchOrderMock(id), expireStaleOffers: async () => 0 }));

const WHSEC = 'whsec_test_orders_suite_secret';
const noParams = { params: Promise.resolve({}) };

function devConfirm(body: unknown, handler = devPaymentRoute) {
    return handler(new Request('http://localhost:3100/api/webhooks/dev-payment', { method: 'POST', body: JSON.stringify(body) }), noParams);
}

function stripePost(payload: string, signature: string) {
    return stripeRoute(new Request('http://localhost:3100/api/webhooks/stripe', { method: 'POST', headers: { 'stripe-signature': signature }, body: payload }), noParams);
}

function signed(event: object) {
    const payload = JSON.stringify(event);
    return { payload, header: Stripe.webhooks.generateTestHeaderString({ payload, secret: WHSEC }) };
}

describe('payments + webhooks', () => {
    const ctx = useTestDb({ seed: true });
    let log: ReturnType<typeof quietConsole>;
    beforeAll(() => {
        process.env.STRIPE_WEBHOOK_SECRET = WHSEC;
        resetEnvCache();
        log = quietConsole();
    });
    afterAll(() => {
        delete process.env.STRIPE_WEBHOOK_SECRET;
        resetEnvCache();
    });
    beforeEach(() => dispatchOrderMock.mockClear());

    async function newCheckout(qty = 10) {
        const { quote } = await createQuoteFixture(ctx.db, { quantity: qty });
        const res = await createCheckout(checkoutBody(quote.id));
        return { quote, res };
    }

    it('dev confirm: PAID in one transaction with events, locked quote, ledger split, then dispatch + email', async () => {
        const { quote, res } = await newCheckout();
        const r = await devConfirm({ providerRef: res.payment.providerRef, outcome: 'succeeded' });
        expect(r.status).toBe(200);
        const body = await r.json();
        expect(body).toEqual({ orderId: res.orderId, status: 'PAID', redirectUrl: res.orderUrl });

        const [order] = await ctx.db.select().from(orders).where(eq(orders.id, res.orderId));
        expect(order.status).toBe('PAID');
        expect(order.paidAt).toBeInstanceOf(Date);
        const [payment] = await ctx.db.select().from(payments).where(eq(payments.orderId, res.orderId));
        expect(payment.status).toBe('SUCCEEDED');
        const [q] = await ctx.db.select().from(quotes).where(eq(quotes.id, quote.id));
        expect(q.status).toBe('ORDERED');

        const types = (await ctx.db.select().from(domainEvents).where(eq(domainEvents.orderId, res.orderId))).map((e) => e.eventType);
        expect(types).toEqual(expect.arrayContaining(['order.created', 'payment.completed', 'order.status_changed', 'production.authorized', 'ledger.payment_recorded']));
        const ledger = await ctx.db.select().from(ledgerEntries).where(eq(ledgerEntries.orderId, res.orderId));
        expect(ledger.length).toBe(4); // CASH, SHOP_PAYABLE, PLATFORM_REVENUE, SHIPPING_PAYABLE (tax 0 omitted)

        expect(dispatchOrderMock).toHaveBeenCalledTimes(1);
        expect(dispatchOrderMock).toHaveBeenCalledWith(res.orderId);
        const confirmLog = log.info.mock.calls.map((c) => String(c[0])).find((m) => m.includes('order.confirmed') && m.includes(order.orderNumber));
        expect(confirmLog).toBeTruthy();
        expect(confirmLog).not.toContain(new URL(res.orderUrl).searchParams.get('t')!); // token redacted in logs
    });

    it('is idempotent: the same webhook event twice produces exactly one transition', async () => {
        const { res } = await newCheckout();
        const body = { providerRef: res.payment.providerRef, outcome: 'succeeded' as const };
        const [a, b] = await Promise.all([devConfirm(body), devConfirm(body)]);
        expect(a.status).toBe(200);
        expect(b.status).toBe(200);
        const c = await devConfirm(body, devConfirmAlias);
        expect(c.status).toBe(200);
        const paid = await ctx.db
            .select()
            .from(orderStatusHistory)
            .where(and(eq(orderStatusHistory.orderId, res.orderId), eq(orderStatusHistory.toStatus, 'PAID')));
        expect(paid).toHaveLength(1);
        const hooks = await ctx.db.select().from(webhookEvents).where(eq(webhookEvents.eventId, `dev:${res.payment.providerRef}:succeeded`));
        expect(hooks).toHaveLength(1);
        expect(hooks[0].processedAt).toBeInstanceOf(Date);
        const completed = await ctx.db
            .select()
            .from(domainEvents)
            .where(and(eq(domainEvents.orderId, res.orderId), eq(domainEvents.eventType, 'payment.completed')));
        expect(completed).toHaveLength(1);
        expect(dispatchOrderMock).toHaveBeenCalledTimes(1);

        const replay = await handlePaymentSucceeded({ provider: 'dev', providerRef: res.payment.providerRef, providerPaymentId: null, amountCents: res.totals.totalCents, currency: 'usd', eventId: 'other' });
        expect(replay).toEqual({ orderId: res.orderId, alreadyProcessed: true });
    });

    it('does not advance the order when the paid amount differs from the order total', async () => {
        const { res } = await newCheckout();
        const r = await handlePaymentSucceeded({ provider: 'dev', providerRef: res.payment.providerRef, providerPaymentId: null, amountCents: 1, currency: 'usd', eventId: 'evt_mismatch' });
        expect(r.alreadyProcessed).toBe(false);
        const [order] = await ctx.db.select().from(orders).where(eq(orders.id, res.orderId));
        expect(order.status).toBe('PENDING_PAYMENT');
        const [payment] = await ctx.db.select().from(payments).where(eq(payments.orderId, res.orderId));
        expect(payment.status).toBe('PENDING');
        expect(payment.failureReason).toBe('AMOUNT_MISMATCH');
        expect(dispatchOrderMock).not.toHaveBeenCalled();
        expect(log.info.mock.calls.some((c) => String(c[0]).includes('ops.alert'))).toBe(true);
    });

    it('payment failure -> PAYMENT_FAILED (retryable), then a later success -> PAID', async () => {
        const { res } = await newCheckout();
        const f = await devConfirm({ providerRef: res.payment.providerRef, outcome: 'failed' });
        expect((await f.json()).status).toBe('PAYMENT_FAILED');
        // replayed failure is a no-op
        await handlePaymentFailed({ provider: 'dev', providerRef: res.payment.providerRef, reason: 'again', eventId: 'x' });
        const s = await devConfirm({ providerRef: res.payment.providerRef, outcome: 'succeeded' });
        expect((await s.json()).status).toBe('PAID');
        // a failure arriving after success never overrides money that arrived
        await handlePaymentFailed({ provider: 'dev', providerRef: res.payment.providerRef, reason: 'late', eventId: 'y' });
        const [order] = await ctx.db.select().from(orders).where(eq(orders.id, res.orderId));
        expect(order.status).toBe('PAID');
    });

    it('dev confirm answers 404 for an unknown session and 400 for a bad body', async () => {
        expect((await devConfirm({ providerRef: 'devpay_nope', outcome: 'succeeded' })).status).toBe(404);
        expect((await devConfirm({ providerRef: '', outcome: 'maybe' })).status).toBe(400);
    });

    it('the dev provider refuses to run when NODE_ENV=production', async () => {
        const envRef = process.env as Record<string, string | undefined>;
        const prev = envRef.NODE_ENV;
        envRef.NODE_ENV = 'production';
        try {
            expect(() => new DevPaymentProvider()).toThrow(/refuses to run when NODE_ENV=production/);
            expect(isDevPaymentEnabled()).toBe(false);
            const r = await devConfirm({ providerRef: 'devpay_x', outcome: 'succeeded' });
            expect(r.status).toBe(404);
        } finally {
            envRef.NODE_ENV = prev;
        }
    });

    describe('Stripe webhook (signature verified with generateTestHeaderString)', () => {
        async function stripeOrder() {
            const { res } = await newCheckout();
            // Re-point the order's payment at a Stripe Checkout Session (as the stripe provider would).
            const sessionId = `cs_test_${res.orderId.slice(4)}`;
            await ctx.db.update(payments).set({ provider: 'stripe', providerRef: sessionId }).where(eq(payments.orderId, res.orderId));
            return { res, sessionId };
        }

        function sessionCompleted(eventId: string, sessionId: string, orderId: string, amount: number, extra: Record<string, unknown> = {}) {
            return {
                id: eventId,
                object: 'event',
                type: 'checkout.session.completed',
                api_version: '2025-11-17.clover',
                created: Math.floor(Date.now() / 1000),
                livemode: false,
                pending_webhooks: 1,
                request: { id: null, idempotency_key: null },
                data: {
                    object: {
                        id: sessionId,
                        object: 'checkout.session',
                        amount_total: amount,
                        currency: 'usd',
                        payment_status: 'paid',
                        payment_intent: `pi_test_${orderId.slice(4)}`,
                        client_reference_id: orderId,
                        metadata: { dm_order_id: orderId, dm_app: 'localhost:3100' },
                        ...extra,
                    },
                },
            };
        }

        it('verifies the signature, processes once, and rejects tampered payloads', async () => {
            const { res, sessionId } = await stripeOrder();
            const ev = sessionCompleted('evt_test_paid_1', sessionId, res.orderId, res.totals.totalCents);
            const { payload, header } = signed(ev);

            const tampered = payload.replace(`"amount_total":${res.totals.totalCents}`, '"amount_total":1');
            const bad = await stripePost(tampered, header);
            expect(bad.status).toBe(400);
            const unsigned = await stripePost(payload, 't=1,v1=deadbeef');
            expect(unsigned.status).toBe(400);
            let [order] = await ctx.db.select().from(orders).where(eq(orders.id, res.orderId));
            expect(order.status).toBe('PENDING_PAYMENT');

            const ok = await stripePost(payload, header);
            expect(ok.status).toBe(200);
            expect(await ok.json()).toEqual({ received: true });
            const again = await stripePost(payload, header);
            expect(again.status).toBe(200);

            [order] = await ctx.db.select().from(orders).where(eq(orders.id, res.orderId));
            expect(order.status).toBe('PAID');
            const [payment] = await ctx.db.select().from(payments).where(eq(payments.orderId, res.orderId));
            expect(payment.providerPaymentId).toBe(`pi_test_${res.orderId.slice(4)}`);
            const paid = await ctx.db
                .select()
                .from(orderStatusHistory)
                .where(and(eq(orderStatusHistory.orderId, res.orderId), eq(orderStatusHistory.toStatus, 'PAID')));
            expect(paid).toHaveLength(1);

            // charge.refunded issued in the Stripe Dashboard -> REFUNDED + ledger reversal
            const refund = signed({
                ...ev,
                id: 'evt_test_refund_1',
                type: 'charge.refunded',
                data: {
                    object: {
                        id: 'ch_test_1',
                        object: 'charge',
                        payment_intent: `pi_test_${res.orderId.slice(4)}`,
                        amount: res.totals.totalCents,
                        amount_refunded: res.totals.totalCents,
                        refunded: true,
                        refunds: { object: 'list', data: [{ id: 're_test_1', object: 'refund' }] },
                        metadata: {},
                    },
                },
            });
            expect((await stripePost(refund.payload, refund.header)).status).toBe(200);
            [order] = await ctx.db.select().from(orders).where(eq(orders.id, res.orderId));
            expect(order.status).toBe('REFUNDED');
            const ledger = await ctx.db.select().from(ledgerEntries).where(eq(ledgerEntries.orderId, res.orderId));
            const net = ledger.reduce((s, l) => s + (l.direction === 'DEBIT' ? l.amountCents : -l.amountCents), 0);
            expect(net).toBe(0);
            expect(ledger.some((l) => l.txnKey === `refund:${res.orderId}`)).toBe(true);
        });

        it('async (ACH) sessions wait for async_payment_succeeded; async failure fails the order', async () => {
            const { res, sessionId } = await stripeOrder();
            const pending = signed(sessionCompleted('evt_test_ach_pending', sessionId, res.orderId, res.totals.totalCents, { payment_status: 'unpaid' }));
            expect((await stripePost(pending.payload, pending.header)).status).toBe(200);
            let [order] = await ctx.db.select().from(orders).where(eq(orders.id, res.orderId));
            expect(order.status).toBe('PENDING_PAYMENT');
            const failed = signed({ ...sessionCompleted('evt_test_ach_failed', sessionId, res.orderId, res.totals.totalCents), type: 'checkout.session.async_payment_failed' });
            expect((await stripePost(failed.payload, failed.header)).status).toBe(200);
            [order] = await ctx.db.select().from(orders).where(eq(orders.id, res.orderId));
            expect(order.status).toBe('PAYMENT_FAILED');
        });

        it('payment_intent.succeeded backup path resolves the session by order id', async () => {
            const { res } = await stripeOrder();
            const pi = signed({
                id: 'evt_test_pi_1',
                object: 'event',
                type: 'payment_intent.succeeded',
                created: Math.floor(Date.now() / 1000),
                livemode: false,
                data: { object: { id: 'pi_test_backup', object: 'payment_intent', amount: res.totals.totalCents, amount_received: res.totals.totalCents, currency: 'usd', metadata: { dm_order_id: res.orderId } } },
            });
            expect((await stripePost(pi.payload, pi.header)).status).toBe(200);
            const [order] = await ctx.db.select().from(orders).where(eq(orders.id, res.orderId));
            expect(order.status).toBe('PAID');
        });

        it('ignores foreign objects, other deployments and single declined attempts', () => {
            const base = sessionCompleted('evt_x', 'cs_x', 'ord_x', 100) as unknown as Stripe.Event;
            expect(normalizeStripeEvent(base, 'localhost:3100').kind).toBe('payment.succeeded');
            expect(normalizeStripeEvent(base, 'staging.discovermake.com').kind).toBe('ignored');
            const foreign = sessionCompleted('evt_y', 'cs_y', 'ord_y', 100, { metadata: {} }) as unknown as Stripe.Event;
            expect(normalizeStripeEvent(foreign).kind).toBe('ignored');
            const declined = { ...base, type: 'payment_intent.payment_failed', data: { object: { id: 'pi', metadata: { dm_order_id: 'ord_x' } } } } as unknown as Stripe.Event;
            expect(normalizeStripeEvent(declined).kind).toBe('ignored');
        });
    });

    it('illegal transitions throw and write nothing', async () => {
        const { res } = await newCheckout();
        await expect(advanceOrder(res.orderId, 'SHIPPED', { kind: 'admin', id: 'ops' })).rejects.toBeInstanceOf(IllegalTransitionError);
        await expect(advanceOrder(res.orderId, 'REFUNDED', { kind: 'admin', id: 'ops' })).rejects.toBeInstanceOf(IllegalTransitionError);
        const history = await ctx.db.select().from(orderStatusHistory).where(eq(orderStatusHistory.orderId, res.orderId));
        expect(history).toHaveLength(0);
    });
});
