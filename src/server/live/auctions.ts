/**
 * Live auctions for one-of-ones (R5, workflow 06 "Live auctions", Whatnot Custom + Bid).
 *
 *   start_auction  the starting bid must cover an orderable BINDING quote at quantity 1
 *                  (creators cannot sell below cost); signed `auction.started`
 *   bid            under the auction row lock: amount >= current + min increment (or the
 *                  starting bid); a bid landing in the last 10 s extends the end by 15 s
 *                  (anti-snipe). Each bid is a LIVE_DROP order with an authorize-only payment for
 *                  bid + shipping; the bidder authorizes the hold (Stripe manual capture / dev
 *                  page). Signed `auction.bid`; the previous leader is told they were outbid.
 *   close          at `endsAt` (lazily on any read, by the cron sweep, or the host): the highest
 *                  bid whose hold is AUTHORIZED wins (an unauthorized top bid is void); signed
 *                  `auction.closed`. After commit the winner's hold is captured (order PAID ->
 *                  production) and every other hold is released (orders CANCELLED). Settlement
 *                  is idempotent and re-run by the sweep, so a crash never strands a hold.
 *
 * Lock order: auction row, then show row (appendLiveEvent), then payment rows.
 */
import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { Actor } from '../../contracts/common';
import { ANTI_SNIPE_EXTENSION_MS, ANTI_SNIPE_WINDOW_MS, type AuctionView, type HostIntent, type PlaceBidRequest, type PlaceBidResponse } from '../../contracts/live';
import { buildOrderUrl, createOrderAccessToken, hashOrderAccessToken } from '../auth/order-link';
import type { ViewerContext } from '../auth/viewer';
import { getDb, withTx, type DbOrTx } from '../db';
import { auctionBids, auctions, channels, orders, payments, quotes, shops } from '../db/schema';
import { env } from '../env';
import { emitEvent } from '../events/outbox';
import { ApiError } from '../http';
import { newId, newOrderNumber } from '../ids';
import { notify } from '../notify';
import { captureAuthorizedPayment, releaseOrderPayment } from '../orders/authorization';
import { promisedShipDateFor } from '../orders/checkout';
import { SEALED_TOKEN_KEY, orderUrlFromPaymentMetadata, sealOrderToken } from '../orders/link-vault';
import { getPaymentProvider } from '../payments';
import { CAPTURE_METHOD_METADATA_KEY } from '../payments/dev';
import { publicName, type ShowAccess } from './access';
import { bindingQuoteAt, minimumSlotPriceCents } from './drops';
import { appendLiveEvent, SYSTEM_LIVE_ACTOR, type LiveActor } from './events';
import { loadBuildFacts } from './featured';

type AuctionRow = typeof auctions.$inferSelect;
type BidRow = typeof auctionBids.$inferSelect;
type StartAuctionIntent = Extract<HostIntent, { intent: 'start_auction' }>;

const LIVE_SYSTEM_ACTOR: Actor = { kind: 'system', id: 'live' };
/** Holds stay valid this long after the auction ends, so a last-second bidder can still authorize. */
const BID_HOLD_GRACE_MS = 35 * 60_000;

export function nextMinimumBid(a: Pick<AuctionRow, 'currentBidCents' | 'startingBidCents' | 'minIncrementCents'>): number {
    return a.currentBidCents === null ? a.startingBidCents : a.currentBidCents + a.minIncrementCents;
}

/** Pure anti-snipe rule: a bid at `at` within the last 10 s moves the end 15 s later. */
export function antiSnipe(endsAt: Date, at: Date): { endsAt: Date; extended: boolean } {
    if (endsAt.getTime() - at.getTime() <= ANTI_SNIPE_WINDOW_MS) return { endsAt: new Date(endsAt.getTime() + ANTI_SNIPE_EXTENSION_MS), extended: true };
    return { endsAt, extended: false };
}

