/**
 * Creator economics against a real database: royalty accrual on payment (ledger balanced,
 * subledger row, event), reversal on refund, no self-royalty, the pure split (cap at the
 * platform fee), creator payouts (manual + the Connect transfer path), and the insights
 * aggregates that read the same rows.
 */
import { and, eq, inArray, like } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { POST as markPaidRoute } from '@/app/api/admin/creator-payouts/[payoutId]/paid/route';
import { cartCheckouts, creatorAccounts, creatorEarnings, creatorPayouts, domainEvents, ledgerEntries, orders, shows } from '@/server/db/schema';
import { checkoutQuotes } from '@/server/cart/checkout';
import { getMembershipForBenefits } from '@/server/prime/membership';
import { createShow, upsertChannel } from '@/server/live';
import { resetEnvCache } from '@/server/env';
import { ledgerBalances } from '@/server/ledger';
import { creatorBalance, creatorInsights, markCreatorPayoutPaid, requestCreatorPayout, splitCreatorEarnings } from '@/server/media';
import { confirmDevPayment, refundOrder } from '@/server/orders';
import { useTestDb } from '../support/db';
import { quietConsole } from '../orders/fixtures';
import { makeUser, req } from '../live/fixtures';
import { creatorBuild, derivedBuild, paidOrder, publish } from './fixtures';

const { transferMock } = vi.hoisted(() => ({ transferMock: vi.fn(async (input: { payoutId: string }) => ({ transferId: `tr_${input.payoutId.slice(4, 14)}` })) }));
vi.mock('@/server/dispatch', async (orig) => ({ ...(await orig<typeof import('@/server/dispatch')>()), dispatchOrder: async () => null, cancelOpenJobs: async () => 0 }));
vi.mock('@/server/payments/stripe', async (orig) => ({ ...(await orig<typeof import('@/server/payments/stripe')>()), createConnectTransfer: transferMock }));

const ACTOR = { kind: 'admin' as const, id: 'ops' };

