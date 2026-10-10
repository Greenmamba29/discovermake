/**
 * GET   /api/reconstruct/:buildId                          -> ReconstructView
 * PATCH /api/reconstruct/:buildId  UpdateReconstructRequest -> ReconstructView
 *
 * Anyone with the unguessable build id can view (ADR-0008); only the owner changes the
 * choices, material and quantity (403 otherwise).
 */
import { UpdateReconstructRequest } from '@/contracts/reconstruct';
import { limitWrite } from '@/server/build-graph';
import { json, parseJson, route } from '@/server/http';
import { canEditReconstruct, reconstructBuildId, reconstructWriteLimiter, requireOwnedReconstruct } from '@/server/reconstruct/request';
import { getReconstructView, updateReconstruct } from '@/server/reconstruct/sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { buildId: string };

export const GET = route<Params>(async (request, { params }) => {
    const buildId = reconstructBuildId((await params).buildId);
    const canEdit = await canEditReconstruct(request, buildId);
    return json(await getReconstructView(buildId, { canEdit }));
});

export const PATCH = route<Params>(async (request, { params }) => {
    const buildId = reconstructBuildId((await params).buildId);
    const limited = await limitWrite(request, reconstructWriteLimiter);
    if (limited) return limited;
    const body = await parseJson(request, UpdateReconstructRequest, 8 * 1024);
    await requireOwnedReconstruct(request, buildId);
    await updateReconstruct(buildId, body);
    return json(await getReconstructView(buildId, { canEdit: true }));
});
