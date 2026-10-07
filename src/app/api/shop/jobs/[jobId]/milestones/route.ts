/** POST /api/shop/jobs/:jobId/milestones  MilestoneRequest -> MilestoneView (201). Auth: shop session. */
import { JobId } from '@/contracts/common';
import { MilestoneRequest } from '@/contracts/shop';
import { ApiError, json, parseJson, route } from '@/server/http';
import { assertSameOrigin, recordMilestone, requireShop } from '@/server/shops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ jobId: string }>(async (request, { params }) => {
    assertSameOrigin(request);
    const shop = await requireShop(request);
    const id = JobId.safeParse((await params).jobId);
    if (!id.success) throw new ApiError('NOT_FOUND', 'Job not found');
    const body = await parseJson(request, MilestoneRequest);
    return json(await recordMilestone(shop.shopId, id.data, body), { status: 201 });
});
