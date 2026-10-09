/**
 * Print quotes (R6): price a printed part against every capable partner and persist the SAME
 * immutable `quotes` snapshot the R1 engine writes, so checkout, orders, dispatch, payouts and
 * the passport work unchanged. The differences are data, not new paths:
 *
 *   quotes.config.process = 'print'      the discriminator (absent = sheet / laser quote)
 *   quotes.config.materialId             a print material (`mat_print_*`)
 *   quotes.config.thicknessOptionId      the layer profile (`thk_print_*`, print catalog only)
 *   quotes.rate_card_id                  the shop's commercial card of record (FK, checkout checks it)
 *   print_quote_details                  what it was priced from: print rate card, capability,
 *                                        manifest geometry, the buyer's caliper dimensions (QA)
 *
 * BINDING only when (a) an ACTIVE partner with an active `3D_PRINT` capability for the material,
 * an active print rate card and an active shop rate card has a printer whose build volume fits
 * the part's bounding box, and (b) print DFM passes (every wall >= 1.2 mm). A part no printer
 * fits is priced on the best card and goes to REVIEW (SUPPLIER_ESTIMATE); blocking DFM gives
 * NEEDS_INPUT. Never below cost: see ./pricing.ts.
 */
import { and, eq } from 'drizzle-orm';
import type { QuoteStatus, TrustLevel } from '../../../contracts/enums';
import { tierForQuantity, type QuoteConfig, type QuoteLadderRung, type QuoteRoute, type QuoteView } from '../../../contracts/quotes';
import { getDb, withTx, type DbOrTx } from '../../db';
import { parts, printMaterials, printQuoteDetails, quotes, shopPrintCapabilities, shopPrintRateCards, shopRateCards, shops } from '../../db/schema';
import { emitEvent } from '../../events/outbox';
import { ApiError } from '../../http';
import { newId } from '../../ids';
import { computeLeadTime, PRODUCTIVE_HOURS_PER_DAY } from '../leadtime';
import { buyerActor, setBuildStatus } from '../parts';
import { QUOTE_VALIDITY_DAYS, toQuoteView } from '../quotes';
import { shippingOptions } from '../shipping';
import { PRINT_PROFILES } from './catalog';
import { PRINT_DFM_VERSION, runPrintDfm } from './dfm';
import { fitsBuildVolume, PRINT_LADDER_QUANTITIES, PRINT_PRICING_VERSION, pricePrint, PrintPricingError, type PrintGeometry, type PrintMaterialPricing, type PrintPriceResult, type PrintProcess, type PrintRateCardPricing } from './pricing';

type ShopRow = typeof shops.$inferSelect;
type PrintCardRow = typeof shopPrintRateCards.$inferSelect;
type CapRow = typeof shopPrintCapabilities.$inferSelect;
type MaterialRow = typeof printMaterials.$inferSelect;

export type CriticalDim = { param: string; label: string; nominalMm: number };

export type CreatePrintQuoteInput = {
    /** A READY printed part (format 'stl') whose bytes are the worker's STL. */
    partId: string;
    printMaterialSlug: string;
    quantity: number;
    geometry: PrintGeometry;
    family: string;
    stlSha256: string;
    /** The buyer's confirmed caliper dimensions: they become the shop's QA checks. */
    criticalDims: CriticalDim[];
    notes?: string[];
};

export function isPrintQuoteConfig(config: Pick<QuoteConfig, 'process'> | null | undefined): boolean {
    return config?.process === 'print';
}

export function toPrintRateCard(rc: PrintCardRow): PrintRateCardPricing {
    return {
        fdmCentsPerHour: rc.fdmCentsPerHour,
        fdmMm3PerHour: rc.fdmMm3PerHour,
        fdmLayerHeightMm: rc.fdmLayerHeightMm,
        fdmLayerSeconds: rc.fdmLayerSeconds,
        slsCentsPerHour: rc.slsCentsPerHour,
        slsMm3PerHour: rc.slsMm3PerHour,
        slsLayerHeightMm: rc.slsLayerHeightMm,
        slsLayerSeconds: rc.slsLayerSeconds,
        shellMm: rc.shellMm,
        infillPct: rc.infillPct,
        orderSetupCents: rc.orderSetupCents,
        postProcessCentsPerPart: rc.postProcessCentsPerPart,
        qaCentsPerPart: rc.qaCentsPerPart,
        partHandlingCents: rc.partHandlingCents,
        packagingBaseCents: rc.packagingBaseCents,
        materialMarkup: rc.materialMarkup,
        materialWastePct: rc.materialWastePct,
        platformMarginPct: rc.platformMarginPct,
        minMarginPct: rc.minMarginPct,
        volumeDiscountMax: rc.volumeDiscountMax,
        minimumOrderCents: rc.minimumOrderCents,
        printerHoursPerDay: rc.printerHoursPerDay,
    };
}

