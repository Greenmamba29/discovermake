/**
 * POST /api/webhooks/stripe  raw Stripe event -> { received: true }
 * Signature verified with STRIPE_WEBHOOK_SECRET over the RAW body, deduped in
 * webhook_events, then routed to the order handlers. Processing errors answer 500
 * so Stripe retries; bad signatures answer 400.
 */
import { env } from '@/server/env';
import { ApiError, json, route } from '@/server/http';
import { processPaymentWebhook } from '@/server/orders';
import { StripePaymentProvider } from '@/server/payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request) => {
    if (!env().STRIPE_WEBHOOK_SECRET) throw new ApiError('INTERNAL', 'Stripe webhook is not configured', 503);
    const rawBody = await request.text();
    let event;
    try {
        event = await new StripePaymentProvider().parseWebhook(rawBody, request.headers);
    } catch (err) {
        console.warn('[webhooks/stripe] rejected', err instanceof Error ? err.message : err);
        throw new ApiError('BAD_REQUEST', 'Invalid Stripe webhook signature');
    }
    await processPaymentWebhook('stripe', event, JSON.parse(rawBody));
    return json({ received: true as const });
});
