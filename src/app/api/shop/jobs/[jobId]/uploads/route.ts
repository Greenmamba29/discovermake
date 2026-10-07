/**
 * POST /api/shop/jobs/:jobId/uploads  QaUploadRequest -> QaUploadResponse (201)
 * Returns a signed PUT target (key `qa/<jobId>/...`); the console then PUTs the photo bytes
 * and passes `key` in milestone / inspection requests. Auth: shop session.
 */
import { JobId } from '@/contracts/common';
import { QaUploadRequest } from '@/contracts/shop';
import { ApiError, json, parseJson, route } from '@/server/http';
import { assertSameOrigin, createQaUpload, requireShop } from '@/server/shops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ jobId: string }>(async (request, { params }) => {
    assertSameOrigin(request);
    const shop = await requireShop(request);
    const id = JobId.safeParse((await params).jobId);
    if (!id.success) throw new ApiError('NOT_FOUND', 'Job not found');
    const body = await parseJson(request, QaUploadRequest);
    return json(await createQaUpload(shop.shopId, id.data, body), { status: 201 });
});
