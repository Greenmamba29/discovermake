import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { CheckoutResponse } from '@/contracts/checkout';
import { verifyOrderAccessToken } from '@/server/auth/order-link';
import { domainEvents, orders, parts, payments, quotes } from '@/server/db/schema';
import { ApiError } from '@/server/http';
import { createCheckout } from '@/server/orders';
import { POST as checkoutRoute } from '@/app/api/checkout/route';
import { useTestDb } from '../support/db';
import { checkoutBody, createQuoteFixture, quietConsole } from './fixtures';

const { dispatchOrderMock } = vi.hoisted(() => ({ dispatchOrderMock: vi.fn(async (_id: string) => null) }));
// Dispatch is a spy so order suites stay deterministic (tests/shop covers dispatch); the rest is real.
vi.mock('@/server/dispatch', async (orig) => ({ ...(await orig<typeof import('@/server/dispatch')>()), dispatchOrder: (id: string) => dispatchOrderMock(id), expireStaleOffers: async () => 0 }));

async function expectConflict(p: Promise<unknown>, pattern: RegExp) {
    const err = await p.then(
        () => null,
        (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).message).toMatch(pattern);
}

function post(body: unknown) {
    return checkoutRoute(new Request('http://localhost:3100/api/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), {
        params: Promise.resolve({}),
    });
}

describe('checkout (server-priced)', () => {
    const ctx = useTestDb({ seed: true });
    beforeAll(() => {
        quietConsole();
    });

    it('creates a PENDING_PAYMENT order priced from the quote snapshot, with a dev payment session and signed link', async () => {
        const { quote, build } = await createQuoteFixture(ctx.db, { quantity: 10, unitPriceCents: 500 });
        const res = await createCheckout(checkoutBody(quote.id, { shippingMethod: 'EXPEDITED' }));
        expect(CheckoutResponse.parse(res)).toBeTruthy();
        expect(res.status).toBe('PENDING_PAYMENT');
        expect(res.orderType).toBe('SMALL_BATCH');
        expect(res.totals).toEqual({ subtotalCents: 5000, shippingCents: 2900, taxCents: 0, totalCents: 7900, currency: 'usd' });
        expect(res.payment.provider).toBe('dev');
        expect(res.payment.redirectUrl).toBe(`http://localhost:3100/checkout/dev-pay?ref=${res.payment.providerRef}`);
        expect(res.promisedShipDate).toBe(quote.shipDate);

        const [order] = await ctx.db.select().from(orders).where(eq(orders.id, res.orderId));
        expect(order.totalCents).toBe(7900);
        expect(order.shopCostCents + order.platformFeeCents).toBe(order.subtotalCents);
        expect(order.buildId).toBe(build.id);
        const token = new URL(res.orderUrl).searchParams.get('t');
        expect(token).toMatch(/^dmo_/);
        expect(order.accessTokenHash).not.toContain(token!);
        expect(verifyOrderAccessToken(order.id, token, order.accessTokenHash)).toBe(true);

        const [payment] = await ctx.db.select().from(payments).where(eq(payments.orderId, order.id));
        expect(payment).toMatchObject({ provider: 'dev', status: 'PENDING', amountCents: 7900, providerRef: res.payment.providerRef });
        expect(JSON.stringify(payment.metadata)).not.toContain(token!);

        const events = await ctx.db.select().from(domainEvents).where(and(eq(domainEvents.orderId, order.id), eq(domainEvents.eventType, 'order.created')));
        expect(events).toHaveLength(1);
        expect(events[0].actorId).toMatch(/^buyer:guest_/);
        expect(events[0].actorId).not.toContain('maker@example.com');
    });

    it('ignores client-supplied amounts (tampered totals never reach the order)', async () => {
        const { quote } = await createQuoteFixture(ctx.db, { quantity: 4, unitPriceCents: 1250 });
        const res = await post({ ...checkoutBody(quote.id), totalCents: 1, subtotalCents: 1, unitPriceCents: 1, shippingCents: 0, amount: 1 });
        expect(res.status).toBe(201);
        const body = CheckoutResponse.parse(await res.json());
        expect(body.totals.totalCents).toBe(5000 + 1500);
        expect(body.orderType).toBe('PROTOTYPE');
        const [order] = await ctx.db.select().from(orders).where(eq(orders.id, body.orderId));
        expect(order.totalCents).toBe(6500);
        expect(order.unitPriceCents).toBe(1250);
    });

    it('derives PRODUCTION_RUN for 250+', async () => {
        const { quote } = await createQuoteFixture(ctx.db, { quantity: 250, unitPriceCents: 300 });
        const res = await createCheckout(checkoutBody(quote.id));
        expect(res.orderType).toBe('PRODUCTION_RUN');
    });

    it('rejects an expired quote', async () => {
        const { quote } = await createQuoteFixture(ctx.db, { validUntil: new Date(Date.now() - 1000) });
        await expectConflict(createCheckout(checkoutBody(quote.id)), /expired/i);
    });

    it('rejects non-binding and non-READY quotes', async () => {
        const est = await createQuoteFixture(ctx.db, { trustLevel: 'AI_ESTIMATE' });
        await expectConflict(createCheckout(checkoutBody(est.quote.id)), /binding/i);
        const review = await createQuoteFixture(ctx.db, { status: 'REVIEW', trustLevel: 'SUPPLIER_ESTIMATE' });
        await expectConflict(createCheckout(checkoutBody(review.quote.id)), /not orderable/i);
        const ordered = await createQuoteFixture(ctx.db, { status: 'ORDERED' });
        await expectConflict(createCheckout(checkoutBody(ordered.quote.id)), /already been ordered/i);
    });

    it('rejects a stale quote (design changed after quoting)', async () => {
        const { quote, part } = await createQuoteFixture(ctx.db);
        await ctx.db.update(parts).set({ designVersion: 2 }).where(eq(parts.id, part.id));
        await expectConflict(createCheckout(checkoutBody(quote.id)), /design changed/i);
    });

    it('rejects a quote made under an older DFM rule set', async () => {
        const { quote, part } = await createQuoteFixture(ctx.db);
        await ctx.db.update(parts).set({ rulesetVersion: 'dfm-2099.01-next' }).where(eq(parts.id, part.id));
        await expectConflict(createCheckout(checkoutBody(quote.id)), /rules were updated/i);
    });

    it('rejects a snapshot whose line items do not add up (tampered snapshot)', async () => {
        const { quote } = await createQuoteFixture(ctx.db, { lineItemsOffsetCents: 1 });
        await expectConflict(createCheckout(checkoutBody(quote.id)), /could not be verified/i);
    });

    it('rejects a shipping method the quote does not offer', async () => {
        const { quote } = await createQuoteFixture(ctx.db);
        const err = await createCheckout(checkoutBody(quote.id, { shippingMethod: 'EXPRESS' })).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(400);
    });

    it('validates input at the route (terms must be accepted, quote must exist)', async () => {
        const { quote } = await createQuoteFixture(ctx.db);
        const noTerms = await post({ ...checkoutBody(quote.id), acceptTerms: false });
        expect(noTerms.status).toBe(400);
        expect((await noTerms.json()).error.code).toBe('VALIDATION_FAILED');
        const missing = await post(checkoutBody('qte_doesnotexist000000000'));
        expect(missing.status).toBe(404);
        const count = await ctx.db.select().from(orders).where(eq(orders.quoteId, quote.id));
        expect(count).toHaveLength(0);
        const [q] = await ctx.db.select().from(quotes).where(eq(quotes.id, quote.id));
        expect(q.status).toBe('READY');
    });
});
