/**
 * GET /api/shop/jobs/:jobId -> ShopJobDetail
 * Auth: shop session; another shop's job answers 404. The packet is redacted until the
 * job is accepted; afterwards it carries a freshly signed, short-lived DXF download URL.
 */
import { JobId } from '@/contracts/common';
import { ApiError, json, route } from '@/server/http';
import { getJob, requireShop } from '@/server/shops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route<{ jobId: string }>(async (request, { params }) => {
    const shop = await requireShop(request);
    const id = JobId.safeParse((await params).jobId);
    if (!id.success) throw new ApiError('NOT_FOUND', 'Job not found');
    const job = await getJob(shop.shopId, id.data);
    if (!job) throw new ApiError('NOT_FOUND', 'Job not found');
    return json(job, { headers: { 'referrer-policy': 'no-referrer' } });
});
