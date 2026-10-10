/**
 * Double-entry ledger + payouts (ADR-0004).
 *
 * OWNER: orders agent. Signatures FINAL.
 *
 * Postings (txn_key is unique per business event; insert with ON CONFLICT DO NOTHING):
 *   payment:<orderId>   DEBIT CASH total
 *                       CREDIT SHOP_PAYABLE shop_cost, CREDIT PLATFORM_REVENUE platform_fee,
 *                       CREDIT SHIPPING_PAYABLE shipping, CREDIT TAX_PAYABLE tax (omit zero lines)
 *   payout:<orderId>:<shopId>
 *                       DEBIT SHOP_PAYABLE payout, CREDIT PAYOUTS_IN_TRANSIT payout
 *                       (+ payouts row PENDING; settlement to CASH when the transfer is paid)
 *   payout_settle:<payoutId>
 *                       DEBIT PAYOUTS_IN_TRANSIT, CREDIT CASH (Stripe Connect transfer created
 *                       or ops marked the manual payout paid)
 *   refund:<orderId>    reverse the payment posting: CREDIT CASH refund,
 *                       DEBIT SHOP_PAYABLE / REFUNDS (contra-revenue) / SHIPPING_PAYABLE / TAX_PAYABLE
 * Every transaction must balance (sum DEBIT = sum CREDIT); asserted before insert.
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { SYSTEM_ACTOR } from '../../contracts/common';
import type { LedgerAccount, LedgerDirection } from '../../contracts/enums';
import { getDb, withTx, type DbOrTx } from '../db';
import { ledgerEntries, manufacturingJobs, orderPaymentPlans, orders, payments, payouts, shops } from '../db/schema';
import { emitEvent } from '../events/outbox';
import { env } from '../env';

export type PayoutRow = typeof payouts.$inferSelect;
export type LedgerEntryRow = typeof ledgerEntries.$inferSelect;

export type LedgerLine = { account: LedgerAccount; direction: LedgerDirection; amountCents: number; memo?: string };

export class UnbalancedLedgerError extends Error {
    constructor(
        public readonly txnKey: string,
        public readonly debits: number,
        public readonly credits: number,
    ) {
        super(`Ledger transaction ${txnKey} does not balance: debits ${debits} != credits ${credits}`);
        this.name = 'UnbalancedLedgerError';
    }
}

/** Throws unless sum(DEBIT) === sum(CREDIT) and every amount is a positive integer. */
export function assertBalanced(txnKey: string, lines: LedgerLine[]): void {
    let debits = 0;
    let credits = 0;
    for (const l of lines) {
        if (!Number.isInteger(l.amountCents) || l.amountCents <= 0) {
            throw new Error(`Ledger line amount must be a positive integer (txn ${txnKey}, ${l.account})`);
        }
        if (l.direction === 'DEBIT') debits += l.amountCents;
        else credits += l.amountCents;
    }
    if (lines.length < 2 || debits !== credits) throw new UnbalancedLedgerError(txnKey, debits, credits);
}

export const txnKeys = {
    payment: (orderId: string) => `payment:${orderId}`,
    payout: (orderId: string, shopId: string) => `payout:${orderId}:${shopId}`,
    payoutSettle: (payoutId: string) => `payout_settle:${payoutId}`,
    refund: (orderId: string) => `refund:${orderId}`,
};

/**
 * Insert a balanced transaction. Zero-amount lines are dropped first. Returns
 * true when rows were inserted, false when the txn_key already existed (replay).
 */
export async function postTransaction(
    tx: DbOrTx,
    txnKey: string,
    lines: LedgerLine[],
    ctx: { orderId?: string | null; shopId?: string | null; payoutId?: string | null; currency: string },
): Promise<boolean> {
    const nonZero = lines.filter((l) => l.amountCents !== 0);
    assertBalanced(txnKey, nonZero);
    const inserted = await tx
        .insert(ledgerEntries)
        .values(
            nonZero.map((l, i) => ({
                txnKey,
                lineNo: i + 1,
                account: l.account,
                direction: l.direction,
                amountCents: l.amountCents,
                currency: ctx.currency,
                orderId: ctx.orderId ?? null,
                shopId: ctx.shopId ?? null,
                payoutId: ctx.payoutId ?? null,
                memo: l.memo ?? null,
            })),
        )
        .onConflictDoNothing({ target: [ledgerEntries.txnKey, ledgerEntries.lineNo] })
        .returning({ id: ledgerEntries.id });
    if (inserted.length !== 0 && inserted.length !== nonZero.length) {
        // A partial previous write cannot happen (single statement), but guard anyway.
        throw new Error(`Ledger transaction ${txnKey} was partially recorded`);
    }
    return inserted.length > 0;
}

