/**
 * GET /api/media/clips/:clipId -> ClipCard (public): the replay source + time range and the pinned product.
 */
import { ClipId, type ClipCard } from '@/contracts/media';
import { ApiError, json, route } from '@/server/http';
import { getClip } from '@/server/media';
import { pathId } from '@/server/quote/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route<{ clipId: string }>(async (_request, { params }) => {
    const clipId = pathId((await params).clipId, ClipId, 'Clip');
    const clip = await getClip(clipId);
    if (!clip) throw new ApiError('NOT_FOUND', 'Clip not found');
    return json<ClipCard>(clip);
});
