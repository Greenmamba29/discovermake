/**
 * Live Drops + Build Slots against a real database and the dev payment double:
 * price floor, fair-queue claims under concurrency, per-buyer limits, and closing
 * (CONFIRMED captures every authorization, FAILED releases every one).
 */
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { POST as claimsRoute } from '@/app/api/live/drops/[dropId]/claims/route';
import { POST as intentsRoute } from '@/app/api/live/shows/[showId]/intents/route';
import { GET as sweepRoute } from '@/app/api/admin/live/drops/close/route';
import { drops, liveEvents, orders, payments, slotClaims } from '@/server/db/schema';
import { claimSlots, closeDrop, handleIntent, resetLiveRateLimits, SYSTEM_LIVE_ACTOR } from '@/server/live';
import { confirmDevPayment } from '@/server/orders';
import { DevPaymentProvider } from '@/server/payments';
import { useTestDb } from '../support/db';
import { quietConsole } from '../orders/fixtures';
import { claimBody, req, setupShow, makeUser, viewerOf } from './fixtures';

vi.mock('@/server/dispatch', async (orig) => ({ ...(await orig<typeof import('@/server/dispatch')>()), dispatchOrder: async () => null }));

const showParams = (showId: string) => ({ params: Promise.resolve({ showId }) });
const dropParams = (dropId: string) => ({ params: Promise.resolve({ dropId }) });

async function authorize(providerRef: string) {
    await confirmDevPayment(JSON.stringify({ providerRef, outcome: 'succeeded' }), new Headers());
}