async function viewerBidFor(db: DbOrTx, auctionId: string, viewerId: string | null): Promise<AuctionView['viewerBid']> {
    if (!viewerId) return null;
    const [row] = await db
        .select({ bid: auctionBids, payment: payments })
        .from(auctionBids)
        .leftJoin(payments, eq(payments.orderId, auctionBids.orderId))
        .where(and(eq(auctionBids.auctionId, auctionId), eq(auctionBids.userId, viewerId)))
        .orderBy(desc(auctionBids.amountCents))
        .limit(1);
    if (!row) return null;
    const authorized = row.payment?.status === 'AUTHORIZED' || row.payment?.status === 'SUCCEEDED';
    return {
        bidId: row.bid.id,
        amountCents: row.bid.amountCents,
        status: row.bid.status,
        authorized,
        checkoutUrl: !authorized && row.bid.status === 'PLACED' ? row.bid.checkoutUrl : null,
        orderUrl: orderUrlFromPaymentMetadata(row.bid.orderId, row.payment?.metadata),
    };
}

export async function toAuctionView(row: AuctionRow, viewerId: string | null, db: DbOrTx = getDb()): Promise<AuctionView> {
    const viewerBid = await viewerBidFor(db, row.id, viewerId);
    let winner: string | null = null;
    if (row.winningBidId) {
        const [w] = await db.select({ name: auctionBids.bidderName }).from(auctionBids).where(eq(auctionBids.id, row.winningBidId));
        winner = w?.name ?? null;
    }
    let viewerIsLeading = false;
    if (viewerId && row.leadingBidId) {
        const [lead] = await db.select({ userId: auctionBids.userId }).from(auctionBids).where(eq(auctionBids.id, row.leadingBidId));
        viewerIsLeading = lead?.userId === viewerId;
    }
    return {
        id: row.id,
        showId: row.showId,
        buildId: row.buildId,
        title: row.title,
        currency: row.currency,
        startingBidCents: row.startingBidCents,
        minIncrementCents: row.minIncrementCents,
        currentBidCents: row.currentBidCents,
        nextMinimumBidCents: nextMinimumBid(row),
        bidCount: row.bidCount,
        leadingBidder: row.leadingBidderName,
        status: row.status,
        endsAt: row.endsAt.toISOString(),
        originalEndsAt: row.originalEndsAt.toISOString(),
        extensions: row.extensions,
        closedAt: row.closedAt?.toISOString() ?? null,
        winner,
        viewerIsLeading,
        viewerBid,
    };
}

/** Public part of the view, as carried by signed events (no viewer fields). */
function eventView(row: AuctionRow) {
    return {
        id: row.id,
        title: row.title,
        currency: row.currency,
        startingBidCents: row.startingBidCents,
        minIncrementCents: row.minIncrementCents,
        currentBidCents: row.currentBidCents,
        nextMinimumBidCents: nextMinimumBid(row),
        bidCount: row.bidCount,
        leadingBidder: row.leadingBidderName,
        status: row.status,
        endsAt: row.endsAt.toISOString(),
        originalEndsAt: row.originalEndsAt.toISOString(),
        extensions: row.extensions,
    };
}

export async function startAuction(access: ShowAccess, intent: StartAuctionIntent, actor: LiveActor): Promise<AuctionView> {
    const { show, channel } = access;
    if (show.status !== 'LIVE' && show.status !== 'SCHEDULED') throw new ApiError('CONFLICT', 'Auctions run before or during a show.');
    const quote = await bindingQuoteAt(intent.buildId, 1);
    const floor = minimumSlotPriceCents(quote);
    if (intent.startingBidCents < floor) {
        throw new ApiError('CONFLICT', `The starting bid is below production cost: the binding quote for one is ${(floor / 100).toFixed(2)} ${quote.currency.toUpperCase()}.`, 409, { minimumPriceCents: floor, quoteId: quote.id });
    }
    const now = new Date();
    const endsAt = new Date(now.getTime() + intent.durationSeconds * 1000);
    if (endsAt.getTime() > quote.validUntil.getTime()) throw new ApiError('CONFLICT', 'The auction must end before its binding quote expires.');
    const facts = await loadBuildFacts(intent.buildId);
    const row = await withTx(async (tx) => {
        const [open] = await tx
            .select({ id: auctions.id })
            .from(auctions)
            .where(and(eq(auctions.showId, show.id), eq(auctions.status, 'OPEN')))
            .limit(1);
        if (open) throw new ApiError('CONFLICT', 'An auction is already running on this show. Close it first.');
        const [inserted] = await tx
            .insert(auctions)
            .values({
                showId: show.id,
                channelId: channel.id,
                buildId: intent.buildId,
                quoteId: quote.id,
                title: facts?.build.name ?? 'Live auction',
                currency: quote.currency,
                startingBidCents: intent.startingBidCents,
                minIncrementCents: intent.minIncrementCents,
                opensAt: now,
                endsAt,
                originalEndsAt: endsAt,
                createdBy: actor.id,
            })
            .returning();
        await appendLiveEvent(
            show.id,
            {
                event: 'auction.started',
                actor,
                buildId: inserted.buildId,
                designVersion: quote.designVersion,
                payload: { auction: eventView(inserted) },
                at: now,
                domain: {
                    type: 'auction.started',
                    payload: { auctionId: inserted.id, showId: show.id, buildId: inserted.buildId, quoteId: quote.id, startingBidCents: inserted.startingBidCents, minIncrementCents: inserted.minIncrementCents, endsAt: endsAt.toISOString() },
                    actor: LIVE_SYSTEM_ACTOR,
                    correlationId: show.id,
                    buildId: inserted.buildId,
                },
            },
            tx,
        );
        return inserted;
    });
    return toAuctionView(row, actor.id);
}

