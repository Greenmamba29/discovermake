/**
 * Ops refund of a paid order before shipping (no shop accepted, QA unrecoverable,
 * buyer request before production).
 *
 * The whole refund runs under the payment + order row locks (payment first, then
 * order: the same order every payment handler uses): the status is checked under
 * FOR UPDATE, the provider refund is issued while the locks are held, and then one
 * commit applies payment REFUNDED, order REFUNDED, `order.refunded`, open jobs
 * cancelled and the ledger reversal. Shop actions (inspection, ship, milestones) lock
 * the order first, so production cannot advance past a refundable state while the
 * provider call is in flight; they resume afterwards against a REFUNDED order and
 * a CANCELLED job and are refused.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { Actor } from '../../contracts/common';
import { getDb, withTx } from '../db';
import { orders, payments } from '../db/schema';
import { ApiError } from '../http';
import { getPaymentProviderByName } from '../payments';
import { OrderNotFoundError } from './advance';
import { applyFullRefund } from './payment-events';
import { assertTransition } from './state';

export async function refundOrder(orderId: string, actor: Actor, reason: string): Promise<void> {
    const db = getDb();
    const [peek] = await db.select({ id: orders.id }).from(orders).where(eq(orders.id, orderId));
    if (!peek) throw new OrderNotFoundError(orderId);
    const [candidate] = await db
        .select({ id: payments.id })
        .from(payments)
        .where(and(eq(payments.orderId, orderId), eq(payments.status, 'SUCCEEDED')))
        .orderBy(desc(payments.succeededAt))
        .limit(1);

    await withTx(async (tx) => {
        // Lock order: payment, then order (matches lockPayment / applyFullRefund / handleProviderRefund).
        const [payment] = candidate ? await tx.select().from(payments).where(eq(payments.id, candidate.id)).for('update') : [];
        const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
        if (!order) throw new OrderNotFoundError(orderId);
        if (order.status === 'REFUNDED') return;
        assertTransition(order.status, 'REFUNDED'); // IllegalTransitionError -> 409 (e.g. already shipped)
        if (!payment || payment.status !== 'SUCCEEDED') throw new ApiError('CONFLICT', `Order ${order.orderNumber} has no succeeded payment to refund`);

        let refundRef: string;
        try {
            ({ refundRef } = await getPaymentProviderByName(payment.provider).refund({
                providerRef: payment.providerRef,
                providerPaymentId: payment.providerPaymentId,
                amountCents: payment.amountCents,
                reason,
            }));
        } catch (err) {
            console.error('[orders] provider refund failed', err);
            throw new ApiError('PAYMENT_ERROR', `The payment provider refused the refund: ${err instanceof Error ? err.message : String(err)}`);
        }
        await applyFullRefund(tx, { paymentId: payment.id, refundRef, reason, actor });
    });
}
