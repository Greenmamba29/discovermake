import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { OrderView } from '@/contracts/orders';
import { DEV_SHOP_ID } from '@/server/db/seed';
import { emitEvent } from '@/server/events/outbox';
import { orders } from '@/server/db/schema';
import { advanceOrder, confirmDevPayment, createCheckout, getOrderForBuyer } from '@/server/orders';
import { buildTrackingSteps, timelineLabel } from '@/server/orders/buyer-view';
import { GET as orderRoute } from '@/app/api/orders/[orderId]/route';
import { useTestDb } from '../support/db';
import { checkoutBody, createQuoteFixture, quietConsole } from './fixtures';

const { dispatchOrderMock } = vi.hoisted(() => ({ dispatchOrderMock: vi.fn(async (_id: string) => null) }));
// Dispatch is a spy so order suites stay deterministic (tests/shop covers dispatch); the rest is real.
vi.mock('@/server/dispatch', async (orig) => ({ ...(await orig<typeof import('@/server/dispatch')>()), dispatchOrder: (id: string) => dispatchOrderMock(id), expireStaleOffers: async () => 0 }));

function get(orderId: string, opts: { query?: string; header?: string } = {}) {
    const url = `http://localhost:3100/api/orders/${orderId}${opts.query ? `?t=${encodeURIComponent(opts.query)}` : ''}`;
    return orderRoute(new Request(url, { headers: opts.header ? { 'x-order-token': opts.header } : {} }), { params: Promise.resolve({ orderId }) });
}

describe('buyer order access + view', () => {
    const ctx = useTestDb({ seed: true });
    beforeAll(() => {
        quietConsole();
    });

    async function checkout() {
        const { quote } = await createQuoteFixture(ctx.db);
        const res = await createCheckout(checkoutBody(quote.id));
        const token = new URL(res.orderUrl).searchParams.get('t')!;
        return { res, token };
    }

    it('returns the contract view only for the signed token; tampered / foreign tokens look like a missing order', async () => {
        const a = await checkout();
        const b = await checkout();

        const view = await getOrderForBuyer(a.res.orderId, a.token);
        expect(view).not.toBeNull();
        expect(OrderView.parse(view)).toBeTruthy();
        expect(view!.status).toBe('PENDING_PAYMENT');
        expect(view!.universalStatus).toBe('NEEDS_INPUT');
        expect(view!.steps.map((s) => s.state)).toEqual(['current', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);

        const flipped = a.token.slice(0, -1) + (a.token.endsWith('A') ? 'B' : 'A');
        expect(await getOrderForBuyer(a.res.orderId, flipped)).toBeNull();
        expect(await getOrderForBuyer(a.res.orderId, b.token)).toBeNull();
        expect(await getOrderForBuyer(a.res.orderId, null)).toBeNull();
        expect(await getOrderForBuyer('ord_missing0000000000000', a.token)).toBeNull();

        expect((await get(a.res.orderId, { header: a.token })).status).toBe(200);
        expect((await get(a.res.orderId, { query: a.token })).status).toBe(200);
        const wrong = await get(a.res.orderId, { query: flipped });
        expect(wrong.status).toBe(404);
        const missing = await get('ord_missing0000000000000', { query: a.token });
        expect(missing.status).toBe(404);
        expect(await wrong.json()).toEqual(await missing.json());
        expect((await get('not-an-id', { query: a.token })).status).toBe(404);
    });

    it('tracks progress from real events: payment, shop acceptance, milestones; hides internal ledger events', async () => {
        const { res, token } = await checkout();
        await confirmDevPayment(JSON.stringify({ providerRef: res.payment.providerRef, outcome: 'succeeded' }), new Headers());
        let view = (await getOrderForBuyer(res.orderId, token))!;
        expect(view.status).toBe('PAID');
        expect(view.paidAt).not.toBeNull();
        expect(view.steps.map((s) => s.state)).toEqual(['done', 'current', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
        const types = view.timeline.map((t) => t.eventType);
        expect(types).toEqual(['order.created', 'payment.completed', 'production.authorized']);
        expect(types).not.toContain('ledger.payment_recorded');

        const shopActor = { kind: 'shop' as const, id: DEV_SHOP_ID };
        await advanceOrder(res.orderId, 'DISPATCHED', shopActor);
        await advanceOrder(res.orderId, 'ACCEPTED', shopActor, { shopId: DEV_SHOP_ID });
        const [order] = await ctx.db.select().from(orders).where(eq(orders.id, res.orderId));
        await ctx.db.transaction((tx) =>
            emitEvent(tx, {
                type: 'job.accepted',
                payload: { jobId: 'job_x', orderId: res.orderId, shopId: DEV_SHOP_ID },
                actor: shopActor,
                correlationId: order.correlationId,
                orderId: res.orderId,
            }),
        );
        view = (await getOrderForBuyer(res.orderId, token))!;
        expect(view.shop).toMatchObject({ name: 'Philadelphia Precision Works', region: 'PA' });
        expect(view.statusLabel).toMatch(/^Philadelphia Precision Works accepted/);
        expect(view.timeline.at(-1)!.label).toBe('Philadelphia Precision Works accepted your job');
        expect(view.timeline.at(-1)!.actorKind).toBe('shop');
    });

    it('stepper handles rework, refunds and completion', () => {
        const t0 = new Date('2026-10-06T10:00:00Z');
        const h = (to: Parameters<typeof buildTrackingSteps>[0], m: number) => ({ toStatus: to, createdAt: new Date(t0.getTime() + m * 60_000) });
        const path = [h('PAID', 1), h('DISPATCHED', 2), h('ACCEPTED', 3), h('IN_PRODUCTION', 4)];
        expect(buildTrackingSteps('QA_FAILED', t0, [...path, h('QA_FAILED', 5)]).map((s) => s.state)).toEqual(['done', 'done', 'done', 'failed', 'upcoming', 'upcoming']);
        expect(buildTrackingSteps('REFUNDED', t0, [...path, h('REFUNDED', 6)]).map((s) => s.state)).toEqual(['done', 'done', 'failed', 'upcoming', 'upcoming', 'upcoming']);
        const done = buildTrackingSteps('COMPLETE', t0, [...path, h('QA_PASSED', 5), h('SHIPPED', 6), h('DELIVERED', 7), h('COMPLETE', 8)]);
        expect(done.every((s) => s.state === 'done' && s.at)).toBe(true);
        expect(buildTrackingSteps('PAYMENT_FAILED', t0, [h('PAYMENT_FAILED', 1)])[0].state).toBe('failed');
    });

    it('labels milestone events in plain language', () => {
        const names = new Map([[DEV_SHOP_ID, 'Philadelphia Precision Works']]);
        expect(timelineLabel({ eventType: 'production.milestone', payload: { kind: 'CUTTING', shopId: DEV_SHOP_ID } }, names)).toBe('Cutting started at Philadelphia Precision Works');
        expect(timelineLabel({ eventType: 'payout.created', payload: {} }, names)).toBeNull();
        expect(timelineLabel({ eventType: 'order.status_changed', payload: {} }, names)).toBeNull();
    });
});
