/**
 * Sourcing providers: partner shop stock (DB + Shop Console API), stock making the promise
 * fastest, the catalog distributor disabled and never called without keys, the Mouser response
 * parser, the deterministic fixture distributor, and route comparison over real rows.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RouteComparisonView } from '@/contracts/promise';
import { DEV_SHOP_ID } from '@/server/db/seed';
import { quotes, shopStock } from '@/server/db/schema';
import { resetEnvCache } from '@/server/env';
import { materialDaysFromStock, SHEET_RESTOCK_DAYS } from '@/server/promise/engine';
import {
    AccioProvider,
    CatalogDistributorProvider,
    FixtureDistributor,
    findInstantOffers,
    MouserDistributor,
    parseMouserResponse,
    ShopStockProvider,
    upsertShopStock,
    updateShopStockQuantity,
} from '@/server/sourcing/providers';
import { GET as routesRoute } from '@/app/api/builds/[buildId]/routes/route';
import { createQuoteFixture } from '../shop/fixtures';
import { params, quietConsole, req } from '../sourcing/fixtures';
import { useTestDb } from '../support/db';
import { approvedOffer } from './fixtures';

describe('sourcing providers', () => {
    const ctx = useTestDb({ seed: true });
    beforeAll(() => quietConsole());
    afterAll(() => {
        delete process.env.MOUSER_API_KEY;
        resetEnvCache();
    });

    it('shop stock: seeded sheet and hardware answer instantly with lead 0 at the partner', async () => {
        const provider = new ShopStockProvider();
        const sheet = await provider.findOffers({ kind: 'SHEET', description: 'aluminum', thicknessOptionId: 'thk_al5052_063', quantity: 4 });
        expect(sheet).toEqual([expect.objectContaining({ provider: 'shop_stock', source: `shop:${DEV_SHOP_ID}`, leadDays: 0, shopId: DEV_SHOP_ID })]);
        const pem = await provider.findOffers({ kind: 'HARDWARE', description: 'self-clinching', quantity: 100 });
        expect(pem[0]).toMatchObject({ sku: 'PEM-S-M4-1', leadDays: 0 });
        const short = await provider.findOffers({ kind: 'HARDWARE', description: 'self-clinching', quantity: 100_000 });
        expect(short[0].leadDays).toBeGreaterThan(0);
    });

    it('stock edits: upsert by SKU, own shop only, and quotes filled from stock get the fastest material leg', async () => {
        const line = await upsertShopStock(DEV_SHOP_ID, { kind: 'SHEET', sku: 'AL5052-080-TEST', description: '5052 .080 test sheet', thicknessOptionId: 'thk_al5052_080', quantity: 0, unit: 'sheet' });
        expect(line).toMatchObject({ materialId: 'mat_al_5052', quantity: 0 });
        await expect(updateShopStockQuantity('shop_other', line.id, 5)).rejects.toMatchObject({ code: 'NOT_FOUND' });

        const { quote } = await createQuoteFixture(ctx.db, { quantity: 10 });
        const [row] = await ctx.db.select().from(quotes).where(eq(quotes.id, quote.id));
        // Seeded 60 sheets of .063: enough, from stock.
        expect(await materialDaysFromStock(ctx.db, DEV_SHOP_ID, row)).toEqual({ days: 0, fromStock: true, tracked: true });
        await ctx.db.update(shopStock).set({ quantity: 0 }).where(eq(shopStock.id, 'sst_ppw_al5052_063'));
        expect(await materialDaysFromStock(ctx.db, DEV_SHOP_ID, row)).toEqual({ days: SHEET_RESTOCK_DAYS, fromStock: false, tracked: true });
        await ctx.db.update(shopStock).set({ quantity: 60 }).where(eq(shopStock.id, 'sst_ppw_al5052_063'));
        // A shop that does not track a thickness keeps the R1 assumption (stocked catalog sheet).
        expect(await materialDaysFromStock(ctx.db, 'shop_untracked', row)).toEqual({ days: 0, fromStock: false, tracked: false });
    });

    it('catalog distributor: disabled and never called without MOUSER_API_KEY', async () => {
        delete process.env.MOUSER_API_KEY;
        resetEnvCache();
        const fetchSpy = vi.fn();
        const provider = new CatalogDistributorProvider(new MouserDistributor({ fetch: fetchSpy }));
        expect(provider.isEnabled()).toBe(false);
        expect(await provider.findOffers({ kind: 'HARDWARE', description: 'M4 nut', quantity: 10 })).toEqual([]);
        const all = await findInstantOffers({ kind: 'HARDWARE', description: 'self-clinching', quantity: 10 }, [new ShopStockProvider(), provider, new AccioProvider()]);
        expect(all.map((o) => o.provider)).toEqual(['shop_stock']);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('catalog distributor: configured, it calls the Mouser keyword search and normalizes parts', async () => {
        const fetchSpy = vi.fn(async (url: string, init: { body: string }) => {
            expect(url).toBe('https://api.mouser.com/api/v1/search/keyword?apiKey=test-key');
            expect(JSON.parse(init.body).SearchByKeywordRequest).toMatchObject({ keyword: 'M4 PEM nut', records: 10, searchOptions: 'InStock' });
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    Errors: [],
                    SearchResults: {
                        NumberOfResult: 1,
                        Parts: [
                            {
                                MouserPartNumber: '534-4705',
                                ManufacturerPartNumber: 'S-M4-1ZI',
                                Description: 'Self-clinching nut M4',
                                AvailabilityInStock: '12000',
                                LeadTime: '35 Days',
                                PriceBreaks: [
                                    { Quantity: 1, Price: '$0.42', Currency: 'USD' },
                                    { Quantity: 100, Price: '$0.21', Currency: 'USD' },
                                ],
                                ProductDetailUrl: 'https://www.mouser.com/ProductDetail/534-4705',
                            },
                        ],
                    },
                }),
            };
        });
        const provider = new CatalogDistributorProvider(new MouserDistributor({ apiKey: 'test-key', fetch: fetchSpy }));
        expect(provider.isEnabled()).toBe(true);
        const offers = await provider.findOffers({ kind: 'HARDWARE', description: 'M4 PEM nut', quantity: 250 });
        expect(offers).toEqual([expect.objectContaining({ provider: 'mouser', sku: '534-4705', unitPriceCents: 21, availableQuantity: 12000, leadDays: 3 })]);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(parseMouserResponse({ SearchResults: { Parts: [{ MouserPartNumber: 'x', AvailabilityInStock: '0', LeadTime: '20 Days' }] } }, { kind: 'HARDWARE', description: 'x', quantity: 5 })[0].leadDays).toBe(23);
        expect(() => parseMouserResponse({ Errors: [{ Message: 'Invalid unique identifier.' }] }, { kind: 'HARDWARE', description: 'x', quantity: 1 })).toThrow(/Invalid unique identifier/);
    });

    it('fixture distributor (tests only) is deterministic', async () => {
        const provider = new CatalogDistributorProvider(new FixtureDistributor());
        const a = await provider.findOffers({ kind: 'HARDWARE', description: 'M4', quantity: 100 });
        expect(a.map((o) => o.sku)).toEqual(['FIX-PEM-M4', 'FIX-SCREW-M4X10']);
        expect(await provider.findOffers({ kind: 'HARDWARE', description: 'M4', quantity: 100 })).toEqual(a);
        const ranked = await findInstantOffers({ kind: 'HARDWARE', description: 'M4', quantity: 100 }, [provider, new ShopStockProvider()]);
        expect(ranked[0].provider).toBe('shop_stock'); // on the shelf beats 2-day delivery
    });

    it('route comparison over real rows: shop + supplier offer, one Recommended, no supplier identity', async () => {
        const a = await approvedOffer(ctx.db);
        const res = await routesRoute(req(`/api/builds/${a.build.id}/routes?quote=${a.quote.id}`), params({ buildId: a.build.id }));
        expect(res.status).toBe(200);
        const view = RouteComparisonView.parse(await res.json());
        expect(view.candidates.map((c) => c.kind).sort()).toEqual(['shop', 'supplier']);
        expect(view.candidates.filter((c) => c.recommended)).toHaveLength(1);
        expect(view.recommendedId).toBe(view.candidates.find((c) => c.recommended)!.id);
        const supplier = view.candidates.find((c) => c.kind === 'supplier')!;
        expect(supplier.label).toBe('Verified partner · Vietnam');
        expect(JSON.stringify(view)).not.toContain('Da Nang');
        expect(view.candidates.find((c) => c.kind === 'shop')).toMatchObject({ filledFromStock: true, orderable: true, trustLevel: 'BINDING' });
        expect(view.processes.length).toBeGreaterThan(2);
        expect(view.impact.materialKgCo2e).toBeGreaterThan(0);
        // Same inputs, same answer.
        const again = RouteComparisonView.parse(await (await routesRoute(req(`/api/builds/${a.build.id}/routes?quote=${a.quote.id}`), params({ buildId: a.build.id }))).json());
        expect(again.candidates.map((c) => [c.id, c.score, c.recommended])).toEqual(view.candidates.map((c) => [c.id, c.score, c.recommended]));
    });
});
