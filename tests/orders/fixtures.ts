/**
 * Fixtures for orders suites: a READY + BINDING quote snapshot built directly in
 * the test database (the quote engine is exercised by tests/quote).
 */
import { eq } from 'drizzle-orm';
import { vi } from 'vitest';
import type { CheckoutRequest } from '@/contracts/checkout';
import type { Db } from '@/server/db';
import { DEV_RATE_CARD_ID, DEV_SHOP_ID, R1_RULESET_VERSION } from '@/server/db/seed';
import { builds, parts, quotes } from '@/server/db/schema';
import { newBuildDisplayId } from '@/server/ids';

export type QuoteFixtureOptions = {
    quantity?: number;
    unitPriceCents?: number;
    validUntil?: Date;
    status?: (typeof quotes.$inferInsert)['status'];
    trustLevel?: (typeof quotes.$inferInsert)['trustLevel'];
    lineItemsOffsetCents?: number;
};

export async function createQuoteFixture(db: Db, opts: QuoteFixtureOptions = {}) {
    const quantity = opts.quantity ?? 10;
    const unit = opts.unitPriceCents ?? 500;
    const subtotal = unit * quantity;
    const fee = Math.round(subtotal * 0.26);
    const shopCost = subtotal - fee;
    const material = Math.round(shopCost * 0.4);
    const [build] = await db.insert(builds).values({ displayId: newBuildDisplayId(), name: 'Mounting bracket' }).returning();
    const [part] = await db
        .insert(parts)
        .values({ buildId: build.id, fileKey: `parts/${build.id}/source.dxf`, filename: 'bracket.dxf', sizeBytes: 2048, status: 'READY', units: 'mm', designVersion: 1, rulesetVersion: R1_RULESET_VERSION })
        .returning();
    const [quote] = await db
        .insert(quotes)
        .values({
            partId: part.id,
            buildId: build.id,
            designVersion: 1,
            shopId: DEV_SHOP_ID,
            rateCardId: DEV_RATE_CARD_ID,
            config: { partId: part.id, materialId: 'mat_al_5052', thicknessOptionId: 'thk_al5052_063', finishServiceId: null, services: [], quantity },
            summary: {
                materialName: '5052 Aluminum',
                thicknessLabel: '0.063"',
                processName: 'Fiber laser',
                finishName: null,
                serviceNames: [],
                quantity,
                partFilename: 'bracket.dxf',
                bboxWidthMm: 80,
                bboxHeightMm: 40,
                unitMassG: 14,
            },
            quantity,
            tier: quantity < 10 ? 'PROTOTYPE' : quantity < 250 ? 'SMALL_BATCH' : 'PRODUCTION_RUN',
            lineItems: [
                { code: 'MATERIAL', label: 'Material', explainer: 'Sheet stock.', unitCents: Math.round(material / quantity), quantity, totalCents: material },
                { code: 'CUTTING', label: 'Cutting', explainer: 'Laser time.', unitCents: Math.round((shopCost - material) / quantity), quantity, totalCents: shopCost - material + (opts.lineItemsOffsetCents ?? 0) },
                { code: 'PLATFORM_FEE', label: 'Platform fee', explainer: 'DiscoverMake.', unitCents: fee, quantity: 1, totalCents: fee },
            ],
            ladder: [],
            shippingOptions: [
                { method: 'STANDARD', label: 'Standard (UPS Ground)', priceCents: 1500, deliveryDate: '2026-10-16', transitDays: 4 },
                { method: 'EXPEDITED', label: 'Expedited (UPS 2nd Day Air)', priceCents: 2900, deliveryDate: '2026-10-14', transitDays: 2 },
            ],
            dfm: { rulesetVersion: R1_RULESET_VERSION, makeabilityScore: 96, blocking: false, violations: [], materialId: 'mat_al_5052', thicknessOptionId: 'thk_al5052_063', checkedAt: new Date().toISOString() },
            unitPriceCents: unit,
            subtotalCents: subtotal,
            shopCostCents: shopCost,
            platformFeeCents: fee,
            trustLevel: opts.trustLevel ?? 'BINDING',
            status: opts.status ?? 'READY',
            shipDate: '2026-10-12',
            leadTimeDays: 4,
            validUntil: opts.validUntil ?? new Date(Date.now() + 7 * 86400_000),
            rulesetVersion: R1_RULESET_VERSION,
            pricingVersion: 'test-pricing',
            makeabilityScore: 96,
        })
        .returning();
    return { build, part, quote };
}

export function checkoutBody(quoteId: string, overrides: Partial<CheckoutRequest> = {}): CheckoutRequest {
    return {
        quoteId,
        shippingMethod: 'STANDARD',
        buyer: { email: 'maker@example.com', name: 'Ada Maker' },
        shippingAddress: { name: 'Ada Maker', line1: '100 Market St', city: 'Philadelphia', region: 'PA', postalCode: '19106', country: 'US' },
        acceptTerms: true,
        ...overrides,
    };
}

export async function getQuoteRow(db: Db, quoteId: string) {
    const [q] = await db.select().from(quotes).where(eq(quotes.id, quoteId));
    return q;
}

/** Silence console noise from the console notify adapter, returning the spy. */
export function quietConsole() {
    return {
        info: vi.spyOn(console, 'info').mockImplementation(() => {}),
        error: vi.spyOn(console, 'error').mockImplementation(() => {}),
        warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    };
}
