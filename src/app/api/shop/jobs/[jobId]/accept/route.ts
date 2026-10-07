/** POST /api/shop/jobs/:jobId/accept -> ShopJobDetail (DISPATCHED -> ACCEPTED). Auth: shop session. */
import { JobId } from '@/contracts/common';
import { ApiError, json, route } from '@/server/http';
import { acceptJob, assertSameOrigin, requireShop } from '@/server/shops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ jobId: string }>(async (request, { params }) => {
    assertSameOrigin(request);
    const shop = await requireShop(request);
    const id = JobId.safeParse((await params).jobId);
    if (!id.success) throw new ApiError('NOT_FOUND', 'Job not found');
    return json(await acceptJob(shop.shopId, id.data));
});
