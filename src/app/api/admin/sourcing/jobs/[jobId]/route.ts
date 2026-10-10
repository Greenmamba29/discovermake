/**
 * GET /api/admin/sourcing/jobs/:jobId -> { job: SourcingJobView, offers: SupplierOfferView[], approvals: ApprovalView[], negotiations, documents }
 * Offers include the supplier identity (ops only). Auth: Bearer ADMIN_TOKEN.
 */
import { SourcingJobId } from '@/contracts/common';
import { requireAdmin } from '@/server/auth/admin';
import { ApiError, json, route } from '@/server/http';
import { pathId } from '@/server/quote/route-helpers';
import { getSourcingJobDetail } from '@/server/sourcing/desk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route<{ jobId: string }>(async (request, { params }) => {
    await requireAdmin(request);
    const jobId = pathId((await params).jobId, SourcingJobId, 'Sourcing job');
    const detail = await getSourcingJobDetail(jobId);
    if (!detail) throw new ApiError('NOT_FOUND', 'Sourcing job not found');
    return json(detail);
});
