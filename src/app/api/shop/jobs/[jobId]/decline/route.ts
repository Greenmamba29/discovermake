/** POST /api/shop/jobs/:jobId/decline  DeclineJobRequest -> ShopJobDetail (order re-dispatched). Auth: shop session. */
import { JobId } from '@/contracts/common';
import { DeclineJobRequest } from '@/contracts/shop';
import { ApiError, json, parseJson, route } from '@/server/http';
import { assertSameOrigin, declineJob, requireShop } from '@/server/shops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ jobId: string }>(async (request, { params }) => {
    assertSameOrigin(request);
    const shop = await requireShop(request);
    const id = JobId.safeParse((await params).jobId);
    if (!id.success) throw new ApiError('NOT_FOUND', 'Job not found');
    const body = await parseJson(request, DeclineJobRequest);
    return json(await declineJob(shop.shopId, id.data, body));
});
