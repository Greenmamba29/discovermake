/**
 * POST /api/shop/jobs/:jobId/receive  ReceiveFreightRequest -> ShopJobDetail
 * Receiving job (R3): the partner marks inbound supplier freight received; production (QA at
 * receipt) starts and the supplier leg moves to RECEIVED_AT_PARTNER. Auth: shop session.
 */
import { JobId } from '@/contracts/common';
import { ReceiveFreightRequest } from '@/contracts/promise';
import { ApiError, json, parseJson, route } from '@/server/http';
import { receiveFreight } from '@/server/prime/fulfilment';
import { assertSameOrigin, requireShop } from '@/server/shops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ jobId: string }>(async (request, { params }) => {
    assertSameOrigin(request);
    const shop = await requireShop(request);
    const id = JobId.safeParse((await params).jobId);
    if (!id.success) throw new ApiError('NOT_FOUND', 'Job not found');
    const body = await parseJson(request, ReceiveFreightRequest);
    return json(await receiveFreight(shop.shopId, id.data, body));
});
