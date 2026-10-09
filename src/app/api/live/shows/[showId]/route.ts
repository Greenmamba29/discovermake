/**
 * GET   /api/live/shows/:showId -> ShowSnapshot (public; viewer-specific fields when signed in)
 * PATCH /api/live/shows/:showId UpdateShowRequest -> ShowView (channel owner)
 */
import { ShowId, UpdateShowRequest, type ShowSnapshot } from '@/contracts/live';
import { assertSameOrigin } from '@/server/auth/viewer';
import { ApiError, json, parseJson, route } from '@/server/http';
import { buildSnapshot, loadShowAccess, updateShow } from '@/server/live';
import { pathId } from '@/server/quote/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route<{ showId: string }>(async (request, { params }) => {
    const showId = pathId((await params).showId, ShowId, 'Show');
    const access = await loadShowAccess(request, showId);
    return json<ShowSnapshot>(await buildSnapshot(access));
});

export const PATCH = route<{ showId: string }>(async (request, { params }) => {
    assertSameOrigin(request);
    const showId = pathId((await params).showId, ShowId, 'Show');
    const access = await loadShowAccess(request, showId);
    if (!access.viewer) throw new ApiError('UNAUTHORIZED', 'Sign in to edit this show', 401);
    if (access.role !== 'host') throw new ApiError('FORBIDDEN', 'Only the channel owner can edit this show', 403);
    const body = await parseJson(request, UpdateShowRequest);
    return json(await updateShow(access.show, access.viewer, body));
});
