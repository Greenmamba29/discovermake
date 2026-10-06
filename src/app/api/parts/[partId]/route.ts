/**
 * GET /api/parts/:partId -> PartView (public; ids are unguessable).
 */
import { PartId } from '@/contracts';
import { ApiError, json, route } from '@/server/http';
import { getPart } from '@/server/quote';
import { pathId } from '@/server/quote/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route<{ partId: string }>(async (_request, { params }) => {
    const partId = pathId((await params).partId, PartId, 'Part');
    const part = await getPart(partId);
    if (!part) throw new ApiError('NOT_FOUND', 'Part not found');
    return json(part);
});