describe('creator economics', () => {
    const ctx = useTestDb({ seed: true });
    beforeAll(() => quietConsole());
    afterEach(() => {
        delete process.env.STRIPE_SECRET_KEY;
        resetEnvCache();
    });

    async function ledgerFor(orderId: string) {
        return ctx.db.select().from(ledgerEntries).where(eq(ledgerEntries.orderId, orderId));
    }

    it('splits royalties from the platform fee and never pays more than the platform earned', () => {
        expect(splitCreatorEarnings({ subtotalCents: 5000, platformFeeCents: 1300, liveShare: null, royalty: { creatorUserId: 'usr_a', pct: 10, kind: 'REMIX_ROYALTY', sourceBuildId: 'bld_a' } })).toEqual([
            { creatorUserId: 'usr_a', kind: 'REMIX_ROYALTY', amountCents: 500, sourceBuildId: 'bld_a' },
        ]);
        // 30% of 5000 = 1500 > the 1300 fee: capped at the fee.
        expect(splitCreatorEarnings({ subtotalCents: 5000, platformFeeCents: 1300, liveShare: null, royalty: { creatorUserId: 'usr_a', pct: 30, kind: 'REMIX_ROYALTY', sourceBuildId: 'bld_a' } })[0].amountCents).toBe(1300);
        // Drop markup first (fee 4000, quote fee 1300 -> 2700 to the host), the royalty from what is left.
        const both = splitCreatorEarnings({
            subtotalCents: 9000,
            platformFeeCents: 4000,
            liveShare: { creatorUserId: 'usr_host', quoteFeeCents: 1300, kind: 'DROP_REVENUE', sourceBuildId: 'bld_r' },
            royalty: { creatorUserId: 'usr_a', pct: 20, kind: 'REMIX_ROYALTY', sourceBuildId: 'bld_a' },
        });
        expect(both).toEqual([
            { creatorUserId: 'usr_host', kind: 'DROP_REVENUE', amountCents: 2700, sourceBuildId: 'bld_r' },
            { creatorUserId: 'usr_a', kind: 'REMIX_ROYALTY', amountCents: 1300, sourceBuildId: 'bld_a' },
        ]);
    });

    it('accrues the royalty when a remix order is paid and reverses it on refund; the ledger stays balanced', async () => {
        const { creator, viewer, fixture } = await creatorBuild(ctx.db);
        await publish(viewer, fixture.build.id, { royaltyPct: 10 });
        const buyer = await makeUser('buyer');
        const remix = await derivedBuild(ctx.db, fixture.build.id, 'remix', buyer.id);
        const { orderId } = await paidOrder(remix.quote.id, buyer);

        const [order] = await ctx.db.select().from(orders).where(eq(orders.id, orderId));
        expect(order.status).toBe('PAID');
        const earnings = await ctx.db.select().from(creatorEarnings).where(eq(creatorEarnings.orderId, orderId));
        expect(earnings).toHaveLength(1);
        expect(earnings[0]).toMatchObject({ creatorUserId: creator.id, kind: 'REMIX_ROYALTY', amountCents: Math.floor(order.subtotalCents * 0.1), sourceBuildId: fixture.build.id, txnKey: `creator:${orderId}:REMIX_ROYALTY` });
        const royalty = earnings[0].amountCents;

        let rows = await ledgerFor(orderId);
        let bal = ledgerBalances(rows);
        const debits = rows.filter((r) => r.direction === 'DEBIT').reduce((s, r) => s + r.amountCents, 0);
        const credits = rows.filter((r) => r.direction === 'CREDIT').reduce((s, r) => s + r.amountCents, 0);
        expect(debits).toBe(credits);
        expect(bal.CREATOR_PAYABLE).toBe(-royalty);
        expect(bal.PLATFORM_REVENUE).toBe(-(order.platformFeeCents - royalty));
        expect((await creatorBalance(creator.id)).availableCents).toBe(royalty);
        const [accrued] = await ctx.db.select().from(domainEvents).where(and(eq(domainEvents.eventType, 'royalty.accrued'), eq(domainEvents.orderId, orderId)));
        expect(accrued.payload).toMatchObject({ creatorUserId: creator.id, amountCents: royalty });

        await refundOrder(orderId, ACTOR, 'Buyer changed their mind');
        rows = await ledgerFor(orderId);
        bal = ledgerBalances(rows);
        expect(bal.CREATOR_PAYABLE ?? 0).toBe(0);
        expect(rows.filter((r) => r.txnKey === `creator_reversal:${orderId}:REMIX_ROYALTY`)).toHaveLength(2);
        const after = await ctx.db.select().from(creatorEarnings).where(eq(creatorEarnings.orderId, orderId));
        expect(after.map((e) => e.amountCents).sort((a, b) => a - b)).toEqual([-royalty, royalty]);
        expect((await creatorBalance(creator.id)).availableCents).toBe(0);
        // Idempotent: a replayed refund does not reverse twice.
        await refundOrder(orderId, ACTOR, 'again');
        expect(await ctx.db.select().from(creatorEarnings).where(eq(creatorEarnings.orderId, orderId))).toHaveLength(2);
    });

    it('accrues per order when a cart checkout pays several remixes with one group payment', async () => {
        const { creator, viewer, fixture } = await creatorBuild(ctx.db);
        await publish(viewer, fixture.build.id, { royaltyPct: 10 });
        const buyer = await makeUser('buyer');
        const a = await derivedBuild(ctx.db, fixture.build.id, 'remix', buyer.id);
        const b = await derivedBuild(ctx.db, fixture.build.id, 'clone', buyer.id, { quantity: 25 });
        const out = await checkoutQuotes({
            quoteIds: [a.quote.id, b.quote.id],
            cartId: null,
            userId: buyer.id,
            deviceHash: null,
            membership: await getMembershipForBenefits(buyer.id),
            shippingMethod: 'STANDARD',
            buyer: { email: buyer.email, name: 'Ada Buyer' },
            shippingAddress: { name: 'Ada Maker', line1: '100 Market St', city: 'Philadelphia', region: 'PA', postalCode: '19106', country: 'US' },
            payment: { mode: 'card' },
        });
        const [group] = await ctx.db.select().from(cartCheckouts).where(eq(cartCheckouts.id, out.checkoutId));
        expect(group.orderIds).toHaveLength(2);
        // One payment for the group fans out to one payment event per order.
        await confirmDevPayment(JSON.stringify({ providerRef: group.providerRef, outcome: 'succeeded' }), new Headers());
        const paid = await ctx.db.select().from(orders).where(inArray(orders.id, group.orderIds));
        expect(paid.map((o) => o.status)).toEqual(['PAID', 'PAID']);
        const earnings = await ctx.db.select().from(creatorEarnings).where(inArray(creatorEarnings.orderId, group.orderIds));
        expect(earnings).toHaveLength(2);
        for (const o of paid) {
            const e = earnings.find((x) => x.orderId === o.id)!;
            expect(e).toMatchObject({ creatorUserId: creator.id, amountCents: Math.min(o.platformFeeCents, Math.floor(o.subtotalCents * 0.1)), txnKey: `creator:${o.id}:${e.kind}` });
            expect(ledgerBalances(await ledgerFor(o.id)).CREATOR_PAYABLE).toBe(-e.amountCents);
        }
        expect(earnings.map((e) => e.kind).sort()).toEqual(['MAKE_THIS_ROYALTY', 'REMIX_ROYALTY']);
        // A replayed group webhook does not accrue twice.
        await confirmDevPayment(JSON.stringify({ providerRef: group.providerRef, outcome: 'succeeded' }), new Headers());
        expect(await ctx.db.select().from(creatorEarnings).where(inArray(creatorEarnings.orderId, group.orderIds))).toHaveLength(2);
        expect((await creatorBalance(creator.id)).availableCents).toBe(earnings.reduce((s, e) => s + e.amountCents, 0));

        // Refunding one order of the group reverses only that order's royalty.
        await refundOrder(paid[0].id, ACTOR, 'One part not needed');
        const left = earnings.find((e) => e.orderId === paid[1].id)!.amountCents;
        expect((await creatorBalance(creator.id)).availableCents).toBe(left);
    });

    it('pays Make This royalties, and never to yourself', async () => {
        const { creator, viewer, fixture } = await creatorBuild(ctx.db);
        await publish(viewer, fixture.build.id, { royaltyPct: 15, license: 'none' });
        const buyer = await makeUser('buyer');
        const copy = await derivedBuild(ctx.db, fixture.build.id, 'clone', buyer.id);
        const { orderId } = await paidOrder(copy.quote.id, buyer);
        const [e] = await ctx.db.select().from(creatorEarnings).where(eq(creatorEarnings.orderId, orderId));
        expect(e).toMatchObject({ kind: 'MAKE_THIS_ROYALTY', creatorUserId: creator.id });

        // The creator ordering a copy of their own design earns nothing from it.
        const own = await derivedBuild(ctx.db, fixture.build.id, 'clone', creator.id);
        const mine = await paidOrder(own.quote.id, creator);
        expect(await ctx.db.select().from(creatorEarnings).where(eq(creatorEarnings.orderId, mine.orderId))).toHaveLength(0);
    });

    it('pays out through ops (manual) without Stripe, and through the Connect transfer path when connected', async () => {
        const { creator, viewer, fixture } = await creatorBuild(ctx.db);
        await publish(viewer, fixture.build.id, { royaltyPct: 10 });
        const buyer = await makeUser('buyer');
        const remix = await derivedBuild(ctx.db, fixture.build.id, 'remix', buyer.id);
        await paidOrder(remix.quote.id, buyer);
        const owed = (await creatorBalance(creator.id)).availableCents;
        expect(owed).toBeGreaterThan(0);

        const manual = await requestCreatorPayout(creator.id, { kind: 'buyer', id: creator.id });
        expect(manual).toMatchObject({ status: 'PENDING', method: 'manual', amountCents: owed });
        expect((await creatorBalance(creator.id)).availableCents).toBe(0);
        await expect(requestCreatorPayout(creator.id, { kind: 'buyer', id: creator.id })).rejects.toMatchObject({ status: 409 });

        // Ops marks it paid through the admin route (await requireAdmin, Bearer ADMIN_TOKEN).
        const denied = await markPaidRoute(req(`/api/admin/creator-payouts/${manual.id}/paid`, { body: { reference: 'ACH 42' } }), { params: Promise.resolve({ payoutId: manual.id }) });
        expect(denied.status).toBe(401);
        const paid = await markPaidRoute(req(`/api/admin/creator-payouts/${manual.id}/paid`, { body: { reference: 'ACH 42' }, headers: { authorization: 'Bearer test-admin-token' } }), { params: Promise.resolve({ payoutId: manual.id }) });
        expect(paid.status).toBe(200);
        expect(await paid.json()).toMatchObject({ status: 'PAID', providerRef: 'ACH 42' });
        const settle = await ctx.db.select().from(ledgerEntries).where(like(ledgerEntries.txnKey, `creator_payout%${manual.id}`));
        const net = ledgerBalances(settle);
        expect(net.PAYOUTS_IN_TRANSIT ?? 0).toBe(0);
        expect(net.CREATOR_PAYABLE).toBe(owed);
        expect(net.CASH).toBe(-owed);
        expect(await markCreatorPayoutPaid(manual.id, 'again')).toMatchObject({ status: 'PAID', providerRef: 'ACH 42' });

        // Connect: Stripe configured + payouts enabled on the creator's account -> transfer + settled at once.
        const remix2 = await derivedBuild(ctx.db, fixture.build.id, 'remix', buyer.id);
        await paidOrder(remix2.quote.id, buyer);
        process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
        resetEnvCache();
        await ctx.db.insert(creatorAccounts).values({ userId: creator.id, stripeAccountId: 'acct_creator1', stripePayoutsEnabled: true });
        const connect = await requestCreatorPayout(creator.id, { kind: 'buyer', id: creator.id });
        expect(connect).toMatchObject({ status: 'PAID', method: 'stripe_connect' });
        expect(connect.providerRef).toMatch(/^tr_/);
        expect(transferMock).toHaveBeenCalledWith(expect.objectContaining({ destination: 'acct_creator1', payoutId: connect.id, amountCents: connect.amountCents }));
        const payoutRows = await ctx.db.select().from(creatorPayouts).where(eq(creatorPayouts.creatorUserId, creator.id));
        expect(payoutRows.every((p) => p.status === 'PAID')).toBe(true);
        expect((await creatorBalance(creator.id)).availableCents).toBe(0);
    });

    it('insights aggregate earnings, orders, product mix and the remix tree from the same rows', async () => {
        const { creator, viewer, fixture } = await creatorBuild(ctx.db);
        await publish(viewer, fixture.build.id, { royaltyPct: 10, title: 'Lamp plate' });
        const buyer = await makeUser('buyer');
        const r1 = await derivedBuild(ctx.db, fixture.build.id, 'remix', buyer.id);
        const r2 = await derivedBuild(ctx.db, fixture.build.id, 'clone', buyer.id);
        const o1 = await paidOrder(r1.quote.id, buyer);
        const o2 = await paidOrder(r2.quote.id, buyer);
        const earned = (await ctx.db.select().from(creatorEarnings).where(eq(creatorEarnings.creatorUserId, creator.id))).reduce((s, e) => s + e.amountCents, 0);

        const view = await creatorInsights(creator.id, '30d');
        expect(view.totals).toMatchObject({ earningsCents: earned, royaltiesCents: earned, liveRevenueCents: 0, orders: 2, remixes: 2 });
        expect(view.series).toHaveLength(30);
        expect(view.series.reduce((s, d) => s + d.royaltiesCents, 0)).toBe(earned);
        expect(view.productMix).toEqual([expect.objectContaining({ buildId: fixture.build.id, title: 'Lamp plate', sharePct: 100, orders: 2 })]);
        expect(view.topBuilds[0]).toMatchObject({ buildId: fixture.build.id, orders: 2, remixes: 2, earningsCents: earned, published: true });
        expect(view.remixTree[0].children.map((c) => c.buildId).sort()).toEqual([r1.build.id, r2.build.id].sort());
        expect(new Set([o1.orderId, o2.orderId]).size).toBe(2);
        const week = await creatorInsights(creator.id, '7d');
        expect(week.series).toHaveLength(7);

        // Show stats come from the Live tables of the creator's channel.
        const channel = await upsertChannel(viewer, { name: 'Lamp channel', handle: `lamps_${Date.now().toString(36)}`.slice(0, 24), kind: 'creator', categories: ['workshop'] });
        const show = await createShow(viewer, { title: 'Lamp night', format: 'live_drop', scheduledFor: new Date().toISOString(), featuredBuildIds: [fixture.build.id] });
        await ctx.db.update(shows).set({ status: 'ENDED', startedAt: new Date(Date.now() - 600_000), endedAt: new Date(), peakViewers: 40, likeCount: 7 }).where(eq(shows.id, show.id));
        const withShows = await creatorInsights(creator.id, '30d');
        expect(channel.handle).toBeTruthy();
        expect(withShows.shows).toEqual([expect.objectContaining({ showId: show.id, peakViewers: 40, uniqueViewers: 40, likes: 7, slotsClaimed: 0, slotConversionPct: 0 })]);
        expect(withShows.totals).toMatchObject({ showViews: 40, likes: 7, slotConversionPct: 0 });
    });
});