/**
 * Place a bid. Serialized per auction by the row lock; returns where the bidder authorizes
 * the hold. Only authorized bids can win, so a bidder who never authorizes cannot block the sale.
 */
export async function placeBid(auctionId: string, viewer: ViewerContext, input: PlaceBidRequest, now: Date = new Date()): Promise<PlaceBidResponse> {
    await maybeCloseAuction(auctionId, now);
    const provider = getPaymentProvider();
    const appUrl = env().APP_URL;
    const userId = viewer.user.id;
    let outbid: { email: string; amount: number } | null = null;

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const result = await withTx(async (tx) => {
                const [auction] = await tx.select().from(auctions).where(eq(auctions.id, auctionId)).for('update');
                if (!auction) throw new ApiError('NOT_FOUND', 'Auction not found');
                if (auction.status !== 'OPEN' || auction.endsAt.getTime() <= now.getTime()) throw new ApiError('CONFLICT', 'This auction has ended.');
                const [channel] = await tx.select({ ownerUserId: channels.ownerUserId }).from(channels).where(eq(channels.id, auction.channelId));
                if (channel?.ownerUserId === userId) throw new ApiError('FORBIDDEN', 'You cannot bid on your own auction.', 403);
                const minimum = nextMinimumBid(auction);
                if (input.amountCents < minimum) throw new ApiError('CONFLICT', `Bid at least ${(minimum / 100).toFixed(2)} ${auction.currency.toUpperCase()}.`, 409, { nextMinimumBidCents: minimum });
                const [quote] = await tx.select().from(quotes).where(eq(quotes.id, auction.quoteId));
                if (!quote) throw new ApiError('CONFLICT', 'This auction is no longer available.');
                const shipping = quote.shippingOptions.find((o) => o.method === input.shippingMethod);
                if (!shipping) throw new ApiError('VALIDATION_FAILED', `Shipping method ${input.shippingMethod} is not available for this auction.`);
                const [shop] = await tx.select({ timezone: shops.timezone }).from(shops).where(eq(shops.id, quote.shopId));
                const previousLeader = auction.leadingBidId ? (await tx.select().from(auctionBids).where(eq(auctionBids.id, auction.leadingBidId)))[0] : null;

                const subtotalCents = input.amountCents;
                const shopCostCents = Math.min(subtotalCents, Math.round(quote.shopCostCents / Math.max(1, quote.quantity)));
                const platformFeeCents = subtotalCents - shopCostCents;
                const totalCents = subtotalCents + shipping.priceCents;
                const orderId = newId('order');
                const orderNumber = newOrderNumber();
                const bidId = newId('auctionBid');
                const token = createOrderAccessToken();
                const orderUrl = buildOrderUrl(orderId, token, appUrl);
                const snipe = antiSnipe(auction.endsAt, now);

                await tx.insert(orders).values({
                    id: orderId,
                    orderNumber,
                    buildId: auction.buildId,
                    quoteId: quote.id,
                    orderType: 'LIVE_DROP',
                    status: 'PENDING_PAYMENT',
                    buyerEmail: viewer.user.email,
                    buyerName: input.buyer.name,
                    buyerPhone: input.buyer.phone ?? null,
                    shippingAddress: input.shippingAddress,
                    shippingMethod: input.shippingMethod,
                    notes: `Auction bid · ${auction.title} · auction ${auction.id}`,
                    quantity: 1,
                    unitPriceCents: subtotalCents,
                    subtotalCents,
                    shippingCents: shipping.priceCents,
                    taxCents: 0,
                    totalCents,
                    shopCostCents,
                    platformFeeCents,
                    currency: auction.currency,
                    promisedShipDate: promisedShipDateFor(quote, shop?.timezone ?? 'America/New_York', snipe.endsAt),
                    buyerUserId: userId,
                    accessTokenHash: hashOrderAccessToken(orderId, token),
                    correlationId: auction.buildId,
                    termsAcceptedAt: now,
                    createdAt: now,
                    updatedAt: now,
                });
                await emitEvent(tx, {
                    type: 'order.created',
                    payload: { orderId, orderNumber, quoteId: quote.id, orderType: 'LIVE_DROP', totalCents, currency: auction.currency },
                    actor: { kind: 'buyer', id: userId },
                    correlationId: auction.buildId,
                    buildId: auction.buildId,
                    orderId,
                    timestamp: now,
                });
                const returnTo = auction.showId ? `/live/${encodeURIComponent(auction.showId)}?bid=${encodeURIComponent(bidId)}` : `/orders/${orderId}`;
                let session;
                try {
                    session = await provider.createPayment({
                        orderId,
                        orderNumber,
                        amountCents: totalCents,
                        currency: auction.currency,
                        buyerEmail: viewer.user.email,
                        description: `${orderNumber} · bid on ${auction.title} (charged only if you win)`,
                        successUrl: new URL(returnTo, appUrl).toString(),
                        cancelUrl: new URL(`${returnTo}${returnTo.includes('?') ? '&' : '?'}cancelled=1`, appUrl).toString(),
                        metadata: { dm_auction_id: auction.id, dm_bid_id: bidId, dm_build_id: auction.buildId, dm_app: new URL(appUrl).host },
                        expiresAt: new Date(snipe.endsAt.getTime() + BID_HOLD_GRACE_MS),
                        captureMethod: 'manual',
                    });
                } catch (err) {
                    console.error('[live] payment provider error on bid', err);
                    throw new ApiError('PAYMENT_ERROR', 'We could not start the payment hold for your bid. Please try again.');
                }
                await tx.insert(payments).values({
                    orderId,
                    provider: provider.name,
                    providerRef: session.providerRef,
                    amountCents: totalCents,
                    currency: auction.currency,
                    status: 'PENDING',
                    metadata: { [SEALED_TOKEN_KEY]: sealOrderToken(orderId, token), [CAPTURE_METHOD_METADATA_KEY]: 'manual', auctionId: auction.id, bidId },
                    createdAt: now,
                    updatedAt: now,
                });
                const bidderName = publicName(viewer);
                await tx.insert(auctionBids).values({ id: bidId, auctionId, userId, buyerEmail: viewer.user.email, bidderName, amountCents: input.amountCents, orderId, checkoutUrl: session.redirectUrl, createdAt: now, updatedAt: now });
                const [updated] = await tx
                    .update(auctions)
                    .set({
                        currentBidCents: input.amountCents,
                        leadingBidId: bidId,
                        leadingBidderName: bidderName,
                        bidCount: sql`${auctions.bidCount} + 1`,
                        endsAt: snipe.endsAt,
                        extensions: snipe.extended ? sql`${auctions.extensions} + 1` : sql`${auctions.extensions}`,
                        updatedAt: now,
                    })
                    .where(eq(auctions.id, auctionId))
                    .returning();
                if (auction.showId) {
                    await appendLiveEvent(
                        auction.showId,
                        {
                            event: 'auction.bid',
                            actor: SYSTEM_LIVE_ACTOR,
                            buildId: auction.buildId,
                            payload: { auctionId, bidder: bidderName, amountCents: input.amountCents, extended: snipe.extended, auction: eventView(updated) },
                            at: now,
                            domain: {
                                type: 'auction.bid_placed',
                                payload: { auctionId, bidId, orderId, amountCents: input.amountCents, endsAt: updated.endsAt.toISOString(), extended: snipe.extended },
                                actor: LIVE_SYSTEM_ACTOR,
                                correlationId: auction.showId,
                                buildId: auction.buildId,
                            },
                        },
                        tx,
                    );
                }
                outbid = previousLeader && previousLeader.userId !== userId ? { email: previousLeader.buyerEmail, amount: input.amountCents } : null;
                return {
                    bidId,
                    orderId,
                    amountCents: input.amountCents,
                    totalCents,
                    checkoutUrl: session.redirectUrl,
                    orderUrl,
                    extended: snipe.extended,
                    auction: await toAuctionView(updated, userId, tx),
                    payment: { provider: provider.name, providerRef: session.providerRef },
                } satisfies PlaceBidResponse;
            });
            const o = outbid as { email: string; amount: number } | null;
            if (o) {
                await notify('auction.outbid', {
                    to: o.email,
                    auctionTitle: result.auction.title,
                    amountCents: o.amount,
                    currency: result.auction.currency,
                    nextMinimumCents: result.auction.nextMinimumBidCents,
                    showUrl: new URL(result.auction.showId ? `/live/${result.auction.showId}` : '/live', appUrl).toString(),
                });
            }
            return result;
        } catch (err) {
            const e = err as { code?: string; constraint_name?: string; cause?: { code?: string; constraint_name?: string } };
            const constraint = e.constraint_name ?? e.cause?.constraint_name;
            if ((e.code === '23505' || e.cause?.code === '23505') && constraint === 'orders_order_number_uq' && attempt < 2) continue;
            throw err;
        }
    }
    throw new ApiError('INTERNAL', 'Could not allocate an order number');
}

