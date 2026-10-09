/**
 * GET /api/live/shows/:showId/events?after=<seq>[&format=json]
 *
 * Server-Sent Events (text/event-stream): `id:` = seq so `Last-Event-ID` resumes, heartbeat
 * comments every 15 s, about 1 s polling, closes after about 5 minutes (clients reconnect).
 * `format=json` returns `{ events, lastSeq }` for polling clients and tests.
 */
import { ShowId } from '@/contracts/live';
import { getViewer } from '@/server/auth/viewer';
import { ApiError, json, route } from '@/server/http';
import { listLiveEvents, liveEventStream, resumeSeq, SSE_HEADERS } from '@/server/live';
import { loadShow } from '@/server/live/views';
import { pathId } from '@/server/quote/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route<{ showId: string }>(async (request, { params }) => {
    const showId = pathId((await params).showId, ShowId, 'Show');
    const show = await loadShow(showId);
    if (!show) throw new ApiError('NOT_FOUND', 'Show not found');
    const after = resumeSeq(request);
    if (new URL(request.url).searchParams.get('format') === 'json') {
        const events = await listLiveEvents(showId, { after, limit: 500 });
        return json({ events, lastSeq: events.length ? events[events.length - 1].seq : after });
    }
    const viewer = await getViewer(request);
    const stream = liveEventStream(showId, after, { signal: request.signal, presenceKey: show.status === 'LIVE' ? (viewer ? `usr:${viewer.user.id}` : undefined) : null });
    return new Response(stream, { headers: SSE_HEADERS });
});
