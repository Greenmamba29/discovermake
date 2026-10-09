/**
 * Payment plans (R3): deposit + balance for supplier-route orders, and promise credits on any
 * checkout. Every amount is server-side; payments go through the existing provider abstraction
 * (Stripe Checkout, or the dev double in tests) and the existing webhook pipeline.
 *
 *   checkout        createPaymentPlan: deposit = ceil(depositPct x total) (supplier route), first
 *                   charge minus a reserved promise credit -> payments row with metadata.purpose
 *   deposit paid    applyDepositPaid: plan + ledger `deposit:<orderId>` + credit redeemed +
 *                   `order.deposit_paid` (its subscriber requests the PO approvals, job row first)
 *   ready to ship   requestBalancePayment: a second hosted session for the balance (`order.balance_due`)
 *   balance paid    applyBalancePaid: plan + ledger `balance:<orderId>` + recognition
 *   ship            assertShippable: no label for a supplier-route order until the balance is paid
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { SYSTEM_ACTOR, type Actor } from '../../contracts/common';
import type { BalancePaymentView } from '../../contracts/promise';
import { getDb, withTx, type DbOrTx } from '../db';
import { approvals, orderPaymentPlans, orders, payments, sourcingJobs, supplierLegs, supplierQuotes } from '../db/schema';
import { env } from '../env';
import { emitEvent } from '../events/outbox';
import { ApiError } from '../http';
import { getPaymentProviderByName } from '../payments';
import { redeemReservedCredit, reserveCreditForCheckout, restoreCredit } from '../promise/credits';
import { postBalance, postDeposit, postRecognition, postSupplierRefund } from './ledger';
import { depositSplit, firstChargeCents, MIN_CHARGE_CENTS } from './pricing';

type OrderRow = typeof orders.$inferSelect;
type PaymentRow = typeof payments.$inferSelect;
export type PlanRow = typeof orderPaymentPlans.$inferSelect;

export type PaymentPurpose = 'full' | 'deposit' | 'balance';
export const PAYMENT_PURPOSE_KEY = 'purpose';
/** payments.metadata key with the hosted page URL of a balance session (the buyer view links to it). */
export const PAY_URL_KEY = 'payUrl';

export function paymentPurpose(metadata: Record<string, unknown> | null | undefined): PaymentPurpose {
    const p = metadata?.[PAYMENT_PURPOSE_KEY];
    return p === 'deposit' || p === 'balance' ? p : 'full';
}

export async function getPlan(db: DbOrTx, orderId: string): Promise<PlanRow | null> {
    const [plan] = await db.select().from(orderPaymentPlans).where(eq(orderPaymentPlans.orderId, orderId));
    return plan ?? null;
}

export async function isSupplierRouteOrder(db: DbOrTx, order: Pick<OrderRow, 'quoteId'>): Promise<boolean> {
    const [sq] = await db.select({ id: supplierQuotes.quoteId }).from(supplierQuotes).where(eq(supplierQuotes.quoteId, order.quoteId));
    return Boolean(sq);
}

export type CheckoutCharge = {
    purpose: 'full' | 'deposit';
    chargeCents: number;
    creditCents: number;
    depositCents: number;
    balanceCents: number;
};

/**
 * Inside the checkout transaction, after the order row exists: decide the first charge, reserve a
 * promise credit against it, and record the plan (no row for a plain full payment).
 */
export async function createPaymentPlan(tx: DbOrTx, input: { orderId: string; totalCents: number; buyerEmail: string; quoteId: string; now: Date }): Promise<CheckoutCharge> {
    const [sq] = await tx.select({ depositPct: supplierQuotes.depositPct }).from(supplierQuotes).where(eq(supplierQuotes.quoteId, input.quoteId));
    const split = sq ? depositSplit(input.totalCents, sq.depositPct) : { depositCents: input.totalCents, balanceCents: 0 };
    const credit = await reserveCreditForCheckout(tx, { email: input.buyerEmail, orderId: input.orderId, maxCents: Math.max(0, split.depositCents - MIN_CHARGE_CENTS), now: input.now });
    const { chargeCents, creditCents } = firstChargeCents(split.depositCents, credit?.amountCents ?? 0);
    if (credit && creditCents !== credit.amountCents) throw new Error('A reserved credit must be applied in full');
    if (sq || creditCents > 0) {
        await tx.insert(orderPaymentPlans).values({
            orderId: input.orderId,
            kind: sq ? 'DEPOSIT_BALANCE' : 'FULL',
            depositCents: split.depositCents,
            balanceCents: split.balanceCents,
            creditCents,
            creditId: credit?.id ?? null,
            createdAt: input.now,
            updatedAt: input.now,
        });
    }
    return { purpose: sq ? 'deposit' : 'full', chargeCents, creditCents, depositCents: split.depositCents, balanceCents: split.balanceCents };
}

