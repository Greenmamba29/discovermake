/**
 * POST /api/me/cart/items/:itemId/upsell  ApplyUpsellRequest -> CartView
 * The client names the upsell kind only; the item moves to the quote engine's upsell quote.
 */
import { ApplyUpsellRequest, type CartView } from '@/contracts/prime';
import { assertSameOrigin } from '@/server/auth/viewer';
import { applyUpsellToItem, getCartView } from '@/server/cart/cart';
import { resolveCartOwner } from '@/server/cart/owner';
import { json, parseJson, route } from '@/server/http';
import { assertNotKidMode } from '@/server/kids/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ itemId: string }>(async (request, { params }) => {
    await assertNotKidMode(request);
    assertSameOrigin(request);
    const body = await parseJson(request, ApplyUpsellRequest);
    const { owner } = await resolveCartOwner(request);
    await applyUpsellToItem(owner, (await params).itemId, body.kind);
    return json<CartView>(await getCartView(owner));
});
