/**
 * Buyer credits for missed promises.
 *
 * Issue (on delivery after the promised date, promise shown):
 *   ledger `promise_credit:<orderId>`  DEBIT PROMISE_CREDIT_EXPENSE / CREDIT BUYER_CREDITS
 *   (memo + shop_id name the responsible leg) + `buyer_credits` row AVAILABLE + `credit.issued`.
 * Redeem (next checkout by the same buyer email): the credit is RESERVED for the new order and
 * reduces its first charge; on payment it becomes REDEEMED (`credit.redeemed`), and the payment
 * posting debits BUYER_CREDITS for it (src/server/ledger, src/server/prime/ledger.ts).
 * A reservation held by an order that was never paid (pending, failed, cancelled) is released to
 * the next checkout.
 */
import { and, eq, inArray, or } from 'drizzle-orm';
import { SYSTEM_ACTOR } from '../../contracts/common';
import type { PromiseLeg } from '../../contracts/enums';
import type { BuyerCreditView } from '../../contracts/promise';
import { getDb, type DbOrTx } from '../db';
import { buyerCredits, orders } from '../db/schema';
import { emitEvent } from '../events/outbox';
import { postTransaction } from '../ledger';
import { primePolicy } from '../prime/config';

export type CreditRow = typeof buyerCredits.$inferSelect;

/** Policy amount: creditPct x subtotal, capped, at least 1 cent. */
export function creditAmountCents(subtotalCents: number, policy: { creditPct: number; creditCapCents: number }): number {
    const raw = Math.round(subtotalCents * policy.creditPct);
    return Math.max(1, Math.min(policy.creditCapCents, raw));
}

const SHOP_LEGS: ReadonlySet<PromiseLeg> = new Set<PromiseLeg>(['SHOP_QUEUE', 'PROCESS', 'QA', 'PACK']);

/** Issue the missed-promise credit for an order (idempotent per order). Returns the credit row. */
export async function issuePromiseCredit(
    tx: DbOrTx,
    input: { order: typeof orders.$inferSelect; leg: PromiseLeg; promisedDate: string; deliveredOn: string; supplierId?: string | null; now: Date },
): Promise<CreditRow> {
    const { order, leg } = input;
    const [existing] = await tx.select().from(buyerCredits).where(eq(buyerCredits.sourceOrderId, order.id));
    if (existing) return existing;
    const amountCents = creditAmountCents(order.subtotalCents, primePolicy());
    const [credit] = await tx
        .insert(buyerCredits)
        .values({
            buyerEmail: order.buyerEmail.toLowerCase(),
            sourceOrderId: order.id,
            amountCents,
            reason: `Order ${order.orderNumber} arrived ${input.deliveredOn}, after the promised ${input.promisedDate}`,
            responsibleLeg: leg,
            status: 'AVAILABLE',
            createdAt: input.now,
            updatedAt: input.now,
        })
        .returning();
    const responsible = SHOP_LEGS.has(leg) ? order.shopId : null;
    await postTransaction(
        tx,
        `promise_credit:${order.id}`,
        [
            { account: 'PROMISE_CREDIT_EXPENSE', direction: 'DEBIT', amountCents, memo: `Missed promise · responsible leg ${leg}${input.supplierId && leg === 'MATERIAL_ARRIVAL' ? ` (supplier ${input.supplierId})` : ''}` },
            { account: 'BUYER_CREDITS', direction: 'CREDIT', amountCents, memo: `Credit ${credit.id} owed to the buyer` },
        ],
        { orderId: order.id, shopId: responsible, currency: order.currency },
    );
    await emitEvent(tx, {
        type: 'credit.issued',
        payload: { creditId: credit.id, orderId: order.id, amountCents, responsibleLeg: leg },
        actor: SYSTEM_ACTOR,
        correlationId: order.correlationId,
        buildId: order.buildId,
        orderId: order.id,
        timestamp: input.now,
    });
    return credit;
}

