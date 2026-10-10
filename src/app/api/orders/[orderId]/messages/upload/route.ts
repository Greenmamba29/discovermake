/**
 * POST /api/orders/:orderId/messages/upload  ImageUploadRequest -> ImageUploadResponse
 * Signed PUT for a chat photo (PNG / JPEG / WebP, 8 MB). Verified again when posted.
 */
import { ImageUploadRequest, type ImageUploadResponse } from '@/contracts/prime';
import { assertSameOrigin } from '@/server/auth/viewer';
import { chatPrefix } from '@/server/chat';
import { json, parseJson, route } from '@/server/http';
import { createImageUpload } from '@/server/r3/images';
import { requireBuyerOrder } from '@/server/r3/order-access';
import { assertNotKidMode } from '@/server/kids/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ orderId: string }>(async (request, { params }) => {
    await assertNotKidMode(request);
    assertSameOrigin(request);
    const { order } = await requireBuyerOrder(request, (await params).orderId);
    const body = await parseJson(request, ImageUploadRequest);
    return json<ImageUploadResponse>(await createImageUpload(chatPrefix(order.id), body), { status: 201 });
});
