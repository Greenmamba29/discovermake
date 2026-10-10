/**
 * GET  /api/builds/:buildId/text-to-cad           -> MakeIt3dStatus (always 200: an honest unavailable state)
 * POST /api/builds/:buildId/text-to-cad {prompt}  -> MakeIt3dResponse
 *        201 `generated` (a NEW DRAFT design version with the cadgen model)
 *        200 `unavailable` (Make AI off, no model key, or no CAD worker) or `failed` (plain reason by code)
 *
 * Make AI "Make it in 3D": Make AI writes a cadgen script for the buyer's description; the CAD
 * worker gates it and builds it in its sandbox (generated code runs nowhere else). The buyer then
 * approves the version (POST .../versions/:v/approve) before a BINDING print quote
 * (POST .../text-to-cad/quote). Owner-only writes (assertCanEditBuild); per-IP and fleet-wide
 * rate limits on the shared store. Body cap 8 KB.
 */
import { BuildId } from '@/contracts';
import { MakeIt3dRequest } from '@/contracts/make-it-3d';
import { limitWrite } from '@/server/build-graph';
import { assertCanEditBuild, getViewer } from '@/server/auth/viewer';
import { userActor } from '@/server/auth/users';
import { json, parseJson, route } from '@/server/http';
import { pathId } from '@/server/quote/route-helpers';
import { MAKE_IT_3D_RATE_LIMIT_MESSAGE, makeIt3dLimiter } from '@/server/text-to-cad/request';
import { getMakeIt3dStatus, makeIn3D } from '@/server/text-to-cad/service';
import { requireBuild } from '@/server/workspace/attachments';
import { assertNotKidMode } from '@/server/kids/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Up to three model calls and three sandboxed builds (120 s cap each on the worker). */
export const maxDuration = 300;

export const GET = route<{ buildId: string }>(async (_request, { params }) => {
    const buildId = pathId((await params).buildId, BuildId, 'Build');
    return json(await getMakeIt3dStatus(buildId));
});

export const POST = route<{ buildId: string }>(async (request, { params }) => {
    await assertNotKidMode(request);
    const buildId = pathId((await params).buildId, BuildId, 'Build');
    const body = await parseJson(request, MakeIt3dRequest, 8 * 1024);
    const build = await requireBuild(buildId);
    await assertCanEditBuild(request, build);
    const limited = await limitWrite(request, makeIt3dLimiter, MAKE_IT_3D_RATE_LIMIT_MESSAGE);
    if (limited) return limited;
    const viewer = await getViewer(request);
    const result = await makeIn3D(buildId, body.prompt, { actor: viewer ? userActor(viewer.user.id) : undefined, abortSignal: request.signal });
    return json(result, { status: result.status === 'generated' ? 201 : 200 });
});
