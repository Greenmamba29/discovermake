/** PATCH /api/shop/stock/:stockId  UpdateShopStockRequest -> ShopStockView. Auth: shop session (own stock only). */
import { ShopStockId, UpdateShopStockRequest } from '@/contracts/promise';
import { json, parseJson, route } from '@/server/http';
import { pathId } from '@/server/quote/route-helpers';
import { assertSameOrigin, requireShop } from '@/server/shops';
import { updateShopStockQuantity } from '@/server/sourcing/providers/shop-stock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PATCH = route<{ stockId: string }>(async (request, { params }) => {
    assertSameOrigin(request);
    const shop = await requireShop(request);
    const stockId = pathId((await params).stockId, ShopStockId, 'Stock line');
    const body = await parseJson(request, UpdateShopStockRequest);
    return json(await updateShopStockQuantity(shop.shopId, stockId, body.quantity));
});
