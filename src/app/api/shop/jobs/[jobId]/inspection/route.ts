/**
 * POST /api/shop/jobs/:jobId/inspection  InspectionSubmitRequest -> InspectionResultView (201)
 * The server computes PASS/FAIL from the plan; FAIL opens a rework job automatically. Auth: shop session.
 */
import { JobId } from '@/contracts/common';
import { InspectionSubmitRequest } from '@/contracts/shop';
import { ApiError, json, parseJson, route } from '@/server/http';
import { assertSameOrigin, requireShop, submitInspection } from '@/server/shops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ jobId: string }>(async (request, { params }) => {
    assertSameOrigin(request);
    const shop = await requireShop(request);
    const id = JobId.safeParse((await params).jobId);
    if (!id.success) throw new ApiError('NOT_FOUND', 'Job not found');
    const body = await parseJson(request, InspectionSubmitRequest);
    return json(await submitInspection(shop.shopId, id.data, body), { status: 201 });
});