/** What a payment of `purpose` must amount to for this order (the amount check in the webhook handler). */
export async function expectedChargeCents(tx: DbOrTx, order: Pick<OrderRow, 'id' | 'totalCents'>, purpose: PaymentPurpose): Promise<number> {
    const plan = await getPlan(tx, order.id);
    switch (purpose) {
        case 'deposit':
            if (!plan || plan.kind !== 'DEPOSIT_BALANCE') return -1;
            return plan.depositCents - plan.creditCents;
        case 'balance':
            if (!plan || plan.kind !== 'DEPOSIT_BALANCE') return -1;
            return plan.balanceCents;
        case 'full':
            if (plan?.kind === 'DEPOSIT_BALANCE') return -1;
            return order.totalCents - (plan?.creditCents ?? 0);
        default: {
            const never: never = purpose;
            throw new Error(`Unknown payment purpose ${String(never)}`);
        }
    }
}

/** A full payment succeeded (inside the payment transaction): the reserved credit is now redeemed. */
export async function applyFullPaymentCredit(tx: DbOrTx, order: OrderRow, now: Date): Promise<void> {
    await redeemReservedCredit(tx, order, now);
}

/**
 * Deposit succeeded (inside the payment transaction, order already PAID): plan, ledger, credit,
 * and `order.deposit_paid`, whose subscriber requests the purchase-order approvals. Returns the
 * event id for durable delivery.
 */
export async function applyDepositPaid(tx: DbOrTx, order: OrderRow, payment: PaymentRow, now: Date): Promise<string> {
    const plan = await getPlan(tx, order.id);
    if (!plan || plan.kind !== 'DEPOSIT_BALANCE') throw new Error(`Order ${order.id} has no deposit plan`);
    await tx.update(orderPaymentPlans).set({ depositPaymentId: payment.id, depositPaidAt: plan.depositPaidAt ?? now, updatedAt: now }).where(eq(orderPaymentPlans.orderId, order.id));
    await postDeposit(tx, order, { depositCents: plan.depositCents, creditCents: plan.creditCents });
    await redeemReservedCredit(tx, order, now);
    if (plan.balanceCents === 0) await postRecognition(tx, order);
    const event = await emitEvent(tx, {
        type: 'order.deposit_paid',
        payload: { orderId: order.id, paymentId: payment.id, depositCents: plan.depositCents },
        actor: { kind: 'payment_provider', id: payment.provider },
        correlationId: order.correlationId,
        buildId: order.buildId,
        orderId: order.id,
        timestamp: now,
    });
    return event.event_id;
}

/** Balance succeeded (inside the payment transaction): plan, ledger, recognition. Order status is unchanged. */
export async function applyBalancePaid(tx: DbOrTx, order: OrderRow, payment: PaymentRow, now: Date): Promise<void> {
    const plan = await getPlan(tx, order.id);
    if (!plan || plan.kind !== 'DEPOSIT_BALANCE') throw new Error(`Order ${order.id} has no balance due`);
    if (plan.balancePaidAt) return;
    await tx.update(orderPaymentPlans).set({ balancePaymentId: payment.id, balancePaidAt: now, updatedAt: now }).where(eq(orderPaymentPlans.orderId, order.id));
    await postBalance(tx, order, plan.balanceCents);
    await postRecognition(tx, order);
}

/** Supplier-route orders ship only once fully paid. Call under the order lock before buying a label. */
export async function assertShippable(tx: DbOrTx, orderId: string): Promise<void> {
    const plan = await getPlan(tx, orderId);
    if (plan?.kind === 'DEPOSIT_BALANCE' && plan.balanceCents > 0 && !plan.balancePaidAt) {
        throw new ApiError('CONFLICT', 'The buyer has not paid the balance yet. The label unlocks as soon as the balance payment is confirmed.');
    }
}

