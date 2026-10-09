/**
 * GET  /api/shop/stock                          -> { stock: ShopStockView[] }
 * POST /api/shop/stock  UpsertShopStockRequest  -> ShopStockView (create or replace by SKU)
 * The calling shop's inventory (shop stock sourcing provider). Auth: shop session.
 */
import type { ShopStockView } from '@/contracts/promise';
import { UpsertShopStockRequest } from '@/contracts/promise';
import { json, parseJson, route } from '@/server/http';
import { assertSameOrigin, requireShop } from '@/server/shops';
import { listShopStock, upsertShopStock } from '@/server/sourcing/providers/shop-stock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
    const shop = await requireShop(request);
    return json<{ stock: ShopStockView[] }>({ stock: await listShopStock(shop.shopId) });
});

export const POST = route(async (request) => {
    assertSameOrigin(request);
    const shop = await requireShop(request);
    const body = await parseJson(request, UpsertShopStockRequest);
    return json(await upsertShopStock(shop.shopId, body), { status: 201 });
});