async function lockOrder(tx: DbOrTx, orderId: string) {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
    if (!order) throw new Error(`Order ${orderId} not found`);
    return order;
}

/** Record the payment split for a PAID order. Idempotent. Emits `ledger.payment_recorded`. */
export async function recordPaymentSplit(orderId: string, tx?: DbOrTx): Promise<void> {
    await withTx(async (t) => {
        const order = await lockOrder(t, orderId);
        if (order.status === 'PENDING_PAYMENT' || order.status === 'PAYMENT_FAILED' || order.status === 'CANCELLED') {
            throw new Error(`Cannot record payment split for order ${orderId} in status ${order.status}`);
        }
        if (order.shopCostCents + order.platformFeeCents !== order.subtotalCents) {
            throw new Error(`Order ${orderId} split does not add up to the subtotal`);
        }
        const txnKey = txnKeys.payment(orderId);
        // R3: a promise credit applied at checkout pays part of the order (BUYER_CREDITS is debited).
        const [plan] = await t.select({ creditCents: orderPaymentPlans.creditCents, kind: orderPaymentPlans.kind }).from(orderPaymentPlans).where(eq(orderPaymentPlans.orderId, orderId));
        if (plan?.kind === 'DEPOSIT_BALANCE') throw new Error(`Order ${orderId} is paid by deposit + balance; its ledger is posted by src/server/prime/ledger.ts`);
        const creditCents = plan?.creditCents ?? 0;
        const inserted = await postTransaction(
            t,
            txnKey,
            [
                { account: 'CASH', direction: 'DEBIT', amountCents: order.totalCents - creditCents, memo: `Payment ${order.orderNumber}` },
                { account: 'BUYER_CREDITS', direction: 'DEBIT', amountCents: creditCents, memo: 'Promise credit applied' },
                { account: 'SHOP_PAYABLE', direction: 'CREDIT', amountCents: order.shopCostCents, memo: 'Owed to manufacturing shop' },
                { account: 'PLATFORM_REVENUE', direction: 'CREDIT', amountCents: order.platformFeeCents, memo: 'Platform fee' },
                { account: 'SHIPPING_PAYABLE', direction: 'CREDIT', amountCents: order.shippingCents, memo: 'Shipping collected' },
                { account: 'TAX_PAYABLE', direction: 'CREDIT', amountCents: order.taxCents, memo: 'Sales tax collected' },
            ],
            { orderId, currency: order.currency },
        );
        if (inserted) {
            await emitEvent(t, {
                type: 'ledger.payment_recorded',
                payload: { orderId, txnKey, totalCents: order.totalCents },
                actor: SYSTEM_ACTOR,
                correlationId: order.correlationId,
                buildId: order.buildId,
                orderId,
            });
        }
    }, tx);
}

/**
 * On delivery: create the shop payout (amount = order.shop_cost_cents, i.e. after
 * platform fee) + ledger posting. Idempotent (unique order x shop). Emits `payout.created`.
 *
 * The payout row starts PENDING with method `stripe_connect` (shop has a Connect
 * account with payouts enabled and Stripe is configured) or `manual` (ops pays and marks it paid).
 * Money movement happens AFTER commit in `executePendingPayouts(orderId)`; when this
 * function is called without a caller transaction it runs that step itself.
 */