function balanceView(order: Pick<OrderRow, 'id' | 'currency'>, payment: PaymentRow): BalancePaymentView | null {
    const url = payment.metadata?.[PAY_URL_KEY];
    if (typeof url !== 'string') return null;
    return { orderId: order.id, amountCents: payment.amountCents, currency: payment.currency, providerRef: payment.providerRef, redirectUrl: url };
}

/**
 * Open (or return the open) hosted payment session for the balance of a supplier-route order that
 * is ready to ship (QA passed). Idempotent. Returns null when no balance is due.
 */
export async function requestBalancePayment(orderId: string, opts: { now?: Date } = {}): Promise<BalancePaymentView | null> {
    const now = opts.now ?? new Date();
    return withTx(async (tx) => {
        const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
        if (!order) throw new ApiError('NOT_FOUND', 'Order not found');
        const plan = await getPlan(tx, orderId);
        if (!plan || plan.kind !== 'DEPOSIT_BALANCE' || plan.balanceCents === 0 || plan.balancePaidAt) return null;
        if (!plan.depositPaidAt) throw new ApiError('CONFLICT', 'The deposit has not been paid yet.');
        if (order.status !== 'QA_PASSED') throw new ApiError('CONFLICT', 'The balance is due once your parts have passed inspection and are ready to ship.');

        const existing = await tx
            .select()
            .from(payments)
            .where(and(eq(payments.orderId, orderId), eq(payments.status, 'PENDING')))
            .orderBy(desc(payments.createdAt));
        const open = existing.find((p) => paymentPurpose(p.metadata) === 'balance');
        if (open) return balanceView(order, open);

        const [deposit] = plan.depositPaymentId ? await tx.select().from(payments).where(eq(payments.id, plan.depositPaymentId)) : [];
        if (!deposit) throw new Error(`Order ${orderId} has no deposit payment row`);
        const { SEALED_TOKEN_KEY, orderUrlFromPaymentMetadata } = await import('../orders/link-vault');
        const orderUrl = orderUrlFromPaymentMetadata(orderId, deposit.metadata) ?? new URL(`/orders/${orderId}`, env().APP_URL).toString();
        const attempts = existing.length + (await tx.select({ id: payments.id }).from(payments).where(eq(payments.orderId, orderId))).length;
        const provider = getPaymentProviderByName(deposit.provider);
        let session;
        try {
            session = await provider.createPayment({
                orderId,
                orderNumber: order.orderNumber,
                amountCents: plan.balanceCents,
                currency: order.currency,
                buyerEmail: order.buyerEmail,
                description: `${order.orderNumber} · balance before shipping`,
                successUrl: orderUrl,
                cancelUrl: orderUrl,
                metadata: { dm_quote_id: order.quoteId, dm_build_id: order.buildId, dm_purpose: 'balance' },
                idempotencyKey: `balance:${orderId}:${attempts}`,
            });
        } catch (err) {
            console.error('[prime] balance payment session failed', err);
            throw new ApiError('PAYMENT_ERROR', 'We could not start the balance payment. Please try again in a moment.');
        }
        const [payment] = await tx
            .insert(payments)
            .values({
                orderId,
                provider: provider.name,
                providerRef: session.providerRef,
                amountCents: plan.balanceCents,
                currency: order.currency,
                status: 'PENDING',
                metadata: { [SEALED_TOKEN_KEY]: deposit.metadata?.[SEALED_TOKEN_KEY], [PAYMENT_PURPOSE_KEY]: 'balance', [PAY_URL_KEY]: session.redirectUrl },
                createdAt: now,
                updatedAt: now,
            })
            .returning();
        await tx.update(orderPaymentPlans).set({ balanceRequestedAt: now, updatedAt: now }).where(eq(orderPaymentPlans.orderId, orderId));
        await emitEvent(tx, {
            type: 'order.balance_due',
            payload: { orderId, paymentId: payment.id, amountCents: plan.balanceCents },
            actor: SYSTEM_ACTOR,
            correlationId: order.correlationId,
            buildId: order.buildId,
            orderId,
            timestamp: now,
        });
        return balanceView(order, payment);
    });
}

/** Never let a balance request break the caller (QA submission). */
export async function requestBalancePaymentSafely(orderId: string): Promise<void> {
    try {
        await requestBalancePayment(orderId);
    } catch (err) {
        console.error(`[prime] balance request for ${orderId} failed`, err);
    }
}

