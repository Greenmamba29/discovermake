/**
 * GET /api/builds/:buildId -> BuildView (public; ids are unguessable).
 */
import { BuildId } from '@/contracts';
import { ApiError, json, route } from '@/server/http';
import { getBuild } from '@/server/quote';
import { pathId } from '@/server/quote/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route<{ buildId: string }>(async (_request, { params }) => {
    const buildId = pathId((await params).buildId, BuildId, 'Build');
    const build = await getBuild(buildId);
    if (!build) throw new ApiError('NOT_FOUND', 'Build not found');
    return json(build);
});
