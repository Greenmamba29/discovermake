/**
 * POST /api/orders/:orderId/rating/upload  ImageUploadRequest -> ImageUploadResponse
 * Signed PUT for the "show what you made" photo (delivered orders only).
 */
import { ImageUploadRequest, type ImageUploadResponse } from '@/contracts/prime';
import { assertSameOrigin } from '@/server/auth/viewer';
import { ApiError, json, parseJson, route } from '@/server/http';
import { createImageUpload } from '@/server/r3/images';
import { requireBuyerOrder } from '@/server/r3/order-access';
import { RATEABLE_STATUSES, ugcPrefix } from '@/server/ratings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ orderId: string }>(async (request, { params }) => {
    assertSameOrigin(request);
    const { order } = await requireBuyerOrder(request, (await params).orderId);
    if (!RATEABLE_STATUSES.has(order.status)) throw new ApiError('CONFLICT', 'You can add a photo once the order is delivered.');
    const body = await parseJson(request, ImageUploadRequest);
    return json<ImageUploadResponse>(await createImageUpload(ugcPrefix(order.id), body), { status: 201 });
});
