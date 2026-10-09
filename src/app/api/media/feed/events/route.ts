/**
 * POST /api/media/feed/events FeedEventsRequest -> { recorded } (signed in or a guest device).
 * Impressions, clicks, plays and Make This from the feed, logged for a future learned ranker.
 * Rate limited per user / device (shared limiter).
 */
import { FeedEventsRequest } from '@/contracts/media';
import { assertSameOrigin, getDeviceHash, getViewer } from '@/server/auth/viewer';
import { json, parseJson, route } from '@/server/http';
import { feedEventsLimiter, feedViewerFrom, recordFeedEvents } from '@/server/media';
import { limited, limitKey } from '@/server/media/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request) => {
    assertSameOrigin(request);
    const viewer = await getViewer(request);
    const deviceHash = getDeviceHash(request);
    const tooFast = await limited(feedEventsLimiter, limitKey(request, viewer?.user.id ?? (deviceHash ? `dev:${deviceHash}` : null)));
    if (tooFast) return tooFast;
    const body = await parseJson(request, FeedEventsRequest);
    return json({ recorded: await recordFeedEvents(feedViewerFrom(viewer, deviceHash), body.events) }, { status: 201 });
});
