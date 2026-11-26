/**
 * POST /api/builds/:buildId/text-to-cad/parameters {changes: {name: expression}} -> MakeIt3dResponse
 *        201 `generated` (a NEW DRAFT design version with the new sizes)
 *        200 `unavailable` (no CAD worker) or `failed` (the engine's plain reason, e.g. a size the
 *            model cannot take)
 *
 * SolidCraft models only: the stored command script is rebuilt by the CAD worker with the new
 * values (no Make AI call). The buyer approves the new version before a BINDING quote, as for any
 * model. Owner-only writes (assertCanEditBuild); the same rate limits as Make it in 3D. Body cap 8 KB.
 */
import { BuildId } from '@/contracts';
import { MakeIt3dParametersRequest } from '@/contracts/make-it-3d';
import { limitWrite } from '@/server/build-graph';
import { assertCanEditBuild, getViewer } from '@/server/auth/viewer';
import { userActor } from '@/server/auth/users';
import { json, parseJson, route } from '@/server/http';
import { assertNotKidMode } from '@/server/kids/session';
import { pathId } from '@/server/quote/route-helpers';
import { MAKE_IT_3D_RATE_LIMIT_MESSAGE, makeIt3dLimiter } from '@/server/text-to-cad/request';
import { changeMakeIt3dParameters } from '@/server/text-to-cad/service';
import { requireBuild } from '@/server/workspace/attachments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** One sandboxed build (90 s cap on the worker) plus transfer. */
export const maxDuration = 180;

export const POST = route<{ buildId: string }>(async (request, { params }) => {
    await assertNotKidMode(request);
    const buildId = pathId((await params).buildId, BuildId, 'Build');
    const body = await parseJson(request, MakeIt3dParametersRequest, 8 * 1024);
    const build = await requireBuild(buildId);
    await assertCanEditBuild(request, build);
    const limited = await limitWrite(request, makeIt3dLimiter, MAKE_IT_3D_RATE_LIMIT_MESSAGE);
    if (limited) return limited;
    const viewer = await getViewer(request);
    const result = await changeMakeIt3dParameters(buildId, body, { actor: viewer ? userActor(viewer.user.id) : undefined });
    return json(result, { status: result.status === 'generated' ? 201 : 200 });
});
