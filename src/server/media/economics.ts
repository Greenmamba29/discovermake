/**
 * Creator economics (workflow 08 "Economics", docs/architecture/r5-media.md §3).
 *
 * Postings (txn_key unique per business event, ON CONFLICT DO NOTHING; every txn balances):
 *   creator:<orderId>:<kind>          DEBIT PLATFORM_REVENUE   / CREDIT CREATOR_PAYABLE  (accrual on payment)
 *   creator_reversal:<orderId>:<kind> DEBIT CREATOR_PAYABLE    / CREDIT PLATFORM_REVENUE (full refund)
 *   creator_payout:<payoutId>         DEBIT CREATOR_PAYABLE    / CREDIT PAYOUTS_IN_TRANSIT
 *   creator_payout_settle:<payoutId>  DEBIT PAYOUTS_IN_TRANSIT / CREDIT CASH            (transfer / ops paid)
 *   creator_payout_fail:<payoutId>    DEBIT PAYOUTS_IN_TRANSIT / CREDIT CREATOR_PAYABLE  (transfer failed)
 * `creator_earnings` is the per-creator subledger (one row per txn above that moves a balance).
 *
 * Who earns on a paid order (V1):
 *   - live revenue: a BUILD_SLOT order of the creator's own drop, or the winning bid of their auction:
 *     the platform fee minus the platform fee the binding quote already carries for that
 *     quantity (i.e. the creator's markup over the binding price);
 *   - royalty: the order's build was forked (clone = Make This, remix) from a published build:
 *     royalty % of the order subtotal (excl. shipping and tax) to the DIRECT parent's creator
 *     (multi-level splits are deferred), capped at the platform fee left after live revenue, so
 *     the platform never pays more than it earns. No royalty to yourself (buyer, owner of the
 *     derivative or the drop host = the parent's creator).
 */
import 'server-only';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { SYSTEM_ACTOR, type Actor } from '../../contracts/common';
import type { CreatorBalance, CreatorEarningKind, CreatorEarningView, CreatorPayoutView, CreatorPayoutsResponse } from '../../contracts/media';
import { getDb, withTx, type DbOrTx } from '../db';
import { auctionBids, auctions, buildPublications, builds, channels, creatorAccounts, creatorEarnings, creatorPayouts, drops, orders, quotes, slotClaims, users } from '../db/schema';
import { env } from '../env';
import { emitEvent } from '../events/outbox';
import { ApiError } from '../http';
import { postTransaction } from '../ledger';

type OrderRow = typeof orders.$inferSelect;
type QuoteRow = typeof quotes.$inferSelect;

/** Smallest creator payout (Stripe transfers below $1 are not worth the fees). */
export const MIN_CREATOR_PAYOUT_CENTS = 100;

const PAID_LIKE = new Set(['PAID', 'DISPATCHED', 'ACCEPTED', 'IN_PRODUCTION', 'QA_FAILED', 'QA_PASSED', 'SHIPPED', 'DELIVERED', 'COMPLETE']);

export const creatorTxnKeys = {
    accrual: (orderId: string, kind: CreatorEarningKind) => `creator:${orderId}:${kind}`,
    reversal: (orderId: string, kind: CreatorEarningKind) => `creator_reversal:${orderId}:${kind}`,
    payout: (payoutId: string) => `creator_payout:${payoutId}`,
    settle: (payoutId: string) => `creator_payout_settle:${payoutId}`,
    fail: (payoutId: string) => `creator_payout_fail:${payoutId}`,
};

export type PlannedEarning = { creatorUserId: string; kind: CreatorEarningKind; amountCents: number; sourceBuildId: string | null };

/** The platform fee the binding quote already carries for `quantity` units (never below 0). */
function quoteFeeFor(quote: Pick<QuoteRow, 'platformFeeCents' | 'quantity'>, quantity: number): number {
    return Math.max(0, Math.round((quote.platformFeeCents * quantity) / Math.max(1, quote.quantity)));
}

