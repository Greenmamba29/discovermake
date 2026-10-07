/**
 * POST /api/admin/sourcing/approvals/:approvalId/decision  ApprovalDecisionRequest -> ApprovalView
 * A human decision at the approval boundary. Approving SELECT_SUPPLIER_OFFER selects the
 * offer, rejects the job's other offers and emits `supplier.selected` (no checkout in R2).
 * 409 when already decided differently or the offer can no longer be selected. Auth: Bearer ADMIN_TOKEN.
 */
import { ApprovalId } from '@/contracts/common';
import { ApprovalDecisionRequest } from '@/contracts/sourcing';
import { ADMIN_ACTOR, requireAdmin } from '@/server/auth/admin';
import { json, parseJson, route } from '@/server/http';
import { pathId } from '@/server/quote/route-helpers';
import { decideApproval } from '@/server/sourcing/approvals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ approvalId: string }>(async (request, { params }) => {
    requireAdmin(request);
    const approvalId = pathId((await params).approvalId, ApprovalId, 'Approval');
    const body = await parseJson(request, ApprovalDecisionRequest);
    return json(await decideApproval(approvalId, body, ADMIN_ACTOR));
});