/**
 * Close an auction (idempotent). The highest bid with an AUTHORIZED hold wins; unauthorized bids
 * are void. Host close before the end with no bids cancels it. Settlement runs after commit.
 */
export async function closeAuction(auctionId: string, actor: LiveActor, reason: 'host' | 'deadline', now: Date = new Date()): Promise<AuctionView> {
    const closed = await withTx(async (tx) => {
        const [auction] = await tx.select().from(auctions).where(eq(auctions.id, auctionId)).for('update');
        if (!auction) throw new ApiError('NOT_FOUND', 'Auction not found');
        if (auction.status !== 'OPEN') return auction;
        const bids = await tx
            .select({ bid: auctionBids, paymentStatus: payments.status })
            .from(auctionBids)
            .leftJoin(payments, eq(payments.orderId, auctionBids.orderId))
            .where(eq(auctionBids.auctionId, auctionId))
            .orderBy(desc(auctionBids.amountCents));
        const winner = bids.find((b) => b.paymentStatus === 'AUTHORIZED');
        const status = bids.length === 0 && reason === 'host' && auction.endsAt.getTime() > now.getTime() ? ('CANCELLED' as const) : winner ? ('SOLD' as const) : ('UNSOLD' as const);
        for (const b of bids) {
            const next = winner && b.bid.id === winner.bid.id ? 'WON' : b.paymentStatus === 'AUTHORIZED' ? 'LOST' : 'VOID';
            await tx.update(auctionBids).set({ status: next, updatedAt: now }).where(eq(auctionBids.id, b.bid.id));
        }
        const [row] = await tx
            .update(auctions)
            .set({ status, winningBidId: winner?.bid.id ?? null, closedAt: now, updatedAt: now })
            .where(eq(auctions.id, auctionId))
            .returning();
        if (auction.showId) {
            await appendLiveEvent(
                auction.showId,
                {
                    event: 'auction.closed',
                    actor,
                    buildId: auction.buildId,
                    payload: { auctionId, status, winner: winner?.bid.bidderName ?? null, amountCents: winner?.bid.amountCents ?? null, reason, auction: eventView(row) },
                    at: now,
                    domain: {
                        type: 'auction.closed',
                        payload: { auctionId, status, winningBidId: winner?.bid.id ?? null, amountCents: winner?.bid.amountCents ?? null, bidCount: bids.length },
                        actor: LIVE_SYSTEM_ACTOR,
                        correlationId: auction.showId,
                        buildId: auction.buildId,
                    },
                },
                tx,
            );
        }
        return row;
    });
    await settleAuction(auctionId);
    const [fresh] = await getDb().select().from(auctions).where(eq(auctions.id, auctionId));
    return toAuctionView(fresh ?? closed, null);
}

