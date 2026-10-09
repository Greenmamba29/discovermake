/**
 * Shop stock provider: sheet and hardware already on the shelf at an ACTIVE partner shop
 * (`shop_stock`, edited in the Shop Console). The fastest path: lead 0, and quotes filled from
 * stock get the fastest Delivery Promise (src/server/promise/engine.ts materialDaysFromStock).
 */
import { and, eq, gte, ilike, or } from 'drizzle-orm';
import type { ShopStockView, UpsertShopStockRequest } from '../../../contracts/promise';
import { getDb, type DbOrTx } from '../../db';
import { shopStock, shops, thicknessOptions } from '../../db/schema';
import { ApiError } from '../../http';
import type { ProviderOffer, ProviderRequest, SourcingProvider } from './types';

type StockRow = typeof shopStock.$inferSelect;

function escapeLike(s: string): string {
    return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export class ShopStockProvider implements SourcingProvider {
    readonly name = 'shop_stock';
    readonly mode = 'instant' as const;

    constructor(private readonly db: () => DbOrTx = getDb) {}

    isEnabled(): boolean {
        return true;
    }

    async findOffers(request: ProviderRequest): Promise<ProviderOffer[]> {
        const match = request.thicknessOptionId
            ? eq(shopStock.thicknessOptionId, request.thicknessOptionId)
            : request.sku
              ? eq(shopStock.sku, request.sku)
              : or(ilike(shopStock.description, `%${escapeLike(request.description)}%`), ilike(shopStock.sku, `%${escapeLike(request.description)}%`));
        const rows = await this.db()
            .select({ stock: shopStock, shopName: shops.name })
            .from(shopStock)
            .innerJoin(shops, eq(shops.id, shopStock.shopId))
            .where(and(eq(shops.status, 'ACTIVE'), eq(shopStock.kind, request.kind), gte(shopStock.quantity, 1), match));
        return rows.map(({ stock }) => ({
            provider: this.name,
            source: `shop:${stock.shopId}`,
            sku: stock.sku,
            description: stock.description,
            unitPriceCents: null,
            availableQuantity: stock.quantity,
            leadDays: stock.quantity >= request.quantity ? 0 : 3,
            shopId: stock.shopId,
            url: null,
        }));
    }
}

// ---------------------------------------------------------------------------
// Shop Console: edit stock
// ---------------------------------------------------------------------------

export function toShopStockView(r: StockRow): ShopStockView {
    return {
        id: r.id,
        kind: r.kind,
        sku: r.sku,
        description: r.description,
        materialId: r.materialId,
        thicknessOptionId: r.thicknessOptionId,
        quantity: r.quantity,
        unit: r.unit,
        updatedAt: r.updatedAt.toISOString(),
    };
}

export async function listShopStock(shopId: string): Promise<ShopStockView[]> {
    const rows = await getDb().select().from(shopStock).where(eq(shopStock.shopId, shopId)).orderBy(shopStock.kind, shopStock.sku);
    return rows.map(toShopStockView);
}

/** Create or replace a stock line by SKU (the shop's own). */
export async function upsertShopStock(shopId: string, input: UpsertShopStockRequest): Promise<ShopStockView> {
    const db = getDb();
    let materialId: string | null = null;
    if (input.thicknessOptionId) {
        if (input.kind !== 'SHEET') throw new ApiError('VALIDATION_FAILED', 'Only sheet stock has a thickness option');
        const [thk] = await db.select({ materialId: thicknessOptions.materialId }).from(thicknessOptions).where(eq(thicknessOptions.id, input.thicknessOptionId));
        if (!thk) throw new ApiError('VALIDATION_FAILED', 'Unknown thickness option');
        materialId = thk.materialId;
    }
    const now = new Date();
    const [row] = await db
        .insert(shopStock)
        .values({ shopId, kind: input.kind, sku: input.sku, description: input.description, materialId, thicknessOptionId: input.thicknessOptionId ?? null, quantity: input.quantity, unit: input.unit, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
            target: [shopStock.shopId, shopStock.sku],
            set: { kind: input.kind, description: input.description, materialId, thicknessOptionId: input.thicknessOptionId ?? null, quantity: input.quantity, unit: input.unit, updatedAt: now },
        })
        .returning();
    return toShopStockView(row);
}

export async function updateShopStockQuantity(shopId: string, stockId: string, quantity: number): Promise<ShopStockView> {
    const [row] = await getDb()
        .update(shopStock)
        .set({ quantity, updatedAt: new Date() })
        .where(and(eq(shopStock.id, stockId), eq(shopStock.shopId, shopId)))
        .returning();
    if (!row) throw new ApiError('NOT_FOUND', 'Stock line not found');
    return toShopStockView(row);
}