/** Pure split used by accrual and tests: live share first, then the royalty capped by what is left. */
export function splitCreatorEarnings(input: {
    subtotalCents: number;
    platformFeeCents: number;
    liveShare: { creatorUserId: string; quoteFeeCents: number; kind: 'DROP_REVENUE' | 'AUCTION_REVENUE'; sourceBuildId: string } | null;
    royalty: { creatorUserId: string; pct: number; kind: 'REMIX_ROYALTY' | 'MAKE_THIS_ROYALTY'; sourceBuildId: string } | null;
}): PlannedEarning[] {
    const out: PlannedEarning[] = [];
    let left = Math.max(0, input.platformFeeCents);
    if (input.liveShare) {
        const amount = Math.max(0, Math.min(left, input.platformFeeCents - input.liveShare.quoteFeeCents));
        if (amount > 0) {
            out.push({ creatorUserId: input.liveShare.creatorUserId, kind: input.liveShare.kind, amountCents: amount, sourceBuildId: input.liveShare.sourceBuildId });
            left -= amount;
        }
    }
    if (input.royalty && input.royalty.pct > 0) {
        const amount = Math.min(left, Math.floor((input.subtotalCents * input.royalty.pct) / 100));
        if (amount > 0) out.push({ creatorUserId: input.royalty.creatorUserId, kind: input.royalty.kind, amountCents: amount, sourceBuildId: input.royalty.sourceBuildId });
    }
    return out;
}

/** Work out who earns what on `order` (no writes). */
export async function planCreatorEarnings(tx: DbOrTx, order: OrderRow): Promise<PlannedEarning[]> {
    let liveShare: Parameters<typeof splitCreatorEarnings>[0]['liveShare'] = null;
    let liveCreator: string | null = null;
    if (order.orderType === 'BUILD_SLOT') {
        const [row] = await tx
            .select({ owner: channels.ownerUserId, quote: quotes, buildId: drops.buildId })
            .from(slotClaims)
            .innerJoin(drops, eq(drops.id, slotClaims.dropId))
            .innerJoin(channels, eq(channels.id, drops.channelId))
            .innerJoin(quotes, eq(quotes.id, drops.quoteId))
            .where(eq(slotClaims.orderId, order.id))
            .limit(1);
        if (row?.owner) {
            liveCreator = row.owner;
            liveShare = { creatorUserId: row.owner, quoteFeeCents: quoteFeeFor(row.quote, order.quantity), kind: 'DROP_REVENUE', sourceBuildId: row.buildId };
        }
    } else if (order.orderType === 'LIVE_DROP') {
        const [row] = await tx
            .select({ owner: channels.ownerUserId, quote: quotes, buildId: auctions.buildId })
            .from(auctionBids)
            .innerJoin(auctions, eq(auctions.id, auctionBids.auctionId))
            .innerJoin(channels, eq(channels.id, auctions.channelId))
            .innerJoin(quotes, eq(quotes.id, auctions.quoteId))
            .where(eq(auctionBids.orderId, order.id))
            .limit(1);
        if (row?.owner) {
            liveCreator = row.owner;
            liveShare = { creatorUserId: row.owner, quoteFeeCents: quoteFeeFor(row.quote, order.quantity), kind: 'AUCTION_REVENUE', sourceBuildId: row.buildId };
        }
    }

    let royalty: Parameters<typeof splitCreatorEarnings>[0]['royalty'] = null;
    const [build] = await tx.select({ id: builds.id, origin: builds.origin, ownerUserId: builds.ownerUserId, parentId: builds.derivedFromBuildId }).from(builds).where(eq(builds.id, order.buildId));
    if (build?.parentId) {
        const [pub] = await tx.select().from(buildPublications).where(eq(buildPublications.buildId, build.parentId)).limit(1);
        if (pub && pub.royaltyPct > 0) {
            const [creator] = await tx.select({ email: users.email }).from(users).where(eq(users.id, pub.ownerUserId));
            const self =
                pub.ownerUserId === order.buyerUserId ||
                (!!creator && creator.email.toLowerCase() === order.buyerEmail.toLowerCase()) ||
                pub.ownerUserId === build.ownerUserId ||
                pub.ownerUserId === liveCreator;
            if (!self) royalty = { creatorUserId: pub.ownerUserId, pct: pub.royaltyPct, kind: build.origin === 'clone' ? 'MAKE_THIS_ROYALTY' : 'REMIX_ROYALTY', sourceBuildId: pub.buildId };
        }
    }
    return splitCreatorEarnings({ subtotalCents: order.subtotalCents, platformFeeCents: order.platformFeeCents, liveShare, royalty });
}

