/**
 * POST /api/live/shows/:showId/token -> LiveTokenResponse (public).
 * LiveKit JWT with role-scoped grants when LiveKit is configured; otherwise `livekit: null`
 * and the show's HLS / MP4 source (or none).
 */
import { ShowId, type LiveTokenResponse } from '@/contracts/live';
import { json, route } from '@/server/http';
import { issueJoinToken, loadShowAccess } from '@/server/live';
import { pathId } from '@/server/quote/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ showId: string }>(async (request, { params }) => {
    const showId = pathId((await params).showId, ShowId, 'Show');
    const access = await loadShowAccess(request, showId);
    return json<LiveTokenResponse>(await issueJoinToken(request, access));
});