describe('Live drops and Build Slots', () => {
    const ctx = useTestDb({ seed: true });
    beforeAll(() => quietConsole());
    afterEach(() => {
        resetLiveRateLimits();
        vi.restoreAllMocks();
        quietConsole();
    });

    async function openDrop(opts: { totalSlots: number; thresholdSlots?: number; perBuyerLimit?: number; priceCents?: number }) {
        const s = await setupShow(ctx.db);
        const r = await handleIntent(await s.hostAccess(), {
            intent: 'start_drop',
            buildId: s.fixture.build.id,
            priceCents: opts.priceCents ?? 900,
            totalSlots: opts.totalSlots,
            thresholdSlots: opts.thresholdSlots ?? 10,
            perBuyerLimit: opts.perBuyerLimit ?? 2,
            durationMinutes: 60,
        });
        return { ...s, drop: r.drop! };
    }

    it('start_drop requires the price to cover the binding unit price at the threshold quantity', async () => {
        const s = await setupShow(ctx.db);
        const below = await intentsRoute(
            req(`/api/live/shows/${s.show.id}/intents`, { user: s.host, body: { intent: 'start_drop', buildId: s.fixture.build.id, priceCents: 499, totalSlots: 20, thresholdSlots: 10, perBuyerLimit: 2, durationMinutes: 30 } }),
            showParams(s.show.id),
        );
        expect(below.status).toBe(409);
        const body = await below.json();
        expect(body.error.message).toMatch(/below production cost/);
        expect(body.error.details).toMatchObject({ minimumPriceCents: 500, quoteId: s.fixture.quote.id });

        const over = await intentsRoute(
            req(`/api/live/shows/${s.show.id}/intents`, { user: s.host, body: { intent: 'start_drop', buildId: s.fixture.build.id, priceCents: 900, totalSlots: 5, thresholdSlots: 10, perBuyerLimit: 2, durationMinutes: 30 } }),
            showParams(s.show.id),
        );
        expect(over.status).toBe(400); // threshold > total (contract refinement)

        const ok = await intentsRoute(
            req(`/api/live/shows/${s.show.id}/intents`, { user: s.host, body: { intent: 'start_drop', buildId: s.fixture.build.id, priceCents: 500, totalSlots: 20, thresholdSlots: 10, perBuyerLimit: 2, durationMinutes: 30 } }),
            showParams(s.show.id),
        );
        expect(ok.status).toBe(200);
        const started = await ok.json();
        expect(started.drop).toMatchObject({ status: 'OPEN', priceCents: 500, totalSlots: 20, claimedSlots: 0 });
        const [ev] = await ctx.db.select().from(liveEvents).where(eq(liveEvents.event, 'drop.started'));
        expect(ev.sig).toBeTruthy();
    });

    it('never oversells under concurrent claims and respects the per-buyer limit', async () => {
        const { drop } = await openDrop({ totalSlots: 12, thresholdSlots: 10, perBuyerLimit: 2 });
        const buyers = await Promise.all(Array.from({ length: 10 }, () => makeUser('buyer')));
        // Every buyer tries to take 2 slots at once, and one buyer also tries 3 parallel single claims.
        const greedy = buyers[0];
        const attempts = [
            ...buyers.map((b) => claimsRoute(req(`/api/live/drops/${drop.id}/claims`, { user: b, body: claimBody(2) }), dropParams(drop.id))),
            ...[1, 2, 3].map(() => claimsRoute(req(`/api/live/drops/${drop.id}/claims`, { user: greedy, body: claimBody(1) }), dropParams(drop.id))),
        ];
        const results = await Promise.all(attempts);
        const ok = results.filter((r) => r.status === 201);
        const rejected = results.filter((r) => r.status === 409);
        expect(ok.length + rejected.length).toBe(results.length);

        const [row] = await ctx.db.select().from(drops).where(eq(drops.id, drop.id));
        expect(row.claimedSlots).toBeLessThanOrEqual(12);
        expect(row.claimedSlots).toBe(12);
        const claims = await ctx.db.select().from(slotClaims).where(eq(slotClaims.dropId, drop.id));
        expect(claims.reduce((s, c) => s + c.quantity, 0)).toBe(12);
        const perUser = new Map<string, number>();
        for (const c of claims) perUser.set(c.userId, (perUser.get(c.userId) ?? 0) + c.quantity);
        for (const n of perUser.values()) expect(n).toBeLessThanOrEqual(2);

        // Every claim is a real BUILD_SLOT order with an authorize-only payment.
        const orderRows = await ctx.db.select().from(orders).where(inArray(orders.id, claims.map((c) => c.orderId)));
        expect(orderRows.every((o) => o.orderType === 'BUILD_SLOT' && o.status === 'PENDING_PAYMENT' && o.unitPriceCents === 900)).toBe(true);
        expect(orderRows[0].totalCents).toBe(orderRows[0].quantity * 900 + orderRows[0].shippingCents);
        const payRows = await ctx.db.select().from(payments).where(inArray(payments.orderId, claims.map((c) => c.orderId)));
        expect(payRows.every((p) => p.status === 'PENDING' && (p.metadata as Record<string, unknown>).captureMethod === 'manual')).toBe(true);
        const claimed = await ctx.db.select().from(liveEvents).where(eq(liveEvents.event, 'build_slot.claimed'));
        expect(claimed.every((e) => !!e.sig)).toBe(true);
    });

    it('an Idempotency-Key replays the same claim instead of taking more slots', async () => {
        const { drop } = await openDrop({ totalSlots: 20, perBuyerLimit: 5 });
        const buyer = await makeUser('idem');
        const send = () => claimsRoute(req(`/api/live/drops/${drop.id}/claims`, { user: buyer, body: claimBody(2), headers: { 'idempotency-key': 'claim-123' } }), dropParams(drop.id));
        const a = await (await send()).json();
        const b = await (await send()).json();
        expect(b.claimId).toBe(a.claimId);
        expect(b.orderId).toBe(a.orderId);
        const [row] = await ctx.db.select().from(drops).where(eq(drops.id, drop.id));
        expect(row.claimedSlots).toBe(2);
    });

    it('signed-out viewers cannot claim', async () => {
        const { drop } = await openDrop({ totalSlots: 20 });
        const r = await claimsRoute(req(`/api/live/drops/${drop.id}/claims`, { body: claimBody(1) }), dropParams(drop.id));
        expect(r.status).toBe(401);
    });

    it('closing at or above the threshold CONFIRMS: every authorization is captured and orders are paid', async () => {
        const { drop } = await openDrop({ totalSlots: 20, thresholdSlots: 10, perBuyerLimit: 2 });
        const capture = vi.spyOn(DevPaymentProvider.prototype, 'capture');
        const cancel = vi.spyOn(DevPaymentProvider.prototype, 'cancelAuthorization');
        const claims = [];
        for (let i = 0; i < 6; i++) {
            const res = await claimSlots(drop.id, await viewerOf(await makeUser('confirm')), claimBody(2), null);
            claims.push(res);
        }
        // Five buyers authorize (10 slots = threshold); the sixth never does.
        for (const c of claims.slice(0, 5)) await authorize(c.payment.providerRef);
        const authorized = await ctx.db.select().from(payments).where(inArray(payments.orderId, claims.map((c) => c.orderId)));
        expect(authorized.filter((p) => p.status === 'AUTHORIZED')).toHaveLength(5);
        expect((await ctx.db.select().from(orders).where(eq(orders.id, claims[0].orderId)))[0].status).toBe('PENDING_PAYMENT');

        const closed = await closeDrop(drop.id, SYSTEM_LIVE_ACTOR, 'host');
        expect(closed.status).toBe('CONFIRMED');
        expect(closed.claimedSlots).toBe(10);
        expect(capture).toHaveBeenCalledTimes(5);
        expect(cancel).toHaveBeenCalledTimes(1);

        const pays = await ctx.db.select().from(payments).where(inArray(payments.orderId, claims.map((c) => c.orderId)));
        const byOrder = new Map(pays.map((p) => [p.orderId, p.status]));
        for (const c of claims.slice(0, 5)) expect(byOrder.get(c.orderId)).toBe('SUCCEEDED');
        expect(byOrder.get(claims[5].orderId)).toBe('CANCELLED');
        const ords = await ctx.db.select().from(orders).where(inArray(orders.id, claims.map((c) => c.orderId)));
        const status = new Map(ords.map((o) => [o.id, o.status]));
        for (const c of claims.slice(0, 5)) expect(status.get(c.orderId)).toBe('PAID');
        expect(status.get(claims[5].orderId)).toBe('CANCELLED');
        const claimRows = await ctx.db.select().from(slotClaims).where(eq(slotClaims.dropId, drop.id));
        expect(claimRows.filter((c) => c.status === 'CAPTURED')).toHaveLength(5);
        expect(claimRows.filter((c) => c.status === 'EXPIRED')).toHaveLength(1);
        const closedEvents = await ctx.db.select().from(liveEvents).where(eq(liveEvents.event, 'drop.closed'));
        expect(closedEvents.some((e) => (e.payload as { status: string }).status === 'CONFIRMED' && !!e.sig)).toBe(true);

        // Closing again is a no-op: nothing is captured twice.
        await closeDrop(drop.id, SYSTEM_LIVE_ACTOR, 'host');
        expect(capture).toHaveBeenCalledTimes(5);
    });

    it('closing below the threshold FAILS: every authorization is released and orders are cancelled', async () => {
        const { drop } = await openDrop({ totalSlots: 20, thresholdSlots: 10, perBuyerLimit: 2 });
        const capture = vi.spyOn(DevPaymentProvider.prototype, 'capture');
        const cancel = vi.spyOn(DevPaymentProvider.prototype, 'cancelAuthorization');
        const claims = [];
        for (let i = 0; i < 3; i++) claims.push(await claimSlots(drop.id, await viewerOf(await makeUser('fail')), claimBody(2), null));
        for (const c of claims) await authorize(c.payment.providerRef);

        const closed = await closeDrop(drop.id, SYSTEM_LIVE_ACTOR, 'deadline');
        expect(closed.status).toBe('FAILED');
        expect(capture).not.toHaveBeenCalled();
        expect(cancel).toHaveBeenCalledTimes(3);
        const pays = await ctx.db.select().from(payments).where(inArray(payments.orderId, claims.map((c) => c.orderId)));
        expect(pays.every((p) => p.status === 'CANCELLED')).toBe(true);
        const ords = await ctx.db.select().from(orders).where(inArray(orders.id, claims.map((c) => c.orderId)));
        expect(ords.every((o) => o.status === 'CANCELLED')).toBe(true);
        const claimRows = await ctx.db.select().from(slotClaims).where(eq(slotClaims.dropId, drop.id));
        expect(claimRows.every((c) => c.status === 'RELEASED')).toBe(true);

        // A hold authorized after the drop failed is released immediately.
        const s2 = await openDrop({ totalSlots: 20, thresholdSlots: 10 });
        const late = await claimSlots(s2.drop.id, await viewerOf(await makeUser('late')), claimBody(1), null);
        await closeDrop(s2.drop.id, SYSTEM_LIVE_ACTOR, 'deadline');
        await authorize(late.payment.providerRef);
        const [p] = await ctx.db.select().from(payments).where(eq(payments.orderId, late.orderId));
        expect(p.status).toBe('CANCELLED');
    });

    it('overdue drops close from the cron sweep (admin / cron auth required)', async () => {
        const { drop } = await openDrop({ totalSlots: 20, thresholdSlots: 10 });
        await ctx.db.update(drops).set({ closesAt: new Date(Date.now() - 1000) }).where(eq(drops.id, drop.id));
        const denied = await sweepRoute(req('/api/admin/live/drops/close'), { params: Promise.resolve({}) });
        expect(denied.status).toBe(401);
        const res = await sweepRoute(req('/api/admin/live/drops/close', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }), { params: Promise.resolve({}) });
        expect(res.status).toBe(200);
        expect((await res.json()).closed).toBeGreaterThanOrEqual(1);
        const [row] = await ctx.db.select().from(drops).where(eq(drops.id, drop.id));
        expect(row.status).toBe('FAILED');
    });
});
