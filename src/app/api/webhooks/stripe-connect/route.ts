/**
 * POST /api/webhooks/stripe-connect  raw Stripe Connect event -> { received: true }
 * Endpoint registered for "events on connected accounts". Signature verified with
 * STRIPE_CONNECT_WEBHOOK_SECRET over the RAW, size-capped body, deduped in webhook_events
 * (provider `stripe_connect`); `account.updated` emits `shop.connect_account_updated`.
 * Bad signatures answer 400; processing errors answer 500 so Stripe retries;
 * 503 when the endpoint secret is not configured.
 */
import { ApiError, json, MAX_WEBHOOK_BODY_BYTES, readBodyText, route } from '@/server/http';
import { ConnectWebhookSignatureError, processConnectWebhook } from '@/server/shops/connect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request) => {
    const rawBody = await readBodyText(request, MAX_WEBHOOK_BODY_BYTES);
    try {
        await processConnectWebhook(rawBody, request.headers);
    } catch (err) {
        if (err instanceof ConnectWebhookSignatureError) {
            console.warn('[webhooks/stripe-connect] rejected', err.message);
            throw new ApiError('BAD_REQUEST', 'Invalid Stripe webhook signature');
        }
        throw err;
    }
    return json({ received: true as const });
});