/**
 * Accrue creator earnings for a PAID order inside the payment transaction (called from
 * handlePaymentSucceeded right after the payment split). Idempotent per (order, creator, kind).
 */
export async function accrueCreatorEarnings(orderId: string, tx: DbOrTx): Promise<PlannedEarning[]> {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId));
    if (!order || !PAID_LIKE.has(order.status)) return [];
    const planned = await planCreatorEarnings(tx, order);
    const accrued: PlannedEarning[] = [];
    for (const e of planned) {
        const txnKey = creatorTxnKeys.accrual(order.id, e.kind);
        const [row] = await tx
            .insert(creatorEarnings)
            .values({ creatorUserId: e.creatorUserId, kind: e.kind, orderId: order.id, buildId: order.buildId, sourceBuildId: e.sourceBuildId, amountCents: e.amountCents, currency: order.currency, txnKey })
            .onConflictDoNothing()
            .returning({ id: creatorEarnings.id });
        if (!row) continue;
        await postTransaction(
            tx,
            txnKey,
            [
                { account: 'PLATFORM_REVENUE', direction: 'DEBIT', amountCents: e.amountCents, memo: `${e.kind} to creator ${e.creatorUserId}` },
                { account: 'CREATOR_PAYABLE', direction: 'CREDIT', amountCents: e.amountCents, memo: `Owed to creator ${e.creatorUserId}` },
            ],
            { orderId: order.id, currency: order.currency },
        );
        await emitEvent(tx, {
            type: 'royalty.accrued',
            payload: { orderId: order.id, creatorUserId: e.creatorUserId, kind: e.kind as 'REMIX_ROYALTY' | 'MAKE_THIS_ROYALTY' | 'DROP_REVENUE' | 'AUCTION_REVENUE', amountCents: e.amountCents, sourceBuildId: e.sourceBuildId, txnKey },
            actor: SYSTEM_ACTOR,
            correlationId: order.correlationId,
            buildId: order.buildId,
            orderId: order.id,
        });
        accrued.push(e);
    }
    return accrued;
}

/** Reverse every earning of a refunded order (full refunds; called from applyFullRefund). Idempotent. */
export async function reverseCreatorEarnings(orderId: string, tx: DbOrTx): Promise<number> {
    const rows = await tx.select().from(creatorEarnings).where(eq(creatorEarnings.orderId, orderId));
    const accruals = rows.filter((r) => r.amountCents > 0);
    let reversed = 0;
    for (const a of accruals) {
        const kind: CreatorEarningKind = a.kind === 'REMIX_ROYALTY' || a.kind === 'MAKE_THIS_ROYALTY' ? 'ROYALTY_REVERSAL' : 'REVENUE_REVERSAL';
        const txnKey = creatorTxnKeys.reversal(orderId, a.kind);
        const [row] = await tx
            .insert(creatorEarnings)
            .values({ creatorUserId: a.creatorUserId, kind, orderId, buildId: a.buildId, sourceBuildId: a.sourceBuildId, amountCents: -a.amountCents, currency: a.currency, txnKey })
            .onConflictDoNothing()
            .returning({ id: creatorEarnings.id });
        if (!row) continue;
        await postTransaction(
            tx,
            txnKey,
            [
                { account: 'CREATOR_PAYABLE', direction: 'DEBIT', amountCents: a.amountCents, memo: `Reversed ${a.kind} (refund)` },
                { account: 'PLATFORM_REVENUE', direction: 'CREDIT', amountCents: a.amountCents, memo: `Reversed ${a.kind} (refund)` },
            ],
            { orderId, currency: a.currency },
        );
        const [order] = await tx.select({ correlationId: orders.correlationId, buildId: orders.buildId }).from(orders).where(eq(orders.id, orderId));
        await emitEvent(tx, {
            type: 'royalty.reversed',
            payload: { orderId, creatorUserId: a.creatorUserId, amountCents: a.amountCents, txnKey },
            actor: SYSTEM_ACTOR,
            correlationId: order?.correlationId ?? orderId,
            buildId: order?.buildId ?? null,
            orderId,
        });
        reversed++;
    }
    return reversed;
}

