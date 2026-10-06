/**
 * Payment outcomes -> order lifecycle (ADR-0007).
 *
 * All handlers lock the `payments` row (SELECT ... FOR UPDATE) so concurrent or
 * replayed webhooks serialize, and every state change + its domain events commit
 * in ONE transaction. Side effects (dispatch offer, emails) run after commit.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { Actor } from '../../contracts/common';
import type { DomainEventEnvelope } from '../../contracts/events';
import type { PaymentProviderName } from '../../contracts/enums';
import { withTx, getDb, type DbOrTx } from '../db';
import { orders, payments, quotes } from '../db/schema';
import { deliverEvent, emitEvent } from '../events/outbox';
import { recordPaymentSplit, recordRefund } from '../ledger';
import { notify } from '../notify';
import { markQuoteOrdered } from '../quote';
import { advanceOrder } from './advance';
import { orderUrlFromPaymentMetadata } from './link-vault';
import { canTransition } from './state';

export type PaymentSucceededInput = {
    provider: PaymentProviderName;
    providerRef: string;
    providerPaymentId: string | null;
    amountCents: number;
    currency: string;
    /** Provider event id (also recorded in webhook_events by the route). */
    eventId: string;
};

export type PaymentFailedInput = {
    provider: PaymentProviderName;
    providerRef: string;
    reason: string | null;
    eventId: string;
};

export class PaymentNotFoundError extends Error {
    constructor(
        public readonly provider: string,
        public readonly providerRef: string,
    ) {
        super(`No ${provider} payment with reference ${providerRef}`);
        this.name = 'PaymentNotFoundError';
    }
}

type PaymentRow = typeof payments.$inferSelect;
type OrderRow = typeof orders.$inferSelect;

function providerActor(provider: PaymentProviderName): Actor {
    return { kind: 'payment_provider', id: provider };
}

async function lockPayment(tx: DbOrTx, provider: PaymentProviderName, providerRef: string): Promise<{ payment: PaymentRow; order: OrderRow }> {
    const [payment] = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.provider, provider), eq(payments.providerRef, providerRef)))
        .for('update');
    if (!payment) throw new PaymentNotFoundError(provider, providerRef);
    const [order] = await tx.select().from(orders).where(eq(orders.id, payment.orderId)).for('update');
    if (!order) throw new Error(`Order ${payment.orderId} for payment ${payment.id} is missing`);
    return { payment, order };
}

type AfterCommit = () => Promise<void>;

async function runAfterCommit(effects: AfterCommit[]): Promise<void> {
    for (const fx of effects) {
        try {
            await fx();
        } catch (err) {
            console.error('[orders] after-commit side effect failed', err);
        }
    }
}

/** Deliver outbox events now; failures stay unpublished for the relay to retry. */
async function deliverDurably(eventIds: string[]): Promise<void> {
    if (!eventIds.length) return;
    const { ensureSubscribers } = await import('../events/registry');
    await ensureSubscribers();
    for (const id of eventIds) {
        try {
            await deliverEvent(id);
        } catch (err) {
            console.error(`[orders] immediate delivery of event ${id} failed; the outbox relay will retry`, err);
        }
    }
}

/**
 * Outbox subscriber for order side effects (registered in events/registry.ts).
 * At-least-once: dispatchOrder is idempotent; a retried email may repeat.
 */
export async function handleOrderEvent(event: DomainEventEnvelope): Promise<void> {
    if (event.event_type === 'production.authorized') {
        await dispatchAndConfirm((event.payload as { orderId: string }).orderId);
        return;
    }
    if (event.event_type === 'payment.failed') {
        const { orderId, reason } = event.payload as { orderId: string; reason: string | null };
        const [order] = await getDb().select().from(orders).where(eq(orders.id, orderId));
        // Only email if the order is still failed (a later success wins).
        if (!order || order.status !== 'PAYMENT_FAILED') return;
        await notify('order.payment_failed', { to: order.buyerEmail, orderId: order.id, orderNumber: order.orderNumber, reason });
    }
}

/** After a successful payment: offer the job to a shop, then confirm to the buyer. */
async function dispatchAndConfirm(orderId: string): Promise<void> {
    const db = getDb();
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    if (!order) return;
    try {
        const { dispatchOrder } = await import('../dispatch');
        // A null result (no capable shop) is alerted by dispatchOrder itself (ops.alert +
        // dispatch.unmatched event); the order stays PAID for ops to dispatch or refund.
        await dispatchOrder(orderId);
    } catch (err) {
        await notify('ops.alert', {
            subject: `Dispatch failed for ${order.orderNumber}`,
            message: `Order ${order.orderNumber} is paid but dispatch threw: ${err instanceof Error ? err.message : String(err)}. Retry with POST /api/admin/orders/${orderId}/dispatch.`,
            orderId,
        });
    }
    const [payment] = await db
        .select()
        .from(payments)
        .where(and(eq(payments.orderId, orderId), eq(payments.status, 'SUCCEEDED')))
        .orderBy(desc(payments.updatedAt))
        .limit(1);
    const orderUrl = orderUrlFromPaymentMetadata(orderId, payment?.metadata);
    if (!orderUrl) {
        await notify('ops.alert', {
            subject: `Order link unavailable for ${order.orderNumber}`,
            message: 'The confirmation email could not include the buyer order link (sealed token missing or ORDER_LINK_SECRET rotated). Resend the link manually.',
            orderId,
        });
        return;
    }
    await notify('order.confirmed', {
        to: order.buyerEmail,
        orderId,
        orderNumber: order.orderNumber,
        orderUrl,
        totalCents: order.totalCents,
        currency: order.currency,
    });
}

