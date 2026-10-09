/**
 * POST /api/builds/:buildId/remix  BuildForkRequest (optional body) -> BuildForkResponse (201), public.
 *
 * Remix: fork the build's latest APPROVED version into a new build with a DERIVED_FROM edge.
 * 409 when the build has no approved version. Per-IP rate limited.
 * Emits `build.created`, `design.version_created` and `build.forked`.
 * Forking only reads the source (anyone with its id may fork it); the NEW build belongs to
 * the signed-in user and/or this device (sets `dm_device` when missing; ADR-0009).
 */
import { BuildForkRequest, BuildId } from '@/contracts';
import { forkBuild, limitWrite } from '@/server/build-graph';
import { resolveBuildOwner } from '@/server/auth/viewer';
import { json, route } from '@/server/http';
import { pathId, readJsonBody, validate } from '@/server/quote/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ buildId: string }>(async (request, { params }) => {
    const buildId = pathId((await params).buildId, BuildId, 'Build');
    const limited = limitWrite(request);
    if (limited) return limited;
    const body = validate(await readJsonBody(request, { allowEmpty: true }), BuildForkRequest);
    const owner = await resolveBuildOwner(request);
    const res = json(await forkBuild(buildId, 'remix', body.name, { owner }), { status: 201 });
    owner.apply(res);
    return res;
});