// ---------------------------------------------------------------------------
// Balance + payouts
// ---------------------------------------------------------------------------

export async function creatorBalance(userId: string, db: DbOrTx = getDb()): Promise<CreatorBalance> {
    const [earned] = await db
        .select({ total: sql<number>`coalesce(sum(${creatorEarnings.amountCents}), 0)::int`, accrued: sql<number>`coalesce(sum(${creatorEarnings.amountCents}) filter (where ${creatorEarnings.amountCents} > 0), 0)::int` })
        .from(creatorEarnings)
        .where(eq(creatorEarnings.creatorUserId, userId));
    const payoutRows = await db.select({ status: creatorPayouts.status, amount: creatorPayouts.amountCents }).from(creatorPayouts).where(eq(creatorPayouts.creatorUserId, userId));
    const paidOut = payoutRows.filter((p) => p.status === 'PAID').reduce((s, p) => s + p.amount, 0);
    const inTransit = payoutRows.filter((p) => p.status === 'PENDING').reduce((s, p) => s + p.amount, 0);
    const total = Number(earned?.total ?? 0);
    return { availableCents: total - paidOut - inTransit, inTransitCents: inTransit, lifetimeEarnedCents: total, paidOutCents: paidOut, currency: 'usd' };
}

function toPayoutView(p: typeof creatorPayouts.$inferSelect): CreatorPayoutView {
    return {
        id: p.id,
        amountCents: p.amountCents,
        currency: p.currency,
        status: p.status,
        method: p.method === 'stripe_connect' ? 'stripe_connect' : 'manual',
        providerRef: p.providerRef,
        createdAt: p.createdAt.toISOString(),
        paidAt: p.paidAt?.toISOString() ?? null,
    };
}

export async function creatorPayoutsView(userId: string): Promise<CreatorPayoutsResponse> {
    const db = getDb();
    const [balance, earningRows, payoutRows, [account]] = await Promise.all([
        creatorBalance(userId, db),
        db
            .select({ e: creatorEarnings, orderNumber: orders.orderNumber, title: builds.name })
            .from(creatorEarnings)
            .innerJoin(orders, eq(orders.id, creatorEarnings.orderId))
            .innerJoin(builds, eq(builds.id, creatorEarnings.buildId))
            .where(eq(creatorEarnings.creatorUserId, userId))
            .orderBy(desc(creatorEarnings.createdAt))
            .limit(50),
        db.select().from(creatorPayouts).where(eq(creatorPayouts.creatorUserId, userId)).orderBy(desc(creatorPayouts.createdAt)).limit(50),
        db.select().from(creatorAccounts).where(eq(creatorAccounts.userId, userId)),
    ]);
    const earnings: CreatorEarningView[] = earningRows.map(({ e, orderNumber, title }) => ({
        id: e.id,
        kind: e.kind,
        amountCents: e.amountCents,
        currency: e.currency,
        orderNumber,
        buildId: e.buildId,
        buildTitle: title,
        sourceBuildId: e.sourceBuildId,
        createdAt: e.createdAt.toISOString(),
    }));
    return {
        balance,
        minimumPayoutCents: MIN_CREATOR_PAYOUT_CENTS,
        earnings,
        payouts: payoutRows.map(toPayoutView),
        connect: { stripeConfigured: !!env().STRIPE_SECRET_KEY, connected: !!account?.stripeAccountId, payoutsEnabled: !!account?.stripePayoutsEnabled },
    };
}

