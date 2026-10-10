/** DELETE /api/me/cart/items/:itemId -> CartView */
import type { CartView } from '@/contracts/prime';
import { assertSameOrigin } from '@/server/auth/viewer';
import { getCartView, removeCartItem } from '@/server/cart/cart';
import { resolveCartOwner } from '@/server/cart/owner';
import { json, route } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const DELETE = route<{ itemId: string }>(async (request, { params }) => {
    assertSameOrigin(request);
    const { owner } = await resolveCartOwner(request);
    await removeCartItem(owner, (await params).itemId);
    return json<CartView>(await getCartView(owner));
});
