/**
 * POST /api/me/cart/items  AddCartItemRequest -> CartView (201)
 * Adds a BINDING quote (one item per part; a newer quote replaces the older one). `upsell`
 * adds the engine-priced upsell quote instead. Guests get a device cookie when they have none.
 */
import { AddCartItemRequest, type CartView } from '@/contracts/prime';
import { assertSameOrigin } from '@/server/auth/viewer';
import { addCartItem, getCartView } from '@/server/cart/cart';
import { resolveCartOwner } from '@/server/cart/owner';
import { json, parseJson, route } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request) => {
    assertSameOrigin(request);
    const body = await parseJson(request, AddCartItemRequest);
    const { owner, apply } = await resolveCartOwner(request, { mint: true });
    await addCartItem(owner, body.quoteId, body.upsell);
    const res = json<CartView>(await getCartView(owner), { status: 201 });
    apply(res);
    return res;
});
