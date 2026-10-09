/**
 * R5 Live commerce against a real database and the dev payment double:
 *   fair queue  same-second claims ordered by the random tie-break, admitted under the drop
 *               lock, no oversell under concurrency, direct claims refused, positions
 *   auctions    bid ladder, anti-snipe (+15 s in the last 10 s), signed events, close:
 *               the highest AUTHORIZED bid wins and is captured, every other hold is released
 */
import { asc, eq, inArray } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { POST as bidRoute } from '@/app/api/live/auctions/[auctionId]/bids/route';
import { auctionBids, auctions, creatorEarnings, dropQueueEntries, drops, liveEvents, orders, payments, slotClaims } from '@/server/db/schema';
import { antiSnipe, claimSlots, dropQueueStatus, closeAuction, handleIntent, joinDropQueue, placeBid, processDropQueue, resetLiveRateLimits, SYSTEM_LIVE_ACTOR, sweepAuctions, verifyLiveEvent } from '@/server/live';
import { rowToLiveEvent } from '@/server/live/events';
import { confirmDevPayment } from '@/server/orders';
import { useTestDb } from '../support/db';
import { quietConsole } from '../orders/fixtures';
import { claimBody, makeUser, req, setupShow, viewerOf } from '../live/fixtures';

vi.mock('@/server/dispatch', async (orig) => ({ ...(await orig<typeof import('@/server/dispatch')>()), dispatchOrder: async () => null }));

async function authorize(orderId: string, db: ReturnType<typeof useTestDb>['db']) {
    const [p] = await db.select().from(payments).where(eq(payments.orderId, orderId));
    await confirmDevPayment(JSON.stringify({ providerRef: p.providerRef, outcome: 'succeeded' }), new Headers());
}

const bidBody = (amountCents: number) => ({ amountCents, buyer: { name: 'Ada Bidder' }, shippingAddress: { name: 'Ada Bidder', line1: '100 Market St', city: 'Philadelphia', region: 'PA', postalCode: '19106', country: 'US' as const }, shippingMethod: 'STANDARD' as const, acceptTerms: true as const });

describe('fair queue for high-demand drops', () => {
    const ctx = useTestDb({ seed: true });
    beforeAll(() => quietConsole());
    afterEach(async () => {
        await resetLiveRateLimits();
        quietConsole();
    });

    it('orders same-second claims by the random tie-break and never oversells, even with concurrent processing', async () => {
        const s = await setupShow(ctx.db);
        const r = await handleIntent(await s.hostAccess(), { intent: 'start_drop', buildId: s.fixture.build.id, priceCents: 900, totalSlots: 12, thresholdSlots: 10, perBuyerLimit: 2, durationMinutes: 60, fairQueue: true });
        const drop = r.drop!;
        expect(drop.fairQueue).toBe(true);

        // Direct claims are refused on a fair-queue drop.
        const direct = makeUser('direct');
        await expect(claimSlots(drop.id, await viewerOf(await direct), claimBody(1), null)).rejects.toMatchObject({ status: 409 });

        const second = new Date(Math.floor(Date.now() / 1000) * 1000 + 200);
        const buyers = await Promise.all(Array.from({ length: 10 }, () => makeUser('fan')));
        const joined = await Promise.all(buyers.map(async (b) => joinDropQueue(drop.id, await viewerOf(b), claimBody(2), second)));
        // Nobody is admitted inside their own second: everyone waits with a position.
        expect(joined.every((j) => j.status === 'QUEUED')).toBe(true);
        const entries = await ctx.db.select().from(dropQueueEntries).where(eq(dropQueueEntries.dropId, drop.id)).orderBy(asc(dropQueueEntries.tieBreak), asc(dropQueueEntries.id));
        expect(new Set(entries.map((e) => e.enqueuedSecond)).size).toBe(1);
        // Re-joining returns the same entry.
        const again = await joinDropQueue(drop.id, await viewerOf(buyers[0]), claimBody(2), second);
        expect(again.entryId).toBe(joined[0].entryId);

        // Process twice concurrently once the second has passed.
        const later = new Date(second.getTime() + 1500);
        const results = await Promise.all([processDropQueue(drop.id, later), processDropQueue(drop.id, later)]);
        expect(results.reduce((n, x) => n + x.admitted, 0)).toBe(6);
        expect(results.reduce((n, x) => n + x.rejected, 0)).toBe(4);

        const after = await ctx.db.select().from(dropQueueEntries).where(eq(dropQueueEntries.dropId, drop.id)).orderBy(asc(dropQueueEntries.tieBreak), asc(dropQueueEntries.id));
        // Fair order: the six lowest tie-breaks were admitted, the rest rejected (sold out).
        expect(after.map((e) => e.status)).toEqual([...Array(6).fill('ADMITTED'), ...Array(4).fill('REJECTED')]);
        expect(after.slice(6).every((e) => /Sold out/.test(e.reason ?? ''))).toBe(true);
        const [row] = await ctx.db.select().from(drops).where(eq(drops.id, drop.id));
        expect(row.claimedSlots).toBe(12);
        const claims = await ctx.db.select().from(slotClaims).where(eq(slotClaims.dropId, drop.id));
        expect(claims.reduce((n, c) => n + c.quantity, 0)).toBe(12);
        expect(new Set(claims.map((c) => c.userId)).size).toBe(6);
    });

    it('shows each buyer their position in line', async () => {
        const s = await setupShow(ctx.db);
        const r = await handleIntent(await s.hostAccess(), { intent: 'start_drop', buildId: s.fixture.build.id, priceCents: 900, totalSlots: 20, thresholdSlots: 10, perBuyerLimit: 2, durationMinutes: 60, fairQueue: true });
        const at = new Date(Math.floor(Date.now() / 1000) * 1000 + 100);
        const users = await Promise.all([makeUser('q1'), makeUser('q2'), makeUser('q3')]);
        for (const u of users) await joinDropQueue(r.drop!.id, await viewerOf(u), claimBody(1), at);
        // Positions settle once everyone of that second is in (a later arrival can draw a lower tie-break).
        const views = await Promise.all(users.map(async (u) => (await dropQueueStatus(r.drop!.id, await viewerOf(u), at))!));
        expect(views.map((v) => v.position).sort()).toEqual([1, 2, 3]);
        expect(views.every((v) => v.queueLength === 3 && v.status === 'QUEUED')).toBe(true);
    });
});

