/**
 * POST /api/admin/sourcing/jobs/:jobId/offers  SubmitOfferInput (without sourcing_request_id / lease_id)
 *   -> SupplierOfferView (201; 200 on an idempotent retry)
 * Sourcing desk fallback: same validation, trust mapping and bounds flags as the MCP tool,
 * actor admin, no lease. Auth: Bearer ADMIN_TOKEN.
 */
import { SourcingJobId } from '@/contracts/common';
import { ADMIN_ACTOR, requireAdmin } from '@/server/auth/admin';
import { ApiError, json, parseJson, route } from '@/server/http';
import { pathId } from '@/server/quote/route-helpers';
import { DeskSubmitOfferRequest } from '@/server/sourcing/desk';
import { listJobOffers, submitOffer } from '@/server/sourcing/offers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ jobId: string }>(async (request, { params }) => {
    requireAdmin(request);
    const jobId = pathId((await params).jobId, SourcingJobId, 'Sourcing job');
    const body = await parseJson(request, DeskSubmitOfferRequest);
    const { offer, duplicate } = await submitOffer({ ...body, sourcing_request_id: jobId }, { kind: 'desk', actor: ADMIN_ACTOR });
    const view = (await listJobOffers(jobId)).find((o) => o.id === offer.id);
    if (!view) throw new ApiError('INTERNAL', 'Offer not found after insert');
    return json(view, { status: duplicate ? 200 : 201 });
});
