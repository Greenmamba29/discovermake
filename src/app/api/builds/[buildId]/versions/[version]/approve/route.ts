/**
 * POST /api/builds/:buildId/versions/:version/approve -> BuildGraphView of that version, public.
 *
 * DRAFT -> APPROVED (immutable); the previously approved version becomes SUPERSEDED.
 * Approving an approved version is a no-op. 404 unknown build / version, 409 superseded or
 * older than the approved version. Per-IP rate limited. Emits `design.version_approved`.
 * TODO(R2 accounts): public like the other R1 build routes; restrict to the build owner.
 */
import { BuildId } from '@/contracts';
import { approveVersion, getGraph, limitWrite } from '@/server/build-graph';
import { ApiError, json, route } from '@/server/http';
import { pathId } from '@/server/quote/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ buildId: string; version: string }>(async (request, { params }) => {
    const p = await params;
    const buildId = pathId(p.buildId, BuildId, 'Build');
    if (!/^[1-9]\d{0,8}$/.test(p.version)) throw new ApiError('NOT_FOUND', 'Version not found');
    const limited = limitWrite(request);
    if (limited) return limited;
    const approved = await approveVersion(buildId, Number(p.version));
    const view = await getGraph(buildId, approved.version);
    if (!view) throw new ApiError('NOT_FOUND', 'Build Graph not found');
    return json(view);
});
