/**
 * Authorize-now, capture-later payments (R4 Build Slots, workflow 06).
 *
 *   createPayment({ captureMethod: 'manual' })      order PENDING_PAYMENT, payment PENDING
 *   handlePaymentAuthorized   (webhook / dev page)  payment AUTHORIZED, `payment.authorized`;
 *                                                   the order stays PENDING_PAYMENT (nothing charged)
 *   captureAuthorizedPayment  (drop CONFIRMED)      provider capture, then the normal
 *                                                   handlePaymentSucceeded path: PAID, ledger,
 *                                                   `production.authorized` -> dispatch + confirmation
 *   releaseOrderPayment       (drop FAILED, expiry) provider release, payment CANCELLED,
 *                                                   order CANCELLED, `payment.authorization_released`
 *
 * Every state change locks the payment row first (same order as payment-events.ts), so a
 * late webhook and a drop close never race each other into two outcomes.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Actor } from '../../contracts/common';
import type { PaymentProviderName } from '../../contracts/enums';
import { withTx } from '../db';
import { orders, payments } from '../db/schema';
import { emitEvent } from '../events/outbox';
import { getPaymentProviderByName } from '../payments';
import { advanceOrder } from './advance';
import { handlePaymentSucceeded, PaymentNotFoundError } from './payment-events';

export type PaymentAuthorizedInput = {
    provider: PaymentProviderName;
    providerRef: string;
    providerPaymentId: string | null;
    amountCents: number;
    currency: string;
    eventId: string;
};

function providerActor(provider: PaymentProviderName): Actor {
    return { kind: 'payment_provider', id: provider };
}

/**
 * Funds are held. Idempotent. If the order can no longer be paid (its claim expired or
 * the drop failed while the buyer was on the payment page), the hold is released at once.
 */
export async function handlePaymentAuthorized(input: PaymentAuthorizedInput): Promise<{ orderId: string; released: boolean }> {
    const actor = providerActor(input.provider);
    const outcome = await withTx(async (tx) => {
        const [payment] = await tx
            .select()
            .from(payments)
            .where(and(eq(payments.provider, input.provider), eq(payments.providerRef, input.providerRef)))
            .for('update');
        if (!payment) throw new PaymentNotFoundError(input.provider, input.providerRef);
        const [order] = await tx.select().from(orders).where(eq(orders.id, payment.orderId)).for('update');
        if (!order) throw new Error(`Order ${payment.orderId} for payment ${payment.id} is missing`);
        if (payment.status !== 'PENDING') return { orderId: order.id, release: payment.status === 'CANCELLED' && !!input.providerPaymentId };
        const currency = input.currency.toLowerCase();
        if (input.amountCents !== payment.amountCents || currency !== payment.currency) {
            await tx
                .update(payments)
                .set({ failureReason: 'AMOUNT_MISMATCH', metadata: { ...payment.metadata, authorizedMismatch: { receivedCents: input.amountCents, currency } }, updatedAt: new Date() })
                .where(eq(payments.id, payment.id));
            return { orderId: order.id, release: true };
        }
        const now = new Date();
        await tx
            .update(payments)
            .set({ status: 'AUTHORIZED', providerPaymentId: input.providerPaymentId ?? payment.providerPaymentId, failureReason: null, updatedAt: now })
            .where(eq(payments.id, payment.id));
        await emitEvent(tx, {
            type: 'payment.authorized',
            payload: { orderId: order.id, paymentId: payment.id, provider: input.provider, providerRef: input.providerRef, amountCents: input.amountCents, currency },
            actor,
            correlationId: order.correlationId,
            buildId: order.buildId,
            orderId: order.id,
            timestamp: now,
        });
        return { orderId: order.id, release: order.status !== 'PENDING_PAYMENT' };
    });
    if (outcome.release) {
        await releaseOrderPayment(outcome.orderId, 'The slot was no longer held when the payment was authorized', providerActor(input.provider));
        return { orderId: outcome.orderId, released: true };
    }
    return { orderId: outcome.orderId, released: false };
}

