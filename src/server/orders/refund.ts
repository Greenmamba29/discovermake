/**
 * Ops refund of a paid order before shipping (no shop accepted, QA unrecoverable,
 * buyer request before production). Provider refund first (idempotent at the
 * provider), then one transaction: payment REFUNDED, order REFUNDED,
 * `order.refunded`, ledger reversal.
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
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    if (!order) throw new OrderNotFoundError(orderId);
    if (order.status === 'REFUNDED') return;
    assertTransition(order.status, 'REFUNDED'); // IllegalTransitionError -> 409 (e.g. already shipped)

    const [payment] = await db
        .select()
        .from(payments)
        .where(and(eq(payments.orderId, orderId), eq(payments.status, 'SUCCEEDED')))
        .orderBy(desc(payments.succeededAt))
        .limit(1);
    if (!payment) throw new ApiError('CONFLICT', `Order ${order.orderNumber} has no succeeded payment to refund`);

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

    await withTx(async (tx) => {
        await applyFullRefund(tx, { paymentId: payment.id, refundRef, reason, actor });
    });
}
