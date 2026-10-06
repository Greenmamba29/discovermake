/**
 * POST /api/shop/jobs/:jobId/shipment  CreateShipmentRequest -> ShipmentView (201)
 * Requires the order to be QA_PASSED (409 otherwise). CARRIER=easypost buys the label;
 * CARRIER=manual (dev/test only) records what the shop entered. Auth: shop session.
 */
import { JobId } from '@/contracts/common';
import { CreateShipmentRequest } from '@/contracts/shipments';
import { ApiError, json, parseJson, route } from '@/server/http';
import { assertSameOrigin, createShipment, requireShop } from '@/server/shops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ jobId: string }>(async (request, { params }) => {
    assertSameOrigin(request);
    const shop = await requireShop(request);
    const id = JobId.safeParse((await params).jobId);
    if (!id.success) throw new ApiError('NOT_FOUND', 'Job not found');
    const body = await parseJson(request, CreateShipmentRequest);
    return json(await createShipment(shop.shopId, id.data, body), { status: 201 });
});
