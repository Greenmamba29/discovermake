/**
 * POST /api/webhooks/easypost  raw EasyPost event -> { received: true }
 * Verified with EASYPOST_WEBHOOK_SECRET (X-Hmac-Signature over the RAW body), deduped in
 * webhook_events, applied to the shipment (DELIVERED runs the delivery orchestration).
 * Bad signatures answer 401; processing errors answer 500 so EasyPost retries.
 */
import { ApiError, json, route } from '@/server/http';
import { processCarrierWebhook, WebhookSignatureError } from '@/server/shipping';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request) => {
    const rawBody = await request.text();
    try {
        await processCarrierWebhook(rawBody, request.headers);
    } catch (err) {
        if (err instanceof WebhookSignatureError) {
            console.warn('[webhooks/easypost] rejected', err.message);
            throw new ApiError('UNAUTHORIZED', 'Invalid carrier webhook signature', 401);
        }
        throw err;
    }
    return json({ received: true as const });
});
