/**
 * POST /api/media/builds/:buildId/publish PublishBuildRequest -> PublicationView (the signed-in build owner).
 * Sets visibility (private / public), remix licence, royalty % (0–30), tags and cover.
 * Remixes of a personal / all-rights-reserved design cannot go public (403 LICENSE).
 * Emits `build.published`. Rate limited per user (shared limiter).
 */
import { BuildId } from '@/contracts/common';
import { PublishBuildRequest, type PublicationView } from '@/contracts/media';
import { assertSameOrigin, requireViewer } from '@/server/auth/viewer';
import { json, parseJson, route } from '@/server/http';
import { publishBuild, publishLimiter } from '@/server/media';
import { limited } from '@/server/media/http';
import { pathId } from '@/server/quote/route-helpers';
import { assertNotKidMode } from '@/server/kids/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ buildId: string }>(async (request, { params }) => {
    await assertNotKidMode(request);
    assertSameOrigin(request);
    const buildId = pathId((await params).buildId, BuildId, 'Build');
    const viewer = await requireViewer(request);
    const tooFast = await limited(publishLimiter, viewer.user.id);
    if (tooFast) return tooFast;
    const body = await parseJson(request, PublishBuildRequest);
    return json<PublicationView>(await publishBuild(viewer, buildId, body));
});
