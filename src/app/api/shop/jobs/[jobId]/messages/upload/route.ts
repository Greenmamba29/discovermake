/** POST /api/shop/jobs/:jobId/messages/upload  ImageUploadRequest -> ImageUploadResponse (shop chat photo). */
import { ImageUploadRequest, type ImageUploadResponse } from '@/contracts/prime';
import { chatPrefix } from '@/server/chat';
import { json, parseJson, route } from '@/server/http';
import { createImageUpload } from '@/server/r3/images';
import { requireShopJobOrder } from '@/server/r3/shop-access';
import { assertSameOrigin, requireShop } from '@/server/shops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ jobId: string }>(async (request, { params }) => {
    assertSameOrigin(request);
    const shop = await requireShop(request);
    const { order } = await requireShopJobOrder(shop.shopId, (await params).jobId);
    const body = await parseJson(request, ImageUploadRequest);
    return json<ImageUploadResponse>(await createImageUpload(chatPrefix(order.id), body), { status: 201 });
});