/**
 * Idempotent payment confirmation. Verifies amount/currency equal the order
 * total (mismatch -> payment flagged, order NOT advanced, ops notified).
 * Returns `alreadyProcessed: true` on replays.
 */
export async function handlePaymentSucceeded(input: PaymentSucceededInput): Promise<{ orderId: string; alreadyProcessed: boolean }> {
    const actor = providerActor(input.provider);
    const effects: AfterCommit[] = [];
    const durable: string[] = [];

    const result = await withTx(async (tx) => {
        const { payment, order } = await lockPayment(tx, input.provider, input.providerRef);
        const base = { orderId: order.id };

        if (payment.status === 'SUCCEEDED' || payment.status === 'REFUNDED') {
            return { ...base, alreadyProcessed: true };
        }

        const currency = input.currency.toLowerCase();
        if (input.amountCents !== payment.amountCents || currency !== payment.currency || payment.amountCents !== order.totalCents) {
            await tx
                .update(payments)
                .set({
                    failureReason: 'AMOUNT_MISMATCH',
                    metadata: {
                        ...payment.metadata,
                        amountMismatch: { receivedCents: input.amountCents, receivedCurrency: currency, expectedCents: order.totalCents, eventId: input.eventId },
                    },
                    updatedAt: new Date(),
                })
                .where(eq(payments.id, payment.id));
            effects.push(() =>
                notify('ops.alert', {
                    subject: `Payment amount mismatch on ${order.orderNumber}`,
                    message: `Provider reported ${input.amountCents} ${currency} but the order total is ${order.totalCents} ${order.currency}. The order was NOT advanced. Investigate and refund or adjust.`,
                    orderId: order.id,
                }).then(() => undefined),
            );
            return { ...base, alreadyProcessed: false };
        }

        const now = new Date();
        await tx
            .update(payments)
            .set({ status: 'SUCCEEDED', providerPaymentId: input.providerPaymentId ?? payment.providerPaymentId, failureReason: null, succeededAt: now, updatedAt: now })
            .where(eq(payments.id, payment.id));
        const completed = await emitEvent(tx, {
            type: 'payment.completed',
            payload: { orderId: order.id, paymentId: payment.id, provider: input.provider, providerRef: input.providerRef, amountCents: input.amountCents, currency },
            actor,
            correlationId: order.correlationId,
            buildId: order.buildId,
            orderId: order.id,
            timestamp: now,
        });

        if (!canTransition(order.status, 'PAID')) {
            // Money arrived for an order that can no longer be paid (e.g. cancelled). Keep the
            // payment fact, do not touch the order, and get a human to refund.
            effects.push(() =>
                notify('ops.alert', {
                    subject: `Payment received for ${order.status} order ${order.orderNumber}`,
                    message: `A payment of ${input.amountCents} ${currency} succeeded but the order is ${order.status}. Refund it at the provider.`,
                    orderId: order.id,
                }).then(() => undefined),
            );
            return { ...base, alreadyProcessed: false };
        }

        await advanceOrder(order.id, 'PAID', actor, { causationId: completed.event_id, at: now, data: { paymentId: payment.id } }, tx);
        const [quote] = await tx.select({ id: quotes.id, status: quotes.status, designVersion: quotes.designVersion }).from(quotes).where(eq(quotes.id, order.quoteId));
        const authorized = await emitEvent(tx, {
            type: 'production.authorized',
            payload: { orderId: order.id, quoteId: order.quoteId, designVersion: quote?.designVersion ?? 1 },
            actor,
            correlationId: order.correlationId,
            buildId: order.buildId,
            orderId: order.id,
            causationId: completed.event_id,
            timestamp: now,
        });
        // Lock the quote. A second order paid on the same quote (two tabs) is still honoured:
        // the buyer paid the snapshot price, so we make it; the quote simply stays ORDERED.
        if (quote && quote.status !== 'ORDERED') await markQuoteOrdered(order.quoteId, tx);
        await recordPaymentSplit(order.id, tx);

        // Dispatch + confirmation run from the outbox event, so a crash after commit
        // cannot lose them: the relay redelivers anything not marked published.
        durable.push(authorized.event_id);
        return { ...base, alreadyProcessed: false };
    });

    await runAfterCommit(effects);
    await deliverDurably(durable);
    return result;
}

