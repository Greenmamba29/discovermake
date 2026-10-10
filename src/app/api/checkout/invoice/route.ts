/**
 * POST /api/checkout/invoice  InvoiceCheckoutRequest -> CartCheckoutResponse (201)
 * "Pay by invoice (ACH / wire)" for business buyers: the order is created PENDING_PAYMENT and
 * production starts only when the invoice is paid.
 */
import { InvoiceCheckoutRequest, type CartCheckoutResponse } from '@/contracts/prime';
import { assertSameOrigin, getDeviceHash, getViewer } from '@/server/auth/viewer';
import { checkoutQuotes } from '@/server/cart/checkout';
import { json, parseJson, route } from '@/server/http';
import { getMembershipForBenefits } from '@/server/prime/membership';
import { assertNotKidMode } from '@/server/kids/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request) => {
    await assertNotKidMode(request);
    assertSameOrigin(request);
    const body = await parseJson(request, InvoiceCheckoutRequest);
    const viewer = await getViewer(request);
    const userId = viewer?.user.id ?? null;
    const result = await checkoutQuotes({
        quoteIds: [body.quoteId],
        cartId: null,
        userId,
        deviceHash: getDeviceHash(request),
        membership: await getMembershipForBenefits(userId),
        shippingMethod: body.shippingMethod,
        buyer: body.buyer,
        shippingAddress: body.shippingAddress,
        notes: body.notes,
        payment: { mode: 'invoice', netDays: body.netDays, poNumber: body.poNumber },
    });
    return json<CartCheckoutResponse>(result, { status: 201 });
});
