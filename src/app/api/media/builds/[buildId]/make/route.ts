/**
 * POST /api/media/builds/:buildId/make MakeFromBuildRequest -> MakeFromBuildResponse (201).
 *
 * Make This (`clone`) or Remix a published build, licence enforced (403 when the licence does
 * not allow remixes). The new build belongs to the signed-in user and/or this device; its flat
 * pattern is copied so it can be quoted and ordered right away, and its orders pay the
 * creator's royalty. Logged as a `make_this` / `remix` feed event. Rate limited.
 */
import { BuildId } from '@/contracts/common';
import { MakeFromBuildRequest, type MakeFromBuildResponse } from '@/contracts/media';
import { assertSameOrigin, getViewer, resolveBuildOwner } from '@/server/auth/viewer';
import { json, route } from '@/server/http';
import { feedViewerFrom, makeFromBuild, makeLimiter, recordFeedEvents } from '@/server/media';
import { limited, limitKey } from '@/server/media/http';
import { pathId, readJsonBody, validate } from '@/server/quote/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ buildId: string }>(async (request, { params }) => {
    assertSameOrigin(request);
    const buildId = pathId((await params).buildId, BuildId, 'Build');
    const viewer = await getViewer(request);
    const tooFast = await limited(makeLimiter, limitKey(request, viewer?.user.id));
    if (tooFast) return tooFast;
    const body = validate(await readJsonBody(request), MakeFromBuildRequest);
    const owner = await resolveBuildOwner(request);
    const made = await makeFromBuild(buildId, body.kind, owner, viewer, body.name);
    await recordFeedEvents(feedViewerFrom(viewer, owner.deviceHash), [{ kind: body.kind === 'clone' ? 'make_this' : 'remix', itemKind: 'build', itemId: buildId, tab: 'build_page' }]).catch(() => 0);
    if (body.via && /^clp_[A-Za-z0-9_-]+$/.test(body.via)) {
        await recordFeedEvents(feedViewerFrom(viewer, owner.deviceHash), [{ kind: body.kind === 'clone' ? 'make_this' : 'remix', itemKind: 'clip', itemId: body.via, tab: 'clip_page' }]).catch(() => 0);
    }
    const res = json<MakeFromBuildResponse>(made, { status: 201 });
    owner.apply(res);
    return res;
});
