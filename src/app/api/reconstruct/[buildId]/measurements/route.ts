/**
 * PUT /api/reconstruct/:buildId/measurements  SaveMeasurementsRequest -> ReconstructView
 *
 * Reference marks and measurement lines per photo (pixel coordinates). These are ESTIMATES
 * only: they prefill the caliper table and are never used to generate CAD.
 */
import { SaveMeasurementsRequest } from '@/contracts/reconstruct';
import { limitWrite } from '@/server/build-graph';
import { json, parseJson, route } from '@/server/http';
import { reconstructBuildId, reconstructWriteLimiter, requireOwnedReconstruct } from '@/server/reconstruct/request';
import { getReconstructView, saveMeasurements } from '@/server/reconstruct/sessions';
import { assertNotKidMode } from '@/server/kids/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PUT = route<{ buildId: string }>(async (request, { params }) => {
    await assertNotKidMode(request);
    const buildId = reconstructBuildId((await params).buildId);
    const limited = await limitWrite(request, reconstructWriteLimiter);
    if (limited) return limited;
    const body = await parseJson(request, SaveMeasurementsRequest, 64 * 1024);
    await requireOwnedReconstruct(request, buildId);
    await saveMeasurements(buildId, body);
    return json(await getReconstructView(buildId, { canEdit: true }));
});
