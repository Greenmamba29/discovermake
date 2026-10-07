/**
 * POST /api/admin/sourcing/jobs/:jobId/suppliers  SubmitSupplierInput (without sourcing_request_id / lease_id)
 *   -> { supplierId, created } (201 when created, 200 when de-duplicated)
 * Sourcing desk fallback: same validation as the MCP tool, actor admin, no lease. Auth: Bearer ADMIN_TOKEN.
 */
import { SourcingJobId } from '@/contracts/common';
import { ADMIN_ACTOR, requireAdmin } from '@/server/auth/admin';
import { json, parseJson, route } from '@/server/http';
import { pathId } from '@/server/quote/route-helpers';
import { DeskSubmitSupplierRequest } from '@/server/sourcing/desk';
import { submitSupplier } from '@/server/sourcing/suppliers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ jobId: string }>(async (request, { params }) => {
    requireAdmin(request);
    const jobId = pathId((await params).jobId, SourcingJobId, 'Sourcing job');
    const body = await parseJson(request, DeskSubmitSupplierRequest);
    const { supplier, created } = await submitSupplier({ ...body, sourcing_request_id: jobId }, { kind: 'desk', actor: ADMIN_ACTOR });
    return json({ supplierId: supplier.id, created }, { status: created ? 201 : 200 });
});
