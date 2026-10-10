/**
 * POST /api/me/cart/checkout  CartCheckoutRequest -> CartCheckoutResponse (201)
 * One payment (card, or "Pay by invoice" for business buyers) for every part in the cart:
 * one order per part, one payment group. Server-priced from the quote snapshots.
 */
import { CartCheckoutRequest, type CartCheckoutResponse } from '@/contracts/prime';
import { assertSameOrigin } from '@/server/auth/viewer';
import { findOpenCart, loadCartLines } from '@/server/cart/cart';
import { checkoutQuotes } from '@/server/cart/checkout';
import { resolveCartOwner } from '@/server/cart/owner';
import { ApiError, json, parseJson, route } from '@/server/http';
import { getMembershipForBenefits } from '@/server/prime/membership';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request) => {
    assertSameOrigin(request);
    const body = await parseJson(request, CartCheckoutRequest);
    const { owner } = await resolveCartOwner(request);
    const cart = await findOpenCart(owner);
    const lines = cart ? await loadCartLines(cart.id) : [];
    if (!cart || !lines.length) throw new ApiError('CONFLICT', 'Your cart is empty.');
    const result = await checkoutQuotes({
        quoteIds: lines.map((l) => l.quote.id),
        cartId: cart.id,
        userId: owner.userId,
        deviceHash: owner.deviceHash,
        membership: await getMembershipForBenefits(owner.userId),
        shippingMethod: body.shippingMethod,
        buyer: body.buyer,
        shippingAddress: body.shippingAddress,
        notes: body.notes,
        payment: body.payment,
    });
    return json<CartCheckoutResponse>(result, { status: 201 });
});
