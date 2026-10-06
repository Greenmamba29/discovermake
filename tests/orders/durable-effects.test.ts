import { and, eq, isNull } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { domainEvents, orders } from '@/server/db/schema';
import { MAX_PUBLISH_ATTEMPTS, publishPendingEvents } from '@/server/events/outbox';
import { ensureSubscribers } from '@/server/events/registry';
import { createCheckout, handlePaymentSucceeded } from '@/server/orders';
import { getPaymentProviderByName } from '@/server/payments';
import { useTestDb } from '../support/db';
import { checkoutBody, createQuoteFixture, quietConsole } from './fixtures';

const { dispatchOrderMock, deliverMode } = vi.hoisted(() => ({
    dispatchOrderMock: vi.fn(async (_id: string) => null),
    deliverMode: { crash: false },
}));
vi.mock('@/server/dispatch', async (orig) => ({ ...(await orig<typeof import('@/server/dispatch')>()), dispatchOrder: (id: string) => dispatchOrderMock(id) }));
// `crash: true` simulates the process dying right after the payment transaction commits:
// the immediate delivery never happens, so only the outbox relay can run the side effects.
vi.mock('@/server/events/outbox', async (orig) => {
    const real = await orig<typeof import('@/server/events/outbox')>();
    return { ...real, deliverEvent: (...args: Parameters<typeof real.deliverEvent>) => (deliverMode.crash ? Promise.resolve(false) : real.deliverEvent(...args)) };
});

describe('durable after-commit side effects', () => {
    const ctx = useTestDb({ seed: true });
    beforeAll(() => {
        quietConsole();
    });
    beforeEach(() => {
        dispatchOrderMock.mockClear();
        deliverMode.crash = false;
    });

    async function paidOrder() {
        const { quote } = await createQuoteFixture(ctx.db, { quantity: 10 });
        const res = await createCheckout(checkoutBody(quote.id));
        await handlePaymentSucceeded({ provider: 'dev', providerRef: res.payment.providerRef, providerPaymentId: null, amountCents: res.totals.totalCents, currency: 'usd', eventId: `evt_${res.orderId}` });
        return res.orderId;
    }

    it('dispatches immediately after commit when nothing goes wrong', async () => {
        const orderId = await paidOrder();
        expect(dispatchOrderMock).toHaveBeenCalledWith(orderId);
        const [authorized] = await ctx.db
            .select()
            .from(domainEvents)
            .where(and(eq(domainEvents.orderId, orderId), eq(domainEvents.eventType, 'production.authorized')));
        expect(authorized.publishedAt).not.toBeNull();
    });

    it('recovers dispatch through the outbox relay when the process dies after commit', async () => {
        deliverMode.crash = true;
        const orderId = await paidOrder();
        expect(dispatchOrderMock).not.toHaveBeenCalled();
        const [o] = await ctx.db.select().from(orders).where(eq(orders.id, orderId));
        expect(o.status).toBe('PAID');

        deliverMode.crash = false;
        await ensureSubscribers();
        await publishPendingEvents({ limit: 500 });
        expect(dispatchOrderMock).toHaveBeenCalledWith(orderId);
        const pending = await ctx.db
            .select()
            .from(domainEvents)
            .where(and(eq(domainEvents.orderId, orderId), eq(domainEvents.eventType, 'production.authorized'), isNull(domainEvents.publishedAt)));
        expect(pending).toHaveLength(0);
    });

    it('parks an event after the maximum number of failed deliveries', async () => {
        deliverMode.crash = true;
        const orderId = await paidOrder();
        const failing = vi.fn(async () => {
            throw new Error('subscriber down');
        });
        for (let i = 0; i < MAX_PUBLISH_ATTEMPTS + 2; i++) await publishPendingEvents({ limit: 500, handlers: [failing] });
        const [row] = await ctx.db
            .select()
            .from(domainEvents)
            .where(and(eq(domainEvents.orderId, orderId), eq(domainEvents.eventType, 'production.authorized')));
        expect(row.publishedAt).toBeNull();
        expect(row.publishAttempts).toBe(MAX_PUBLISH_ATTEMPTS);
    });

    it('refuses unknown payment providers instead of falling back to Stripe', () => {
        expect(() => getPaymentProviderByName('paypal' as never)).toThrow(/Unknown payment provider/);
    });
});