/**
 * Pay out the creator's whole available balance. Serialized per creator (advisory lock), so two
 * requests never pay the same money twice. Connect (account with payouts enabled + Stripe
 * configured) transfers after commit; otherwise the payout is `manual` and ops mark it paid.
 */
export async function requestCreatorPayout(userId: string, actor: Actor): Promise<CreatorPayoutView> {
    const payout = await withTx(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`creator_payout:${userId}`}))`);
        const balance = await creatorBalance(userId, tx);
        if (balance.availableCents < MIN_CREATOR_PAYOUT_CENTS) {
            throw new ApiError('CONFLICT', `Payouts start at ${(MIN_CREATOR_PAYOUT_CENTS / 100).toFixed(2)} USD. Your available balance is ${(Math.max(0, balance.availableCents) / 100).toFixed(2)} USD.`, 409, { availableCents: balance.availableCents });
        }
        const [account] = await tx.select().from(creatorAccounts).where(eq(creatorAccounts.userId, userId));
        const method = account?.stripeAccountId && account.stripePayoutsEnabled && env().STRIPE_SECRET_KEY ? 'stripe_connect' : 'manual';
        const [row] = await tx.insert(creatorPayouts).values({ creatorUserId: userId, amountCents: balance.availableCents, currency: balance.currency, status: 'PENDING', method }).returning();
        await postTransaction(
            tx,
            creatorTxnKeys.payout(row.id),
            [
                { account: 'CREATOR_PAYABLE', direction: 'DEBIT', amountCents: row.amountCents, memo: `Creator payout ${row.id}` },
                { account: 'PAYOUTS_IN_TRANSIT', direction: 'CREDIT', amountCents: row.amountCents, memo: `Creator payout ${row.id} (${method})` },
            ],
            { payoutId: row.id, currency: row.currency },
        );
        await emitEvent(tx, { type: 'creator.payout_created', payload: { payoutId: row.id, creatorUserId: userId, amountCents: row.amountCents, method }, actor, correlationId: `creator:${userId}` });
        return row;
    });
    if (payout.method === 'stripe_connect') {
        const [settled] = await executePendingCreatorPayouts({ payoutId: payout.id });
        if (settled) return settled;
        const [fresh] = await getDb().select().from(creatorPayouts).where(eq(creatorPayouts.id, payout.id));
        return toPayoutView(fresh ?? payout);
    }
    return toPayoutView(payout);
}

/** Mark a creator payout PAID (Connect transfer created / ops paid by hand) and post the settlement. Idempotent. */
export async function markCreatorPayoutPaid(payoutId: string, providerRef: string | null, actor: Actor = SYSTEM_ACTOR): Promise<CreatorPayoutView | null> {
    const row = await withTx(async (tx) => {
        const [p] = await tx.select().from(creatorPayouts).where(eq(creatorPayouts.id, payoutId)).for('update');
        if (!p) return null;
        if (p.status === 'PAID') return p;
        if (p.status !== 'PENDING') throw new ApiError('CONFLICT', `Creator payout ${payoutId} is ${p.status}`);
        const now = new Date();
        const [updated] = await tx.update(creatorPayouts).set({ status: 'PAID', providerRef, paidAt: now, updatedAt: now }).where(eq(creatorPayouts.id, payoutId)).returning();
        await postTransaction(
            tx,
            creatorTxnKeys.settle(payoutId),
            [
                { account: 'PAYOUTS_IN_TRANSIT', direction: 'DEBIT', amountCents: p.amountCents, memo: `Creator payout ${payoutId} settled` },
                { account: 'CASH', direction: 'CREDIT', amountCents: p.amountCents, memo: providerRef ? `Transfer ${providerRef}` : 'Manual creator payout' },
            ],
            { payoutId, currency: p.currency },
        );
        await emitEvent(tx, { type: 'creator.payout_paid', payload: { payoutId, creatorUserId: p.creatorUserId, amountCents: p.amountCents, providerRef }, actor, correlationId: `creator:${p.creatorUserId}` });
        return updated;
    });
    return row ? toPayoutView(row) : null;
}

async function failCreatorPayout(payoutId: string, reason: string): Promise<void> {
    await withTx(async (tx) => {
        const [p] = await tx.select().from(creatorPayouts).where(eq(creatorPayouts.id, payoutId)).for('update');
        if (!p || p.status !== 'PENDING') return;
        await tx.update(creatorPayouts).set({ status: 'FAILED', failureReason: reason.slice(0, 300), updatedAt: new Date() }).where(eq(creatorPayouts.id, payoutId));
        await postTransaction(
            tx,
            creatorTxnKeys.fail(payoutId),
            [
                { account: 'PAYOUTS_IN_TRANSIT', direction: 'DEBIT', amountCents: p.amountCents, memo: `Creator payout ${payoutId} failed` },
                { account: 'CREATOR_PAYABLE', direction: 'CREDIT', amountCents: p.amountCents, memo: 'Returned to the creator balance' },
            ],
            { payoutId, currency: p.currency },
        );
        await emitEvent(tx, { type: 'creator.payout_failed', payload: { payoutId, creatorUserId: p.creatorUserId, reason: reason.slice(0, 300) }, actor: SYSTEM_ACTOR, correlationId: `creator:${p.creatorUserId}` });
    });
}

/**
 * The payout runner (cron / admin, and right after a Connect payout is requested): transfer
 * every PENDING `stripe_connect` creator payout with the shared Connect transfer helper
 * (idempotency key `payout:<payoutId>`), then settle it. Manual payouts wait for ops.
 */
export async function executePendingCreatorPayouts(opts: { payoutId?: string } = {}): Promise<CreatorPayoutView[]> {
    const db = getDb();
    const where = [eq(creatorPayouts.status, 'PENDING'), eq(creatorPayouts.method, 'stripe_connect')];
    if (opts.payoutId) where.push(eq(creatorPayouts.id, opts.payoutId));
    const pending = await db
        .select({ payout: creatorPayouts, account: creatorAccounts })
        .from(creatorPayouts)
        .innerJoin(creatorAccounts, eq(creatorAccounts.userId, creatorPayouts.creatorUserId))
        .where(and(...where))
        .limit(100);
    if (!pending.length) return [];
    const { createConnectTransfer } = await import('../payments/stripe');
    const settled: CreatorPayoutView[] = [];
    for (const { payout, account } of pending) {
        if (!account.stripeAccountId || !account.stripePayoutsEnabled) continue;
        try {
            const { transferId } = await createConnectTransfer({
                payoutId: payout.id,
                orderId: `creator:${payout.creatorUserId}`,
                destination: account.stripeAccountId,
                amountCents: payout.amountCents,
                currency: payout.currency,
                providerPaymentId: null,
            });
            const row = await markCreatorPayoutPaid(payout.id, transferId);
            if (row) settled.push(row);
        } catch (err) {
            console.error(`[media] creator payout ${payout.id} transfer failed`, err);
            await failCreatorPayout(payout.id, err instanceof Error ? err.message : String(err));
        }
    }
    return settled;
}

/** Ops: pending creator payouts (manual ones need a human). */
export async function listPendingCreatorPayouts(): Promise<(CreatorPayoutView & { creatorUserId: string; creatorEmail: string | null })[]> {
    const rows = await getDb()
        .select({ p: creatorPayouts, email: users.email })
        .from(creatorPayouts)
        .leftJoin(users, eq(users.id, creatorPayouts.creatorUserId))
        .where(inArray(creatorPayouts.status, ['PENDING', 'FAILED']))
        .orderBy(desc(creatorPayouts.createdAt))
        .limit(200);
    return rows.map((r) => ({ ...toPayoutView(r.p), creatorUserId: r.p.creatorUserId, creatorEmail: r.email }));
}
