/**
 * GET /api/media/builds/:buildId -> PublicBuildView (the public build page `/b/:buildId`).
 * 404 unless the build is published publicly (its owner also sees it while private).
 */
import { BuildId } from '@/contracts/common';
import type { PublicBuildView } from '@/contracts/media';
import { getViewer } from '@/server/auth/viewer';
import { ApiError, json, route } from '@/server/http';
import { publicBuildView } from '@/server/media';
import { pathId } from '@/server/quote/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route<{ buildId: string }>(async (request, { params }) => {
    const buildId = pathId((await params).buildId, BuildId, 'Build');
    const view = await publicBuildView(buildId, await getViewer(request));
    if (!view) throw new ApiError('NOT_FOUND', 'Build not found');
    return json<PublicBuildView>(view);
});