export function toPrintMaterial(m: MaterialRow): PrintMaterialPricing {
    return { name: m.name, process: m.process === 'SLS' ? 'SLS' : 'FDM', densityKgM3: m.densityKgM3, priceCentsPerKg: m.priceCentsPerKg, minWallMm: m.minWallMm, maxBridgeMm: m.maxBridgeMm };
}

/** Printer hours expressed in the R1 lead-time model's machine hours (6 productive h/day vs unattended printers). */
export function leadMachineHours(printHours: number, rc: Pick<PrintRateCardPricing, 'printerHoursPerDay'>, printerCount: number): number {
    return (printHours / Math.max(1, printerCount)) * (PRODUCTIVE_HOURS_PER_DAY / Math.max(1, rc.printerHoursPerDay));
}

type Candidate = { shop: ShopRow; card: PrintCardRow; shopRateCardId: string; cap: CapRow | null; price: PrintPriceResult; shipDate: string; leadTimeDays: number };

export function printRouteOf(shop: Pick<ShopRow, 'id' | 'name' | 'city' | 'region' | 'rating' | 'certifications'>, processName: string, machineLabel: string | null): QuoteRoute {
    return { shopId: shop.id, shopName: shop.name, city: shop.city, region: shop.region, rating: shop.rating ?? null, processName, machineLabel, certifications: shop.certifications ?? [] };
}

