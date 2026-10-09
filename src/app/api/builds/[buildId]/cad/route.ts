/**
 * GET  /api/builds/:buildId/cad                    -> BuildCadGenerated | null   (latest CAD, fresh signed URLs)
 * POST /api/builds/:buildId/cad  { spec? }         -> BuildCadResponse            (build owner only, per-IP rate limited)
 *
 * POST needs the latest design version APPROVED with no open questions (409 otherwise).
 * With `spec`, the buyer's own dimensions are used as given. Without it, the CAD agent
 * proposes a spec from the approved graph; missing or untraceable dimensions come back as
 * `needs_input` (added as questions in a new version), never as guesses. 501 when the CAD
 * worker is not configured; 503 when no spec is given and Make AI is unavailable.
 * POST is 403 unless the caller may edit the build (owner, its device, or ops; ADR-0009).
 */
import { BuildId } from '@/contracts';
import { BuildCadRequest } from '@/contracts/cad';
import { limitWrite } from '@/server/build-graph';
import { getBuildCad, generateBuildCad } from '@/server/cad/build-cad';
import { isCadWorkerConfigured } from '@/server/cad/client';
import { assertCanEditBuildId } from '@/server/auth/build-access';
import { env } from '@/server/env';
import { ApiError, json, MAX_JSON_BODY_BYTES, parseJson, route } from '@/server/http';
import { pathId } from '@/server/quote/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = route<{ buildId: string }>(async (_request, { params }) => {
    const buildId = pathId((await params).buildId, BuildId, 'Build');
    return json(await getBuildCad(buildId));
});

export const POST = route<{ buildId: string }>(async (request, { params }) => {
    const buildId = pathId((await params).buildId, BuildId, 'Build');
    const limited = limitWrite(request);
    if (limited) return limited;
    await assertCanEditBuildId(request, buildId);
    const body = await parseJson(request, BuildCadRequest, MAX_JSON_BODY_BYTES);
    if (!isCadWorkerConfigured()) throw new ApiError('NOT_IMPLEMENTED', 'CAD generation is not available yet.', 501);
    if (!body.spec && !(env().MAKE_AI_ENABLED && env().GOOGLE_GENERATIVE_AI_API_KEY)) {
        throw new ApiError('INTERNAL', 'Make AI is not available to size this part. Enter the dimensions yourself.', 503);
    }
    return json(await generateBuildCad(buildId, { spec: body.spec }), { status: 201 });
});