/** Capture the winner's hold and release every other one. Safe to re-run (each step locks and checks its payment). */
export async function settleAuction(auctionId: string): Promise<{ captured: number; released: number }> {
    const db = getDb();
    const [auction] = await db.select().from(auctions).where(eq(auctions.id, auctionId));
    if (!auction || auction.status === 'OPEN') return { captured: 0, released: 0 };
    const bids = await db.select({ bid: auctionBids, payment: payments }).from(auctionBids).leftJoin(payments, eq(payments.orderId, auctionBids.orderId)).where(eq(auctionBids.auctionId, auctionId)).orderBy(asc(auctionBids.createdAt));
    let captured = 0;
    let released = 0;
    for (const { bid, payment } of bids) {
        if (bid.id === auction.winningBidId) {
            if (payment?.status === 'SUCCEEDED') continue;
            try {
                if (await captureAuthorizedPayment(bid.orderId)) {
                    captured++;
                    const [order] = await db.select({ orderNumber: orders.orderNumber }).from(orders).where(eq(orders.id, bid.orderId));
                    await notify('auction.won', { to: bid.buyerEmail, auctionTitle: auction.title, amountCents: bid.amountCents, currency: auction.currency, orderNumber: order?.orderNumber ?? '' });
                }
            } catch (err) {
                console.error(`[live] capturing the winning bid ${bid.id} failed; the sweep retries`, err);
                await notify('ops.alert', { subject: `Auction capture failed (${auction.title})`, message: `Capturing the winning hold for bid ${bid.id} (order ${bid.orderId}) failed: ${err instanceof Error ? err.message : String(err)}.`, orderId: bid.orderId });
            }
            continue;
        }
        if (!payment || payment.status === 'CANCELLED' || payment.status === 'SUCCEEDED' || payment.status === 'REFUNDED') continue;
        try {
            if (await releaseOrderPayment(bid.orderId, auction.status === 'SOLD' ? 'Another bid won the auction.' : 'The auction closed without a sale.', LIVE_SYSTEM_ACTOR)) released++;
        } catch (err) {
            console.error(`[live] releasing bid ${bid.id} failed; the sweep retries`, err);
        }
    }
    return { captured, released };
}

