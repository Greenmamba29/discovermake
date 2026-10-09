/**
 * POST /api/reconstruct/:buildId/dimensions  ConfirmDimensionsRequest -> ReconstructView
 *
 * The hard rule's write path: caliper / ruler readings (mm or in, normalized to mm at 0.01 mm)
 * become buyer-stated dimension nodes in a new design version. Emits
 * `reconstruct.dimension_confirmed` per reading.
 */
import { ConfirmDimensionsRequest } from '@/contracts/reconstruct';
import { limitWrite } from '@/server/build-graph';
import { json, parseJson, route } from '@/server/http';
import { reconstructBuildId, reconstructWriteLimiter, requireOwnedReconstruct } from '@/server/reconstruct/request';
import { confirmDimensions, getReconstructView } from '@/server/reconstruct/sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ buildId: string }>(async (request, { params }) => {
    const buildId = reconstructBuildId((await params).buildId);
    const limited = await limitWrite(request, reconstructWriteLimiter);
    if (limited) return limited;
    const body = await parseJson(request, ConfirmDimensionsRequest, 8 * 1024);
    const { owner } = await requireOwnedReconstruct(request, buildId);
    await confirmDimensions(buildId, body, { owner });
    return json(await getReconstructView(buildId, { canEdit: true }));
});