export async function recordPayouts(orderId: string, tx?: DbOrTx): Promise<PayoutRow[]> {
    const result = await withTx(async (t) => {
        const order = await lockOrder(t, orderId);
        if (order.status !== 'DELIVERED' && order.status !== 'COMPLETE') {
            throw new Error(`Payouts are recorded on delivery; order ${orderId} is ${order.status}`);
        }
        if (!order.shopId) throw new Error(`Order ${orderId} has no assigned shop; cannot record a payout`);
        const [shop] = await t.select().from(shops).where(eq(shops.id, order.shopId));
        if (!shop) throw new Error(`Shop ${order.shopId} not found`);

        const [job] = await t
            .select({ id: manufacturingJobs.id })
            .from(manufacturingJobs)
            .where(
                and(
                    eq(manufacturingJobs.orderId, orderId),
                    eq(manufacturingJobs.shopId, shop.id),
                    inArray(manufacturingJobs.status, ['SHIPPED', 'DELIVERED', 'QA_PASSED', 'IN_PRODUCTION', 'ACCEPTED']),
                ),
            )
            .orderBy(desc(manufacturingJobs.createdAt))
            .limit(1);

        // Connect only once Stripe reports payouts_enabled: a shop that started but did not
        // finish onboarding has an account id but cannot receive transfers yet.
        const method = shop.stripeAccountId && shop.stripePayoutsEnabled && env().STRIPE_SECRET_KEY ? 'stripe_connect' : 'manual';
        const [created] = await t
            .insert(payouts)
            .values({
                shopId: shop.id,
                orderId,
                jobId: job?.id ?? null,
                amountCents: order.shopCostCents,
                currency: order.currency,
                status: 'PENDING',
                method,
            })
            .onConflictDoNothing({ target: [payouts.orderId, payouts.shopId] })
            .returning();

        if (created && created.amountCents > 0) {
            await postTransaction(
                t,
                txnKeys.payout(orderId, shop.id),
                [
                    { account: 'SHOP_PAYABLE', direction: 'DEBIT', amountCents: created.amountCents, memo: `Payout to ${shop.name}` },
                    { account: 'PAYOUTS_IN_TRANSIT', direction: 'CREDIT', amountCents: created.amountCents, memo: `Payout ${created.id} (${method})` },
                ],
                { orderId, shopId: shop.id, payoutId: created.id, currency: order.currency },
            );
        }
        if (created) {
            await emitEvent(t, {
                type: 'payout.created',
                payload: { payoutId: created.id, orderId, shopId: shop.id, amountCents: created.amountCents },
                actor: SYSTEM_ACTOR,
                correlationId: order.correlationId,
                buildId: order.buildId,
                orderId,
            });
        }
        return t.select().from(payouts).where(eq(payouts.orderId, orderId)).orderBy(asc(payouts.createdAt));
    }, tx);

    if (!tx) {
        await executePendingPayouts(orderId).catch((err) => console.error('[ledger] payout execution failed', err));
    }
    return result;
}

/**
 * After commit: move money for PENDING `stripe_connect` payouts of an order
 * (Stripe transfer, idempotency key `payout:<payoutId>`), then mark them PAID and
 * post `payout_settle:<payoutId>`. Manual payouts stay PENDING for ops.
 * Safe to call repeatedly (cron / admin / after markShipmentDelivered).
 */
export async function executePendingPayouts(orderId: string): Promise<PayoutRow[]> {
    const db = getDb();
    const pending = await db
        .select({ payout: payouts, shop: shops })
        .from(payouts)
        .innerJoin(shops, eq(shops.id, payouts.shopId))
        .where(and(eq(payouts.orderId, orderId), eq(payouts.status, 'PENDING'), eq(payouts.method, 'stripe_connect')));
    if (pending.length === 0) return [];

    const { createConnectTransfer } = await import('../payments/stripe');
    const [payment] = await db
        .select()
        .from(payments)
        .where(and(eq(payments.orderId, orderId), eq(payments.status, 'SUCCEEDED')))
        .limit(1);

    const settled: PayoutRow[] = [];
    for (const { payout, shop } of pending) {
        // Payouts disabled on the account (e.g. Stripe paused it): leave the payout PENDING for ops.
        if (!shop.stripeAccountId || !shop.stripePayoutsEnabled) continue;
        try {
            const { transferId } = await createConnectTransfer({
                payoutId: payout.id,
                orderId,
                destination: shop.stripeAccountId,
                amountCents: payout.amountCents,
                currency: payout.currency,
                providerPaymentId: payment?.providerPaymentId ?? null,
            });
            const row = await markPayoutPaid(payout.id, transferId);
            if (row) settled.push(row);
        } catch (err) {
            console.error(`[ledger] Stripe transfer for payout ${payout.id} failed`, err);
            await db
                .update(payouts)
                .set({ status: 'FAILED', providerRef: null, updatedAt: new Date() })
                .where(and(eq(payouts.id, payout.id), eq(payouts.status, 'PENDING')));
        }
    }
    return settled;
}

