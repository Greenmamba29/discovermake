/**
 * POST /api/reconstruct/:buildId/generate -> ReconstructGenerateResponse
 *
 * Planner (confirmed caliper readings only) -> approve -> CAD worker -> print quote.
 *   200 needs_input  a critical dimension is not confirmed yet (nothing is generated)
 *   200 generated    the new CAD version (+ its print quote id, or the laser part id)
 *   503              CAD service unavailable (CAD_WORKER_URL unset or down); nothing written
 */
import { limitWrite } from '@/server/build-graph';
import { json, route } from '@/server/http';
import { reconstructBuildId, reconstructGenerateLimiter, requireOwnedReconstruct } from '@/server/reconstruct/request';
import { generateReconstruct } from '@/server/reconstruct/sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export const POST = route<{ buildId: string }>(async (request, { params }) => {
    const buildId = reconstructBuildId((await params).buildId);
    const limited = await limitWrite(request, reconstructGenerateLimiter, 'Too many CAD runs in a short time. Wait a minute and try again.');
    if (limited) return limited;
    const { owner } = await requireOwnedReconstruct(request, buildId);
    return json(await generateReconstruct(buildId, { owner }));
});