/** Credits a checkout for `email` may use now (AVAILABLE, or RESERVED by an order that was never paid). */
async function usableCredits(tx: DbOrTx, email: string): Promise<CreditRow[]> {
    const rows = await tx
        .select({ credit: buyerCredits, holder: orders.status })
        .from(buyerCredits)
        .leftJoin(orders, eq(orders.id, buyerCredits.redeemedOrderId))
        .where(and(eq(buyerCredits.buyerEmail, email.toLowerCase()), or(eq(buyerCredits.status, 'AVAILABLE'), eq(buyerCredits.status, 'RESERVED'))))
        .for('update', { of: buyerCredits });
    return rows
        .filter((r) => r.credit.status === 'AVAILABLE' || (r.holder !== null && ['PENDING_PAYMENT', 'PAYMENT_FAILED', 'CANCELLED'].includes(r.holder)))
        .map((r) => r.credit)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
}

export async function availableCreditCents(email: string, db: DbOrTx = getDb()): Promise<number> {
    const rows = await db
        .select({ credit: buyerCredits, holder: orders.status })
        .from(buyerCredits)
        .leftJoin(orders, eq(orders.id, buyerCredits.redeemedOrderId))
        .where(and(eq(buyerCredits.buyerEmail, email.toLowerCase()), inArray(buyerCredits.status, ['AVAILABLE', 'RESERVED'])));
    return rows
        .filter((r) => r.credit.status === 'AVAILABLE' || (r.holder !== null && ['PENDING_PAYMENT', 'PAYMENT_FAILED', 'CANCELLED'].includes(r.holder)))
        .reduce((s, r) => s + r.credit.amountCents, 0);
}

/**
 * Reserve the buyer's oldest usable credit for `orderId` (one credit per checkout; a credit is
 * never split). Returns the reserved credit, or null. Call inside the checkout transaction.
 */
export async function reserveCreditForCheckout(tx: DbOrTx, input: { email: string; orderId: string; maxCents: number; now: Date }): Promise<CreditRow | null> {
    const candidates = (await usableCredits(tx, input.email)).filter((c) => c.amountCents <= input.maxCents);
    const credit = candidates[0];
    if (!credit) return null;
    const [reserved] = await tx
        .update(buyerCredits)
        .set({ status: 'RESERVED', redeemedOrderId: input.orderId, reservedAt: input.now, updatedAt: input.now })
        .where(eq(buyerCredits.id, credit.id))
        .returning();
    return reserved;
}

/** On payment of `orderId`: its reserved credit becomes REDEEMED (`credit.redeemed`). Idempotent. */
export async function redeemReservedCredit(tx: DbOrTx, order: typeof orders.$inferSelect, now: Date): Promise<CreditRow | null> {
    const [credit] = await tx
        .select()
        .from(buyerCredits)
        .where(and(eq(buyerCredits.redeemedOrderId, order.id), eq(buyerCredits.status, 'RESERVED')))
        .for('update');
    if (!credit) return null;
    const [redeemed] = await tx.update(buyerCredits).set({ status: 'REDEEMED', redeemedAt: now, updatedAt: now }).where(eq(buyerCredits.id, credit.id)).returning();
    await emitEvent(tx, {
        type: 'credit.redeemed',
        payload: { creditId: credit.id, orderId: order.id, amountCents: credit.amountCents },
        actor: SYSTEM_ACTOR,
        correlationId: order.correlationId,
        buildId: order.buildId,
        orderId: order.id,
        timestamp: now,
    });
    return redeemed;
}

/** A refunded order gives its redeemed credit back (AVAILABLE again). */
export async function restoreCredit(tx: DbOrTx, orderId: string, now: Date): Promise<CreditRow | null> {
    const [restored] = await tx
        .update(buyerCredits)
        .set({ status: 'AVAILABLE', redeemedOrderId: null, reservedAt: null, redeemedAt: null, updatedAt: now })
        .where(and(eq(buyerCredits.redeemedOrderId, orderId), inArray(buyerCredits.status, ['RESERVED', 'REDEEMED'])))
        .returning();
    return restored ?? null;
}

export function toCreditView(c: CreditRow): BuyerCreditView {
    return { id: c.id, amountCents: c.amountCents, status: c.status, reason: c.reason, createdAt: c.createdAt.toISOString() };
}