describe('live auctions', () => {
    const ctx = useTestDb({ seed: true });
    beforeAll(() => quietConsole());
    afterEach(async () => {
        await resetLiveRateLimits();
        quietConsole();
    });

    async function openAuction(opts: { startingBidCents?: number; minIncrementCents?: number; durationSeconds?: number } = {}) {
        const s = await setupShow(ctx.db, { quote: { quantity: 1, unitPriceCents: 2000 } });
        const r = await handleIntent(await s.hostAccess(), { intent: 'start_auction', buildId: s.fixture.build.id, startingBidCents: opts.startingBidCents ?? 2500, minIncrementCents: opts.minIncrementCents ?? 500, durationSeconds: opts.durationSeconds ?? 60 });
        return { ...s, auction: r.auction! };
    }

    it('extends by 15 s only for a bid in the last 10 s', () => {
        const end = new Date('2026-10-09T20:00:00Z');
        expect(antiSnipe(end, new Date(end.getTime() - 11_000))).toEqual({ endsAt: end, extended: false });
        expect(antiSnipe(end, new Date(end.getTime() - 10_000)).endsAt.getTime()).toBe(end.getTime() + 15_000);
        expect(antiSnipe(end, new Date(end.getTime() - 1_000)).extended).toBe(true);
    });

    it('enforces the starting bid floor and the bid ladder; the host cannot bid', async () => {
        const s = await setupShow(ctx.db, { quote: { quantity: 1, unitPriceCents: 2000 } });
        await expect(handleIntent(await s.hostAccess(), { intent: 'start_auction', buildId: s.fixture.build.id, startingBidCents: 1999, minIncrementCents: 500, durationSeconds: 60 })).rejects.toMatchObject({ status: 409 });

        const { auction, host } = await openAuction();
        expect(auction).toMatchObject({ status: 'OPEN', nextMinimumBidCents: 2500, bidCount: 0 });
        const a = await makeUser('alice');
        const b = await makeUser('bob');
        const low = await bidRoute(req(`/api/live/auctions/${auction.id}/bids`, { user: a, body: bidBody(2400) }), { params: Promise.resolve({ auctionId: auction.id }) });
        expect(low.status).toBe(409);
        expect((await low.json()).error.details).toMatchObject({ nextMinimumBidCents: 2500 });
        const first = await placeBid(auction.id, await viewerOf(a), bidBody(2500));
        expect(first.auction).toMatchObject({ currentBidCents: 2500, nextMinimumBidCents: 3000, bidCount: 1, viewerIsLeading: true });
        await expect(placeBid(auction.id, await viewerOf(b), bidBody(2900))).rejects.toMatchObject({ status: 409 });
        const second = await placeBid(auction.id, await viewerOf(b), bidBody(3000));
        expect(second.auction.leadingBidder).toBeTruthy();
        await expect(placeBid(auction.id, await viewerOf(host), bidBody(5000))).rejects.toMatchObject({ status: 403 });

        // Every bid is a LIVE_DROP order with an authorize-only hold; `auction.bid` is signed.
        const bids = await ctx.db.select().from(auctionBids).where(eq(auctionBids.auctionId, auction.id));
        const orderRows = await ctx.db.select().from(orders).where(inArray(orders.id, bids.map((x) => x.orderId)));
        expect(orderRows.every((o) => o.orderType === 'LIVE_DROP' && o.status === 'PENDING_PAYMENT' && o.quantity === 1)).toBe(true);
        const events = await ctx.db.select().from(liveEvents).where(eq(liveEvents.event, 'auction.bid'));
        expect(events.length).toBeGreaterThanOrEqual(2);
        expect(events.every((e) => verifyLiveEvent(rowToLiveEvent(e)))).toBe(true);
    });

    it('anti-snipe extends the end; close captures the highest authorized bid and releases every other hold', async () => {
        const { auction, show } = await openAuction({ durationSeconds: 60 });
        const [alice, bob, carol] = await Promise.all([makeUser('alice'), makeUser('bob'), makeUser('carol')]);
        const ends = new Date(auction.endsAt).getTime();

        const a1 = await placeBid(auction.id, await viewerOf(alice), bidBody(2500), new Date(ends - 30_000));
        expect(a1.extended).toBe(false);
        await authorize(a1.orderId, ctx.db);
        const b1 = await placeBid(auction.id, await viewerOf(bob), bidBody(3500), new Date(ends - 4_000));
        expect(b1.extended).toBe(true);
        expect(new Date(b1.auction.endsAt).getTime()).toBe(ends + 15_000);
        expect(b1.auction.extensions).toBe(1);
        await authorize(b1.orderId, ctx.db);
        // Carol outbids but never authorizes her hold: her bid is void at close.
        const c1 = await placeBid(auction.id, await viewerOf(carol), bidBody(4000), new Date(ends + 5_000));
        expect(c1.extended).toBe(true);

        const closed = await closeAuction(auction.id, SYSTEM_LIVE_ACTOR, 'deadline', new Date(ends + 60_000));
        expect(closed).toMatchObject({ status: 'SOLD', winner: expect.any(String) });
        const bids = await ctx.db.select().from(auctionBids).where(eq(auctionBids.auctionId, auction.id));
        const byOrder = new Map(bids.map((x) => [x.orderId, x.status]));
        expect(byOrder.get(b1.orderId)).toBe('WON');
        expect(byOrder.get(a1.orderId)).toBe('LOST');
        expect(byOrder.get(c1.orderId)).toBe('VOID');
        const pays = new Map((await ctx.db.select().from(payments).where(inArray(payments.orderId, [a1.orderId, b1.orderId, c1.orderId]))).map((p) => [p.orderId, p.status]));
        expect(pays.get(b1.orderId)).toBe('SUCCEEDED');
        expect(pays.get(a1.orderId)).toBe('CANCELLED');
        expect(pays.get(c1.orderId)).toBe('CANCELLED');
        const ords = new Map((await ctx.db.select().from(orders).where(inArray(orders.id, [a1.orderId, b1.orderId, c1.orderId]))).map((o) => [o.id, o.status]));
        expect(ords.get(b1.orderId)).toBe('PAID');
        expect(ords.get(a1.orderId)).toBe('CANCELLED');
        // The host earns the markup over the binding price (auction revenue).
        const [rev] = await ctx.db.select().from(creatorEarnings).where(eq(creatorEarnings.orderId, b1.orderId));
        expect(rev).toMatchObject({ kind: 'AUCTION_REVENUE' });
        const [closedEvent] = await ctx.db.select().from(liveEvents).where(eq(liveEvents.event, 'auction.closed'));
        expect(closedEvent.showId).toBe(show.id);
        expect(verifyLiveEvent(rowToLiveEvent(closedEvent))).toBe(true);
        // Closing again (cron) is a no-op.
        await sweepAuctions(new Date(ends + 120_000));
        const [row] = await ctx.db.select().from(auctions).where(eq(auctions.id, auction.id));
        expect(row.status).toBe('SOLD');
    });

    it('closes lazily past its end without an authorized bid as UNSOLD', async () => {
        const { auction } = await openAuction({ durationSeconds: 20 });
        const a = await makeUser('alice');
        const bid = await placeBid(auction.id, await viewerOf(a), bidBody(2500));
        const ends = new Date(auction.endsAt).getTime();
        await expect(placeBid(auction.id, await viewerOf(await makeUser('late')), bidBody(9000), new Date(ends + 40_000))).rejects.toMatchObject({ status: 409 });
        const [row] = await ctx.db.select().from(auctions).where(eq(auctions.id, auction.id));
        expect(row.status).toBe('UNSOLD');
        const [p] = await ctx.db.select().from(payments).where(eq(payments.orderId, bid.orderId));
        expect(p.status).toBe('CANCELLED');
    });
});