/** Lazily close an auction past its end. */
export async function maybeCloseAuction(auctionId: string, now: Date = new Date()): Promise<void> {
    const [a] = await getDb().select({ status: auctions.status, endsAt: auctions.endsAt }).from(auctions).where(eq(auctions.id, auctionId));
    if (a?.status === 'OPEN' && a.endsAt.getTime() <= now.getTime()) await closeAuction(auctionId, SYSTEM_LIVE_ACTOR, 'deadline', now);
}

/** Cron / admin: close every overdue auction and finish interrupted settlement. */
export async function sweepAuctions(now: Date = new Date()): Promise<{ closed: number }> {
    const db = getDb();
    const overdue = await db.select({ id: auctions.id }).from(auctions).where(and(eq(auctions.status, 'OPEN'), lte(auctions.endsAt, now)));
    for (const a of overdue) await closeAuction(a.id, SYSTEM_LIVE_ACTOR, 'deadline', now);
    const unsettled = await db
        .selectDistinct({ id: auctions.id })
        .from(auctions)
        .innerJoin(auctionBids, eq(auctionBids.auctionId, auctions.id))
        .innerJoin(payments, eq(payments.orderId, auctionBids.orderId))
        .where(and(inArray(auctions.status, ['SOLD', 'UNSOLD', 'CANCELLED']), inArray(payments.status, ['PENDING', 'AUTHORIZED'])));
    for (const a of unsettled) await settleAuction(a.id);
    return { closed: overdue.length };
}

export async function getAuctionView(auctionId: string, viewerId: string | null): Promise<AuctionView | null> {
    await maybeCloseAuction(auctionId);
    const [row] = await getDb().select().from(auctions).where(eq(auctions.id, auctionId));
    return row ? toAuctionView(row, viewerId) : null;
}

/** The show's open auction, else its latest one (snapshot). */
export async function auctionViewForShow(showId: string, viewerId: string | null): Promise<AuctionView | null> {
    const db = getDb();
    const [open] = await db.select().from(auctions).where(and(eq(auctions.showId, showId), eq(auctions.status, 'OPEN'))).limit(1);
    if (open) {
        await maybeCloseAuction(open.id);
        const [fresh] = await db.select().from(auctions).where(eq(auctions.id, open.id));
        return toAuctionView(fresh ?? open, viewerId);
    }
    const [latest] = await db.select().from(auctions).where(eq(auctions.showId, showId)).orderBy(desc(auctions.createdAt)).limit(1);
    return latest ? toAuctionView(latest, viewerId) : null;
}

export type { BidRow };
