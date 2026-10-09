/**
 * POST /api/builds/:buildId/versions/:version/approve -> BuildGraphView of that version, build owner only.
 *
 * DRAFT -> APPROVED (immutable); the previously approved version becomes SUPERSEDED.
 * Approving an approved version is a no-op. 404 unknown build / version, 409 superseded or
 * older than the approved version. Per-IP rate limited. Emits `design.version_approved`.
 * 403 unless the caller may edit the build (owner, its device, or ops; ADR-0009).
 */
import { BuildId } from '@/contracts';
import { approveVersion, getGraph, limitWrite } from '@/server/build-graph';
import { assertCanEditBuildId } from '@/server/auth/build-access';
import { userActor } from '@/server/auth/users';
import { getViewer } from '@/server/auth/viewer';
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
    await assertCanEditBuildId(request, buildId);
    const viewer = await getViewer(request);
    const approved = await approveVersion(buildId, Number(p.version), viewer ? { actor: userActor(viewer.user.id) } : undefined);
    const view = await getGraph(buildId, approved.version);
    if (!view) throw new ApiError('NOT_FOUND', 'Build Graph not found');
    return json(view);
});
