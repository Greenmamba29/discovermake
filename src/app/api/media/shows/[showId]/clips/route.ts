/**
 * GET  /api/media/shows/:showId/clips -> ShowClipsResponse (public; suggestions for the host only)
 * POST /api/media/shows/:showId/clips CreateClipRequest -> ClipCard (201, host of an ENDED show)
 *
 * Suggestions and chapters come from the Live Build Protocol log (`product.focus`,
 * `drop.started`, `auction.started`, ...). Emits `clip.created`.
 */
import { ShowId } from '@/contracts/live';
import { CreateClipRequest, type ClipCard, type ShowClipsResponse } from '@/contracts/media';
import { assertSameOrigin, getViewer, requireViewer } from '@/server/auth/viewer';
import { json, parseJson, route } from '@/server/http';
import { createClip, showClips } from '@/server/media';
import { limited } from '@/server/media/http';
import { pathId } from '@/server/quote/route-helpers';
import { RateLimiter } from '@/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const clipLimiter = new RateLimiter('media_clip', { kind: 'fixed_window', limit: 30, windowMs: 60_000 });

export const GET = route<{ showId: string }>(async (request, { params }) => {
    const showId = pathId((await params).showId, ShowId, 'Show');
    return json<ShowClipsResponse>(await showClips(showId, await getViewer(request)));
});

export const POST = route<{ showId: string }>(async (request, { params }) => {
    assertSameOrigin(request);
    const showId = pathId((await params).showId, ShowId, 'Show');
    const viewer = await requireViewer(request);
    const tooFast = await limited(clipLimiter, viewer.user.id);
    if (tooFast) return tooFast;
    const body = await parseJson(request, CreateClipRequest);
    return json<ClipCard>(await createClip(showId, viewer, body), { status: 201 });
});
