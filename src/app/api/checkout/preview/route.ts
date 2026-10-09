/**
 * POST /api/checkout/preview  CheckoutPreviewRequest -> CheckoutPreviewResponse
 * Server totals for one quote + shipping method, with Prime benefits for signed-in members and
 * the "Prime members ship this free" offer for everyone else. Display only.
 */
import { CheckoutPreviewRequest, type CheckoutPreviewResponse } from '@/contracts/prime';
import { getViewer } from '@/server/auth/viewer';
import { previewQuote } from '@/server/cart/preview';
import { json, parseJson, route } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request) => {
    const body = await parseJson(request, CheckoutPreviewRequest);
    const viewer = await getViewer(request);
    return json<CheckoutPreviewResponse>(await previewQuote(body.quoteId, body.shippingMethod, viewer?.user.id ?? null));
});