/** Idempotent payment failure: payment FAILED, order -> PAYMENT_FAILED (if PENDING_PAYMENT). */
export async function handlePaymentFailed(input: PaymentFailedInput): Promise<{ orderId: string }> {
    const actor = providerActor(input.provider);
    const durable: string[] = [];
    const result = await withTx(async (tx) => {
        const { payment, order } = await lockPayment(tx, input.provider, input.providerRef);
        // A late failure never overrides money that already arrived; replays are no-ops.
        if (payment.status !== 'PENDING') return { orderId: order.id };
        const now = new Date();
        await tx.update(payments).set({ status: 'FAILED', failureReason: input.reason, updatedAt: now }).where(eq(payments.id, payment.id));
        const failed = await emitEvent(tx, {
            type: 'payment.failed',
            payload: { orderId: order.id, paymentId: payment.id, provider: input.provider, providerRef: input.providerRef, reason: input.reason },
            actor,
            correlationId: order.correlationId,
            buildId: order.buildId,
            orderId: order.id,
            timestamp: now,
        });
        if (order.status === 'PENDING_PAYMENT') {
            await advanceOrder(order.id, 'PAYMENT_FAILED', actor, { causationId: failed.event_id, reason: input.reason ?? undefined, at: now }, tx);
            // The buyer email goes out from the outbox event (see handleOrderEvent).
            durable.push(failed.event_id);
        }
        return { orderId: order.id };
    });
    await deliverDurably(durable);
    return result;
}

/**
 * Apply a full refund to an order inside `tx` (payment REFUNDED, order REFUNDED,
 * `order.refunded`, ledger reversal). Caller holds no locks; this locks the payment.
 * Returns false when the payment was already refunded (idempotent).
 */
export async function applyFullRefund(
    tx: DbOrTx,
    input: { paymentId: string; refundRef: string | null; reason: string; actor: Actor },
): Promise<boolean> {
    const [payment] = await tx.select().from(payments).where(eq(payments.id, input.paymentId)).for('update');
    if (!payment) throw new Error(`Payment ${input.paymentId} not found`);
    if (payment.status === 'REFUNDED') return false;
    const [order] = await tx.select().from(orders).where(eq(orders.id, payment.orderId)).for('update');
    if (!order) throw new Error(`Order ${payment.orderId} not found`);
    const now = new Date();
    await tx
        .update(payments)
        .set({
            status: 'REFUNDED',
            refundedCents: payment.amountCents,
            metadata: { ...payment.metadata, refundRef: input.refundRef, refundReason: input.reason },
            updatedAt: now,
        })
        .where(eq(payments.id, payment.id));
    const refunded = await emitEvent(tx, {
        type: 'order.refunded',
        payload: { orderId: order.id, amountCents: payment.amountCents, refundRef: input.refundRef, reason: input.reason },
        actor: input.actor,
        correlationId: order.correlationId,
        buildId: order.buildId,
        orderId: order.id,
        timestamp: now,
    });
    if (order.status !== 'REFUNDED') {
        await advanceOrder(order.id, 'REFUNDED', input.actor, { reason: input.reason, causationId: refunded.event_id, at: now }, tx);
    }
    // Withdraw the job from the Shop Console in the same transaction (offered/accepted/in-production jobs -> CANCELLED).
    const { cancelOpenJobs } = await import('../dispatch');
    await cancelOpenJobs(order.id, tx);
    await recordRefund(order.id, payment.amountCents, tx);
    return true;
}

/**
 * A refund reported by the provider (`charge.refunded`): ours (already applied by
 * refundOrder -> no-op) or one issued directly in the provider dashboard.
 */
export async function handleProviderRefund(input: {
    provider: PaymentProviderName;
    providerPaymentId: string;
    amountRefundedCents: number;
    fullyRefunded: boolean;
    refundRef: string | null;
}): Promise<{ orderId: string | null }> {
    const effects: AfterCommit[] = [];
    const result = await withTx(async (tx) => {
        const [payment] = await tx
            .select()
            .from(payments)
            .where(and(eq(payments.provider, input.provider), eq(payments.providerPaymentId, input.providerPaymentId)))
            .for('update');
        if (!payment) return { orderId: null };
        if (payment.status === 'REFUNDED') return { orderId: payment.orderId };
        const [order] = await tx.select().from(orders).where(eq(orders.id, payment.orderId)).for('update');
        if (!order) return { orderId: null };

        if (input.fullyRefunded && payment.status === 'SUCCEEDED' && canTransition(order.status, 'REFUNDED')) {
            await applyFullRefund(tx, {
                paymentId: payment.id,
                refundRef: input.refundRef,
                reason: 'Refunded at the payment provider',
                actor: providerActor(input.provider),
            });
            return { orderId: order.id };
        }

        await tx
            .update(payments)
            .set({ refundedCents: Math.max(payment.refundedCents, input.amountRefundedCents), updatedAt: new Date() })
            .where(eq(payments.id, payment.id));
        effects.push(() =>
            notify('ops.alert', {
                subject: `Provider refund needs reconciliation on ${order.orderNumber}`,
                message: `The provider reports ${input.amountRefundedCents} refunded (full: ${input.fullyRefunded}) while the order is ${order.status}. The order state and ledger were not changed automatically.`,
                orderId: order.id,
            }).then(() => undefined),
        );
        return { orderId: order.id };
    });
    await runAfterCommit(effects);
    return result;
}
