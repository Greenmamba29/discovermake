/**
 * GET /api/shop/flags -> ShopJobFlagsResponse
 * Per order of this shop's jobs: Prime priority (order_benefits) and unread buyer messages.
 */
import type { ShopJobFlagsResponse } from '@/contracts/prime';
import { json, route } from '@/server/http';
import { shopJobFlags } from '@/server/r3/shop-access';
import { requireShop } from '@/server/shops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
    const shop = await requireShop(request);
    return json<ShopJobFlagsResponse>(await shopJobFlags(shop.shopId));
});