/**
 * Refund a supplier-route order before shipping: every succeeded payment is refunded at the
 * provider, then (one transaction, payments then order locked) payments REFUNDED, order REFUNDED,
 * leg CANCELLED, pending PO approvals cancelled, open jobs cancelled, ledger reversal, credit
 * restored. Supplier-side money already approved (the supplier deposit) stays a payable for ops.
 */
export async function refundSupplierOrder(orderId: string, actor: Actor, reason: string): Promise<void> {
    const { assertTransition } = await import('../orders/state');
    const { advanceOrder } = await import('../orders/advance');
    const { cancelOpenJobs } = await import('../dispatch');
    await withTx(async (tx) => {
        // LOCK ORDER: the sourcing_jobs row first (this cancels PO approvals), then payments, then the order.
        const [peek] = await tx
            .select({ jobId: supplierQuotes.jobId })
            .from(orders)
            .innerJoin(supplierQuotes, eq(supplierQuotes.quoteId, orders.quoteId))
            .where(eq(orders.id, orderId));
        if (peek) await tx.select({ id: sourcingJobs.id }).from(sourcingJobs).where(eq(sourcingJobs.id, peek.jobId)).for('update');
        const paid = await tx
            .select()
            .from(payments)
            .where(and(eq(payments.orderId, orderId), eq(payments.status, 'SUCCEEDED')))
            .orderBy(payments.createdAt)
            .for('update');
        const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
        if (!order) throw new ApiError('NOT_FOUND', 'Order not found');
        if (order.status === 'REFUNDED') return;
        assertTransition(order.status, 'REFUNDED');
        if (!paid.length) throw new ApiError('CONFLICT', `Order ${order.orderNumber} has no succeeded payment to refund`);
        const now = new Date();
        let cash = 0;
        const refs: string[] = [];
        for (const p of paid) {
            let refundRef: string;
            try {
                ({ refundRef } = await getPaymentProviderByName(p.provider).refund({ providerRef: p.providerRef, providerPaymentId: p.providerPaymentId, amountCents: p.amountCents, reason }));
            } catch (err) {
                throw new ApiError('PAYMENT_ERROR', `The payment provider refused the refund: ${err instanceof Error ? err.message : String(err)}`);
            }
            refs.push(refundRef);
            cash += p.amountCents;
            await tx
                .update(payments)
                .set({ status: 'REFUNDED', refundedCents: p.amountCents, metadata: { ...p.metadata, refundRef, refundReason: reason }, updatedAt: now })
                .where(eq(payments.id, p.id));
        }
        const plan = await getPlan(tx, orderId);
        const credit = plan?.creditCents ?? 0;
        const refunded = await emitEvent(tx, {
            type: 'order.refunded',
            payload: { orderId, amountCents: cash, refundRef: refs.join(',') || null, reason },
            actor,
            correlationId: order.correlationId,
            buildId: order.buildId,
            orderId,
            timestamp: now,
        });
        await advanceOrder(orderId, 'REFUNDED', actor, { reason, causationId: refunded.event_id, at: now }, tx);
        await cancelOpenJobs(orderId, tx);
        const [leg] = await tx.select().from(supplierLegs).where(eq(supplierLegs.orderId, orderId)).for('update');
        if (leg && leg.status !== 'CANCELLED' && leg.status !== 'DELIVERED') {
            await tx
                .update(supplierLegs)
                .set({ status: 'CANCELLED', history: [...leg.history, { status: 'CANCELLED', at: now.toISOString(), note: reason, actorId: `${actor.kind}:${actor.id}` }], updatedAt: now })
                .where(eq(supplierLegs.id, leg.id));
            await emitEvent(tx, {
                type: 'supplier_leg.status_changed',
                payload: { orderId, legId: leg.id, from: leg.status, to: 'CANCELLED', note: reason },
                actor,
                correlationId: order.correlationId,
                buildId: order.buildId,
                orderId,
                timestamp: now,
            });
        }
        await tx
            .update(approvals)
            .set({ status: 'CANCELLED', decidedBy: `${actor.kind}:${actor.id}`, decidedAt: now, decisionNote: 'Order refunded', updatedAt: now })
            .where(and(eq(approvals.status, 'PENDING'), inArray(approvals.kind, ['PLACE_PURCHASE_ORDER', 'PAY_DEPOSIT']), sql`${approvals.details} ->> 'orderId' = ${orderId}`));
        if (cash + credit > 0) await postSupplierRefund(tx, order, { cashCents: cash, creditCents: credit });
        await restoreCredit(tx, orderId, now);
    });
}
