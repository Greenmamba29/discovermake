/**
 * GET /api/shop/payouts/status -> ShopPayoutStatusResponse
 * Auth: shop session. Live Stripe Connect flags for the calling shop (retrieved on every
 * call, never cached), or { connected: false } before onboarding has started.
 * 503 "Stripe is not configured" without STRIPE_SECRET_KEY.
 */
import type { ShopPayoutStatusResponse } from '@/contracts/connect';
import { json, route } from '@/server/http';
import { requireShop } from '@/server/shops';
import { getShopPayoutStatus } from '@/server/shops/connect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
    const shop = await requireShop(request);
    return json<ShopPayoutStatusResponse>(await getShopPayoutStatus(shop.shopId));
});
