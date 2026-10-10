/**
 * POST /api/webhooks/livekit — LiveKit webhooks, verified with WebhookReceiver (JWT signed with
 * our API secret whose sha256 claim matches the raw body). Updates viewer counts, room
 * finished, and egress-ended replay URLs. 404 when LiveKit is not configured.
 */
import { ApiError, json, MAX_WEBHOOK_BODY_BYTES, readBodyText, route } from '@/server/http';
import { applyLiveKitWebhook, liveKitConfig, receiveLiveKitWebhook } from '@/server/live';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request) => {
    const cfg = liveKitConfig();
    if (!cfg) throw new ApiError('NOT_FOUND', 'Not found');
    const raw = await readBodyText(request, MAX_WEBHOOK_BODY_BYTES);
    let event;
    try {
        event = await receiveLiveKitWebhook(cfg, raw, request.headers.get('authorization'));
    } catch {
        throw new ApiError('UNAUTHORIZED', 'Invalid LiveKit webhook signature', 401);
    }
    const result = await applyLiveKitWebhook(event);
    return json({ received: true, ...result });
});
