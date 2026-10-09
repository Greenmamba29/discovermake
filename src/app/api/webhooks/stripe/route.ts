/**
 * POST /api/webhooks/stripe  raw Stripe event -> { received: true }
 * Signature verified with STRIPE_WEBHOOK_SECRET over the RAW body, deduped in
 * webhook_events, then routed to the order handlers. Processing errors answer 500
 * so Stripe retries; bad signatures answer 400.
 * R3: verified subscription (Prime) and invoice (B2B) events go to their own handlers first.
 */
import { env } from '@/server/env';
import { ApiError, json, MAX_WEBHOOK_BODY_BYTES, readBodyText, route } from '@/server/http';
import { processPaymentWebhook } from '@/server/orders';
import { StripePaymentProvider } from '@/server/payments';
import { routeStripeExtensionEvent } from '@/server/prime/stripe-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request) => {
    if (!env().STRIPE_WEBHOOK_SECRET) throw new ApiError('INTERNAL', 'Stripe webhook is not configured', 503);
    const rawBody = await readBodyText(request, MAX_WEBHOOK_BODY_BYTES);
    let event;
    try {
        event = await new StripePaymentProvider().parseWebhook(rawBody, request.headers);
    } catch (err) {
        console.warn('[webhooks/stripe] rejected', err instanceof Error ? err.message : err);
        throw new ApiError('BAD_REQUEST', 'Invalid Stripe webhook signature');
    }
    const raw = JSON.parse(rawBody);
    if (await routeStripeExtensionEvent(raw)) return json({ received: true as const });
    await processPaymentWebhook('stripe', event, raw);
    return json({ received: true as const });
});