export async function createPrintQuote(input: CreatePrintQuoteInput, now: Date = new Date()): Promise<QuoteView> {
    const db = getDb();
    if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 100) throw new ApiError('VALIDATION_FAILED', 'Printed parts quote 1 to 100 pieces.', 400);
    const [part] = await db.select().from(parts).where(eq(parts.id, input.partId)).limit(1);
    if (!part) throw new ApiError('NOT_FOUND', 'Part not found');
    if (part.status !== 'READY' || part.format !== 'stl') throw new ApiError('CONFLICT', 'This part is not a printable STL ready to quote.');
    const [material] = await db
        .select()
        .from(printMaterials)
        .where(and(eq(printMaterials.slug, input.printMaterialSlug), eq(printMaterials.active, true)));
    if (!material) throw new ApiError('VALIDATION_FAILED', 'Unknown or inactive print material', 400);
    const m = toPrintMaterial(material);
    const process: PrintProcess = m.process;
    const profile = PRINT_PROFILES[process];
    const g = input.geometry;

    // ---- Route: ACTIVE shops with an active 3D_PRINT capability for this material + both rate cards ----
    const rows = await db
        .select({ cap: shopPrintCapabilities, shop: shops, card: shopPrintRateCards, shopCard: shopRateCards.id })
        .from(shopPrintCapabilities)
        .innerJoin(shops, eq(shops.id, shopPrintCapabilities.shopId))
        .innerJoin(shopPrintRateCards, and(eq(shopPrintRateCards.shopId, shops.id), eq(shopPrintRateCards.active, true)))
        .innerJoin(shopRateCards, and(eq(shopRateCards.shopId, shops.id), eq(shopRateCards.active, true)))
        .where(and(eq(shopPrintCapabilities.printMaterialId, material.id), eq(shopPrintCapabilities.active, true), eq(shopPrintCapabilities.capability, '3D_PRINT'), eq(shops.status, 'ACTIVE')));

    const priceOn = (card: PrintCardRow, q: number) => pricePrint({ geometry: g, material: m, rateCard: toPrintRateCard(card), quantity: q });
    const leadFor = (shop: ShopRow, card: PrintCardRow, cap: CapRow | null, price: PrintPriceResult) =>
        computeLeadTime({ now, timeZone: shop.timezone, queueDays: shop.queueDays, machineHours: leadMachineHours(price.machineHours, card, cap?.printerCount ?? 1), serviceDays: 0 });

    const candidates: Candidate[] = [];
    for (const r of rows) {
        if (!fitsBuildVolume(g.bboxMm, r.cap)) continue;
        try {
            const price = priceOn(r.card, input.quantity);
            const lead = leadFor(r.shop, r.card, r.cap, price);
            candidates.push({ shop: r.shop, card: r.card, shopRateCardId: r.shopCard, cap: r.cap, price, shipDate: lead.shipDate, leadTimeDays: lead.leadTimeDays });
        } catch (err) {
            if (err instanceof PrintPricingError) continue;
            throw err;
        }
    }
    candidates.sort((a, b) => a.price.subtotalCents - b.price.subtotalCents || a.shipDate.localeCompare(b.shipDate) || a.shop.id.localeCompare(b.shop.id));
    let chosen: Candidate | null = candidates[0] ?? null;
    const routed = Boolean(chosen);
    if (!chosen) {
        // No printer fits (or nobody has the capability): price on the best available card, REVIEW.
        const [any] = rows.length
            ? [{ shop: rows[0]!.shop, card: rows[0]!.card, shopCard: rows[0]!.shopCard }]
            : await db
                  .select({ shop: shops, card: shopPrintRateCards, shopCard: shopRateCards.id })
                  .from(shopPrintRateCards)
                  .innerJoin(shops, eq(shops.id, shopPrintRateCards.shopId))
                  .innerJoin(shopRateCards, and(eq(shopRateCards.shopId, shops.id), eq(shopRateCards.active, true)))
                  .where(and(eq(shopPrintRateCards.active, true), eq(shops.status, 'ACTIVE')))
                  .limit(1);
        if (!any) throw new ApiError('CONFLICT', 'No 3D printing partner is available right now. Please try again later.');
        let price: PrintPriceResult;
        try {
            price = priceOn(any.card, input.quantity);
        } catch (err) {
            if (err instanceof PrintPricingError) throw new ApiError('CONFLICT', `This part cannot be priced instantly: ${err.message}`);
            throw err;
        }
        const lead = leadFor(any.shop, any.card, null, price);
        chosen = { shop: any.shop, card: any.card, shopRateCardId: any.shopCard, cap: null, price, shipDate: lead.shipDate, leadTimeDays: lead.leadTimeDays };
    }

    const dfm = runPrintDfm({ geometry: g, material: m, fits: routed, checkedAt: now, materialId: material.id, profileId: profile.id });
    const status: QuoteStatus = dfm.blocking ? 'NEEDS_INPUT' : routed ? 'READY' : 'REVIEW';
    const trustLevel: TrustLevel = status === 'READY' ? 'BINDING' : 'SUPPLIER_ESTIMATE';

    const final = chosen;
    const ladderPrices = PRINT_LADDER_QUANTITIES.map((q) => (q === input.quantity ? final.price : priceOn(final.card, q)));
    const unitAtOne = ladderPrices[0]!.unitPriceCents;
    const ladder: QuoteLadderRung[] = ladderPrices.map((p) => ({
        quantity: p.quantity,
        tier: tierForQuantity(p.quantity),
        unitPriceCents: p.unitPriceCents,
        totalCents: p.subtotalCents,
        shipDate: leadFor(final.shop, final.card, final.cap, p).shipDate,
        savingsPct: unitAtOne > 0 ? Math.max(0, Math.min(100, Math.round(((unitAtOne - p.unitPriceCents) / unitAtOne) * 100))) : 0,
    }));
    const [bx, by, bz] = g.bboxMm;
    const shipping = shippingOptions({ shipDate: final.shipDate, unitMassG: final.price.unitMassG, quantity: input.quantity, bboxWidthMm: Math.max(bx, by), bboxHeightMm: Math.min(bx, by), thicknessMm: bz });

    const config: QuoteConfig = { partId: part.id, materialId: material.id, thicknessOptionId: profile.id, finishServiceId: null, services: [], quantity: input.quantity, process: 'print' };
    const summary = {
        materialName: material.name,
        thicknessLabel: profile.label,
        processName: profile.processName,
        finishName: null,
        serviceNames: [] as string[],
        quantity: input.quantity,
        partFilename: part.filename,
        bboxWidthMm: Math.max(bx, by),
        bboxHeightMm: Math.min(bx, by),
        unitMassG: Math.round(final.price.unitMassG * 10) / 10,
    };

    const quoteId = newId('quote');
    const validUntil = new Date(now.getTime() + QUOTE_VALIDITY_DAYS * 24 * 3600 * 1000);
    const row = await withTx(async (tx) => {
        const [inserted] = await tx
            .insert(quotes)
            .values({
                id: quoteId,
                partId: part.id,
                buildId: part.buildId,
                designVersion: part.designVersion,
                shopId: final.shop.id,
                rateCardId: final.shopRateCardId,
                config,
                summary,
                quantity: input.quantity,
                tier: tierForQuantity(input.quantity),
                lineItems: final.price.lineItems,
                ladder,
                shippingOptions: shipping,
                dfm,
                unitPriceCents: final.price.unitPriceCents,
                subtotalCents: final.price.subtotalCents,
                shopCostCents: final.price.shopCostCents,
                platformFeeCents: final.price.platformFeeCents,
                currency: final.card.currency || 'usd',
                trustLevel,
                status,
                shipDate: final.shipDate,
                leadTimeDays: final.leadTimeDays,
                validUntil,
                rulesetVersion: PRINT_DFM_VERSION,
                pricingVersion: PRINT_PRICING_VERSION,
                makeabilityScore: dfm.makeabilityScore,
                createdAt: now,
            })
            .returning();
        await tx.insert(printQuoteDetails).values({
            quoteId,
            partId: part.id,
            buildId: part.buildId,
            printMaterialId: material.id,
            printRateCardId: final.card.id,
            capabilityId: final.cap?.id ?? null,
            process,
            family: input.family,
            geometry: { ...g, effectiveVolumeMm3: Math.round(final.price.effectiveVolumeMm3 * 10) / 10, layers: final.price.layers },
            criticalDims: input.criticalDims,
            stlSha256: input.stlSha256,
            layerHeightMm: final.price.layerHeightMm,
            printHoursPerPart: Math.round(final.price.printHoursPerPart * 1000) / 1000,
            unitMassG: Math.round(final.price.unitMassG * 10) / 10,
            notes: input.notes ?? [],
            createdAt: now,
        });
        const actor = buyerActor(part.buildId);
        await emitEvent(tx, {
            type: 'dfm.completed',
            payload: { partId: part.id, quoteId, rulesetVersion: PRINT_DFM_VERSION, makeabilityScore: dfm.makeabilityScore, blocking: dfm.blocking, violationCount: dfm.violations.length },
            actor,
            correlationId: part.buildId,
            buildId: part.buildId,
            timestamp: now,
        });
        await emitEvent(tx, {
            type: 'quote.created',
            payload: { quoteId, partId: part.id, quantity: input.quantity, unitPriceCents: inserted!.unitPriceCents, subtotalCents: inserted!.subtotalCents, trustLevel, status, rulesetVersion: PRINT_DFM_VERSION },
            actor,
            correlationId: part.buildId,
            buildId: part.buildId,
            timestamp: now,
        });
        await setBuildStatus(tx, part.buildId, status === 'READY' ? 'READY' : status === 'REVIEW' ? 'REVIEW' : 'NEEDS_INPUT');
        return inserted!;
    });

    const view = toQuoteView(row, { part: { designVersion: part.designVersion, rulesetVersion: part.rulesetVersion }, route: printRouteOf(final.shop, profile.processName, routed ? (final.cap?.machineLabel ?? null) : null), now });
    const { quoteViewExtras } = await import('../../prime/quote-view');
    return { ...view, ...(await quoteViewExtras(row, now)) };
}

/** The print details of a quote (null for sheet quotes). */
export async function loadPrintQuoteDetails(quoteId: string, db: DbOrTx = getDb()) {
    const [row] = await db.select().from(printQuoteDetails).where(eq(printQuoteDetails.quoteId, quoteId));
    return row ?? null;
}

/** Machine label for a print quote's route (GET /api/quotes/:id). */
export async function printMachineLabel(quoteId: string): Promise<string | null> {
    const db = getDb();
    const [row] = await db
        .select({ label: shopPrintCapabilities.machineLabel })
        .from(printQuoteDetails)
        .innerJoin(shopPrintCapabilities, eq(shopPrintCapabilities.id, printQuoteDetails.capabilityId))
        .where(eq(printQuoteDetails.quoteId, quoteId));
    return row?.label ?? null;
}
