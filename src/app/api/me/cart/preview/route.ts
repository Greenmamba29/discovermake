/**
 * POST /api/me/cart/preview  CartPreviewRequest -> CheckoutPreviewResponse
 * Server totals for the whole cart (sum of the quotes + Prime benefits). Display only:
 * checkout re-prices everything.
 */
import { CartPreviewRequest, type CheckoutPreviewResponse } from '@/contracts/prime';
import { previewCart } from '@/server/cart/preview';
import { resolveCartOwner } from '@/server/cart/owner';
import { json, parseJson, route } from '@/server/http';
import { assertNotKidMode } from '@/server/kids/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request) => {
    await assertNotKidMode(request);
    const body = await parseJson(request, CartPreviewRequest);
    const { owner } = await resolveCartOwner(request);
    return json<CheckoutPreviewResponse>(await previewCart(owner, body.shippingMethod));
});
