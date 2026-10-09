/**
 * Dev payment confirmation (PAYMENT_PROVIDER=dev, never in production).
 * Runs the exact same pipeline as a real provider webhook:
 *   DevPaymentProvider.parseWebhook -> processPaymentWebhook (webhook_events dedupe)
 *   -> handlePaymentSucceeded / handlePaymentFailed.
 */
import { and, eq } from 'drizzle-orm';
import { DevPaymentConfirmRequest, DevPaymentConfirmResponse } from '../../contracts/checkout';
import { getDb } from '../db';
import { orders, payments } from '../db/schema';
import { assertNotProduction } from '../env';
import { ApiError } from '../http';
import { DevPaymentNotFoundError, DevPaymentProvider, isDevPaymentEnabled } from '../payments/dev';
import { orderUrlFromPaymentMetadata } from './link-vault';
import { processPaymentWebhook } from './webhooks';

export async function confirmDevPayment(rawBody: string, headers: Headers): Promise<DevPaymentConfirmResponse> {
    if (!isDevPaymentEnabled()) throw new ApiError('NOT_FOUND', 'Not found');
    assertNotProduction('dev payment provider');

    let raw: unknown;
    try {
        raw = JSON.parse(rawBody);
    } catch {
        throw new ApiError('BAD_REQUEST', 'Request body must be valid JSON');
    }
    const parsed = DevPaymentConfirmRequest.safeParse(raw);
    if (!parsed.success) throw new ApiError('VALIDATION_FAILED', 'Request validation failed', 400, parsed.error.flatten());

    const provider = new DevPaymentProvider();
    let event;
    try {
        event = await provider.parseWebhook(JSON.stringify(parsed.data), headers);
    } catch (err) {
        if (err instanceof DevPaymentNotFoundError) throw new ApiError('NOT_FOUND', 'Payment session not found');
        throw err;
    }
    await processPaymentWebhook('dev', event, parsed.data);

    const db = getDb();
    const [payment] = await db
        .select()
        .from(payments)
        .where(and(eq(payments.provider, 'dev'), eq(payments.providerRef, parsed.data.providerRef)));
    if (!payment) {
        // R3 cart checkout / invoice group: land on the signed confirmation page listing every order.
        const { findGroupByRef, groupUrlFromRow } = await import('../cart/payment-group');
        const group = await findGroupByRef('dev', parsed.data.providerRef);
        if (!group) throw new ApiError('NOT_FOUND', 'Payment session not found');
        const [first] = await db.select({ id: orders.id, status: orders.status }).from(orders).where(eq(orders.id, group.orderIds[0]));
        const url = groupUrlFromRow(group);
        if (!first || !url) throw new ApiError('INTERNAL', 'Order link could not be recovered');
        return DevPaymentConfirmResponse.parse({ orderId: first.id, status: first.status, redirectUrl: url });
    }
    const [order] = await db.select({ id: orders.id, status: orders.status }).from(orders).where(eq(orders.id, payment.orderId));
    if (!order) throw new ApiError('NOT_FOUND', 'Order not found');
    const redirectUrl = orderUrlFromPaymentMetadata(order.id, payment.metadata);
    if (!redirectUrl) throw new ApiError('INTERNAL', 'Order link could not be recovered');
    return DevPaymentConfirmResponse.parse({ orderId: order.id, status: order.status, redirectUrl });
}
