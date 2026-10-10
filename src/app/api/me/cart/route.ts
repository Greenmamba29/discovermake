/**
 * GET /api/me/cart -> CartView. Signed in: the user's cart (this device's guest cart is merged
 * into it first). Signed out: this device's cart (dm_device).
 */
import type { CartView } from '@/contracts/prime';
import { getCartView } from '@/server/cart/cart';
import { resolveCartOwner } from '@/server/cart/owner';
import { json, route } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
    const { owner } = await resolveCartOwner(request);
    return json<CartView>(await getCartView(owner));
});
