/**
 * Inbound payment webhook pipeline shared by Stripe and the dev double:
 *   webhook_events (provider, event_id) dedupe -> normalized handler -> processed_at.
 *
 * A replay of an already-processed event is a no-op. A previously FAILED attempt
 * (processed_at null, error set) is retried. Handlers are idempotent on their own
 * as well (payment row lock), so concurrent duplicate deliveries are safe.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { PaymentProviderName } from '../../contracts/enums';
import { getDb } from '../db';
import { payments, webhookEvents } from '../db/schema';
import type { PaymentWebhookEvent } from '../payments/types';
import { handlePaymentFailed, handlePaymentSucceeded, handleProviderRefund, PaymentNotFoundError } from './payment-events';

export type WebhookOutcome = {
    duplicate: boolean;
    orderId: string | null;
    kind: PaymentWebhookEvent['kind'];
};

function eventTypeOf(event: PaymentWebhookEvent): string {
    return event.kind === 'ignored' ? `ignored:${event.type}` : event.kind;
}

/** Record + process a verified, normalized payment webhook exactly once. */
export async function processPaymentWebhook(provider: PaymentProviderName, event: PaymentWebhookEvent, payload: unknown): Promise<WebhookOutcome> {
    const db = getDb();
    const [inserted] = await db
        .insert(webhookEvents)
        .values({ provider, eventId: event.eventId, eventType: eventTypeOf(event), payload: payload ?? {} })
        .onConflictDoNothing({ target: [webhookEvents.provider, webhookEvents.eventId] })
        .returning();
    if (!inserted) {
        const [existing] = await db
            .select()
            .from(webhookEvents)
            .where(and(eq(webhookEvents.provider, provider), eq(webhookEvents.eventId, event.eventId)));
        if (existing?.processedAt) return { duplicate: true, orderId: null, kind: event.kind };
    }

    try {
        const orderId = await dispatchEvent(provider, event);
        await db
            .update(webhookEvents)
            .set({ processedAt: new Date(), error: null })
            .where(and(eq(webhookEvents.provider, provider), eq(webhookEvents.eventId, event.eventId)));
        return { duplicate: false, orderId, kind: event.kind };
    } catch (err) {
        await db
            .update(webhookEvents)
            .set({ error: String(err instanceof Error ? err.message : err).slice(0, 1000) })
            .where(and(eq(webhookEvents.provider, provider), eq(webhookEvents.eventId, event.eventId)));
        throw err;
    }
}

async function dispatchEvent(provider: PaymentProviderName, event: PaymentWebhookEvent): Promise<string | null> {
    switch (event.kind) {
        case 'payment.succeeded': {
            const r = await handlePaymentSucceeded({
                provider,
                providerRef: event.providerRef,
                providerPaymentId: event.providerPaymentId,
                amountCents: event.amountCents,
                currency: event.currency,
                eventId: event.eventId,
            });
            return r.orderId;
        }
        case 'payment_intent.succeeded': {
            const [payment] = await getDb()
                .select({ providerRef: payments.providerRef })
                .from(payments)
                .where(and(eq(payments.provider, provider), eq(payments.orderId, event.orderId)))
                .orderBy(desc(payments.createdAt))
                .limit(1);
            if (!payment) throw new PaymentNotFoundError(provider, `order:${event.orderId}`);
            const r = await handlePaymentSucceeded({
                provider,
                providerRef: payment.providerRef,
                providerPaymentId: event.providerPaymentId,
                amountCents: event.amountCents,
                currency: event.currency,
                eventId: event.eventId,
            });
            return r.orderId;
        }
        case 'payment.failed': {
            const r = await handlePaymentFailed({ provider, providerRef: event.providerRef, reason: event.reason, eventId: event.eventId });
            return r.orderId;
        }
        case 'payment.refunded': {
            const r = await handleProviderRefund({
                provider,
                providerPaymentId: event.providerPaymentId,
                amountRefundedCents: event.amountRefundedCents,
                fullyRefunded: event.fullyRefunded,
                refundRef: event.refundRef,
            });
            return r.orderId;
        }
        case 'ignored':
            return null;
    }
}
