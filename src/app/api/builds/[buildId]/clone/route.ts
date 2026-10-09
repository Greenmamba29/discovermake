/**
 * POST /api/builds/:buildId/clone  BuildForkRequest (optional body) -> BuildForkResponse (201), public.
 *
 * Make This: clone the build's latest APPROVED version into a new build.
 * 409 when the build has no approved version. Per-IP rate limited.
 * Emits `build.created`, `design.version_created` and `build.forked`.
 * TODO(R2 accounts): attribute the new build to the signed-in buyer.
 */
import { BuildForkRequest, BuildId } from '@/contracts';
import { forkBuild, limitWrite } from '@/server/build-graph';
import { json, route } from '@/server/http';
import { pathId, readJsonBody, validate } from '@/server/quote/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ buildId: string }>(async (request, { params }) => {
    const buildId = pathId((await params).buildId, BuildId, 'Build');
    const limited = await limitWrite(request);
    if (limited) return limited;
    const body = validate(await readJsonBody(request, { allowEmpty: true }), BuildForkRequest);
    return json(await forkBuild(buildId, 'clone', body.name), { status: 201 });
});