/**
 * Capture the order's authorized payment, then run the regular payment-succeeded path
 * (PAID, ledger split, production.authorized -> dispatch + buyer confirmation).
 * Returns false when there is no authorized payment (nothing to capture).
 */
export async function captureAuthorizedPayment(orderId: string): Promise<boolean> {
    const [payment] = await withTx(async (tx) =>
        tx
            .select()
            .from(payments)
            .where(and(eq(payments.orderId, orderId), inArray(payments.status, ['AUTHORIZED', 'SUCCEEDED'])))
            .orderBy(desc(payments.createdAt))
            .limit(1),
    );
    if (!payment) return false;
    if (payment.status === 'SUCCEEDED') return true;
    const provider = getPaymentProviderByName(payment.provider);
    const { providerPaymentId } = await provider.capture({ providerRef: payment.providerRef, providerPaymentId: payment.providerPaymentId, amountCents: payment.amountCents });
    await handlePaymentSucceeded({
        provider: payment.provider,
        providerRef: payment.providerRef,
        providerPaymentId,
        amountCents: payment.amountCents,
        currency: payment.currency,
        eventId: `capture:${payment.id}`,
    });
    return true;
}

/**
 * Release whatever the order holds (an authorization or an unpaid session) so nothing is
 * charged, then cancel the order. Idempotent; a payment that already SUCCEEDED is never
 * touched (returns false: refunds go through refundOrder).
 */
export async function releaseOrderPayment(orderId: string, reason: string, actor: Actor): Promise<boolean> {
    const [payment] = await withTx(async (tx) => tx.select().from(payments).where(eq(payments.orderId, orderId)).orderBy(desc(payments.createdAt)).limit(1));
    if (payment?.status === 'SUCCEEDED' || payment?.status === 'REFUNDED') return false;
    if (payment && (payment.status === 'AUTHORIZED' || payment.status === 'PENDING' || payment.status === 'CANCELLED')) {
        try {
            await getPaymentProviderByName(payment.provider).cancelAuthorization({ providerRef: payment.providerRef, providerPaymentId: payment.providerPaymentId, reason });
        } catch (err) {
            // A PENDING session that never reached the provider's checkout simply expires; log and carry on.
            console.error(`[orders] releasing payment ${payment.id} at ${payment.provider} failed`, err);
            if (payment.status === 'AUTHORIZED') throw err;
        }
    }
    return withTx(async (tx) => {
        const [locked] = payment ? await tx.select().from(payments).where(eq(payments.id, payment.id)).for('update') : [undefined];
        const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
        if (!order) return false;
        if (locked?.status === 'SUCCEEDED' || locked?.status === 'REFUNDED') return false;
        const now = new Date();
        if (locked && locked.status !== 'CANCELLED') {
            await tx.update(payments).set({ status: 'CANCELLED', failureReason: reason.slice(0, 300), updatedAt: now }).where(eq(payments.id, locked.id));
            await emitEvent(tx, {
                type: 'payment.authorization_released',
                payload: { orderId, paymentId: locked.id, provider: locked.provider, reason: reason.slice(0, 300) },
                actor,
                correlationId: order.correlationId,
                buildId: order.buildId,
                orderId,
                timestamp: now,
            });
        }
        if (order.status === 'PENDING_PAYMENT' || order.status === 'PAYMENT_FAILED') {
            const cancelled = await emitEvent(tx, {
                type: 'order.cancelled',
                payload: { orderId, reason: reason.slice(0, 300) },
                actor,
                correlationId: order.correlationId,
                buildId: order.buildId,
                orderId,
                timestamp: now,
            });
            await advanceOrder(orderId, 'CANCELLED', actor, { reason: reason.slice(0, 300), causationId: cancelled.event_id, at: now }, tx);
        }
        return true;
    });
}