/** Mark a payout PAID (transfer created / ops paid manually) and post the settlement. Idempotent. */
export async function markPayoutPaid(payoutId: string, providerRef: string | null, tx?: DbOrTx): Promise<PayoutRow | null> {
    return withTx(async (t) => {
        const [payout] = await t.select().from(payouts).where(eq(payouts.id, payoutId)).for('update');
        if (!payout) return null;
        if (payout.status === 'PAID') return payout;
        if (payout.status !== 'PENDING' && payout.status !== 'FAILED') {
            throw new Error(`Payout ${payoutId} is ${payout.status}`);
        }
        const [updated] = await t
            .update(payouts)
            .set({ status: 'PAID', providerRef, paidAt: new Date(), updatedAt: new Date() })
            .where(eq(payouts.id, payoutId))
            .returning();
        if (payout.amountCents > 0) {
            await postTransaction(
                t,
                txnKeys.payoutSettle(payoutId),
                [
                    { account: 'PAYOUTS_IN_TRANSIT', direction: 'DEBIT', amountCents: payout.amountCents, memo: `Payout ${payoutId} settled` },
                    { account: 'CASH', direction: 'CREDIT', amountCents: payout.amountCents, memo: providerRef ? `Transfer ${providerRef}` : 'Manual payout' },
                ],
                { orderId: payout.orderId, shopId: payout.shopId, payoutId, currency: payout.currency },
            );
        }
        return updated;
    }, tx);
}

/**
 * Reverse the payment posting for a refunded order. Idempotent.
 * A full refund reverses every line of `payment:<orderId>` (platform fee through
 * REFUNDS, the contra-revenue account). A partial refund is booked as
 * DEBIT REFUNDS / CREDIT CASH for the refunded amount.
 */
export async function recordRefund(orderId: string, amountCents: number, tx?: DbOrTx): Promise<void> {
    if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('Refund amount must be a positive integer');
    await withTx(async (t) => {
        const order = await lockOrder(t, orderId);
        if (amountCents > order.totalCents) throw new Error(`Refund ${amountCents} exceeds order total ${order.totalCents}`);
        const [paymentPosted] = await t
            .select({ n: sql<number>`count(*)::int` })
            .from(ledgerEntries)
            .where(eq(ledgerEntries.txnKey, txnKeys.payment(orderId)));
        if (!paymentPosted || paymentPosted.n === 0) {
            throw new Error(`Order ${orderId} has no payment posting to reverse`);
        }
        // R3: a full refund of an order paid partly with a promise credit returns the cash paid
        // and restores the credit (CREDIT BUYER_CREDITS); the credit row itself is restored by the caller.
        const [plan] = await t.select({ creditCents: orderPaymentPlans.creditCents }).from(orderPaymentPlans).where(eq(orderPaymentPlans.orderId, orderId));
        const creditCents = plan?.creditCents ?? 0;
        const full = amountCents === order.totalCents - creditCents;
        const lines: LedgerLine[] =
            full
                ? [
                      { account: 'CASH', direction: 'CREDIT', amountCents: order.totalCents - creditCents, memo: `Refund ${order.orderNumber}` },
                      { account: 'BUYER_CREDITS', direction: 'CREDIT', amountCents: creditCents, memo: 'Promise credit restored' },
                      { account: 'SHOP_PAYABLE', direction: 'DEBIT', amountCents: order.shopCostCents, memo: 'Shop cost reversed' },
                      { account: 'REFUNDS', direction: 'DEBIT', amountCents: order.platformFeeCents, memo: 'Platform fee refunded' },
                      { account: 'SHIPPING_PAYABLE', direction: 'DEBIT', amountCents: order.shippingCents, memo: 'Shipping refunded' },
                      { account: 'TAX_PAYABLE', direction: 'DEBIT', amountCents: order.taxCents, memo: 'Tax refunded' },
                  ]
                : [
                      { account: 'CASH', direction: 'CREDIT', amountCents, memo: `Partial refund ${order.orderNumber}` },
                      { account: 'REFUNDS', direction: 'DEBIT', amountCents, memo: 'Partial refund' },
                  ];
        await postTransaction(t, txnKeys.refund(orderId), lines, { orderId, currency: order.currency });
    }, tx);
}

/** All ledger rows for an order (admin + tests). */
export async function getOrderLedger(orderId: string, tx?: DbOrTx): Promise<LedgerEntryRow[]> {
    const db = tx ?? getDb();
    return db.select().from(ledgerEntries).where(eq(ledgerEntries.orderId, orderId)).orderBy(asc(ledgerEntries.txnKey), asc(ledgerEntries.lineNo));
}

/** Net balance per account (debits positive) for an order. */
export function ledgerBalances(rows: Pick<LedgerEntryRow, 'account' | 'direction' | 'amountCents'>[]): Partial<Record<LedgerAccount, number>> {
    const out: Partial<Record<LedgerAccount, number>> = {};
    for (const r of rows) {
        out[r.account] = (out[r.account] ?? 0) + (r.direction === 'DEBIT' ? r.amountCents : -r.amountCents);
    }
    return out;
}
