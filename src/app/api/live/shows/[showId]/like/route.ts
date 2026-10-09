/**
 * POST /api/live/shows/:showId/like -> LikeResponse (signed in; one like per viewer).
 */
import { ShowId, type LikeResponse } from '@/contracts/live';
import { json, route } from '@/server/http';
import { likeShow, limitLive, loadShowAccess, requireSignedIn } from '@/server/live';
import { pathId } from '@/server/quote/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ showId: string }>(async (request, { params }) => {
    const showId = pathId((await params).showId, ShowId, 'Show');
    const access = await loadShowAccess(request, showId);
    requireSignedIn(access);
    const limited = limitLive('like', access.viewer.user.id);
    if (limited) return limited;
    return json<LikeResponse>(await likeShow(access));
});
