/**
 * Instant quotes: validate a configuration, run material-specific DFM, price it
 * against every capable ACTIVE shop's active rate card, pick the best route and
 * persist an immutable snapshot. See ./index.ts for the public API.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { QuoteConfig, tierForQuantity, type CreateQuoteRequest, type QuoteLadderRung, type QuoteRoute, type QuoteView } from '../../contracts/quotes';
import type { QuoteStatus, TrustLevel } from '../../contracts/enums';
import type { DfmViolation } from '../../contracts/parts';
import { getDb, withTx, type DbOrTx } from '../db';
import { shopsOfferingAll } from '../shops/services';
import { materials, parts, processes, quotes, shopCapabilities, shopRateCards, shopServices, shops, thicknessOptions } from '../db/schema';
import { emitEvent } from '../events/outbox';
import { ApiError } from '../http';
import { newId } from '../ids';
import { limitWithin, loadActiveRuleset, loadRuleset, loadServices, serviceCompatible, toDfmMaterial, toDfmThickness, type ServiceRow } from './catalog';
import { buildDfmResult, dfmThresholds, fitsWithin, processFitPenalties, runMaterialDfm, type DfmServiceSelection, type SizeLimit } from './dfm';
import { computeLeadTime } from './leadtime';
import { analyzePartImpl, buyerActor, setBuildStatus } from './parts';
import { PRICING_VERSION, priceQuote, PricingError, QUOTE_LADDER_QUANTITIES, type PriceResult, type PricingInput, type PricingService } from './pricing';
import { quoteShippingOptions } from '../shipping/live-rates';

/** Quotes are binding for 14 days. */
export const QUOTE_VALIDITY_DAYS = 14;

type QuoteRow = typeof quotes.$inferSelect;
type ShopRow = typeof shops.$inferSelect;
type RateCardRow = typeof shopRateCards.$inferSelect;
type CapabilityRow = typeof shopCapabilities.$inferSelect;

function validation(message: string, details?: unknown): ApiError {
    return new ApiError('VALIDATION_FAILED', message, 400, details);
}

function toPricingService(s: ServiceRow, featureCount: number | null): PricingService {
    return {
        serviceId: s.id,
        slug: s.slug,
        name: s.name,
        kind: s.kind,
        pricingUnit: s.pricingUnit,
        unitPriceCents: s.unitPriceCents,
        batchSetupCents: s.batchSetupCents,
        minimumCents: s.minimumCents,
        featureCount,
    };
}

function rateCardForPricing(rc: RateCardRow): PricingInput['rateCard'] {
    return {
        fiberLaserCentsPerHour: rc.fiberLaserCentsPerHour,
        co2LaserCentsPerHour: rc.co2LaserCentsPerHour,
        brakeCentsPerBend: rc.brakeCentsPerBend,
        brakeSetupCents: rc.brakeSetupCents,
        orderSetupCents: rc.orderSetupCents,
        partHandlingCents: rc.partHandlingCents,
        finishingCentsPerFt2: rc.finishingCentsPerFt2,
        finishBatchSetupCents: rc.finishBatchSetupCents,
        qaCentsPerPart: rc.qaCentsPerPart,
        packagingBaseCents: rc.packagingBaseCents,
        materialMarkup: rc.materialMarkup,
        platformMarginPct: rc.platformMarginPct,
        minimumOrderCents: rc.minimumOrderCents,
        volumeDiscountMax: rc.volumeDiscountMax,
        serviceOverrides: rc.serviceOverrides ?? {},
    };
}

/** Option values (e.g. `{ thread: "M4" }`) must come from the service's offered lists (`{ threads: [...] }`). */
function validateServiceOptions(s: ServiceRow, options: Record<string, string> | undefined): void {
    for (const [k, v] of Object.entries(options ?? {})) {
        const list = (s.options[k] ?? s.options[`${k}s`]) as unknown;
        if (Array.isArray(list) && !list.includes(v)) throw validation(`${s.name}: "${v}" is not an available ${k}. Choose one of ${list.join(', ')}.`);
    }
    if (s.slug === 'tapping' && !options?.thread) throw validation('Tapping: choose a thread size (options.thread).');
}

type Candidate = { shop: ShopRow; rateCard: RateCardRow; laserCap: CapabilityRow | null; bed: SizeLimit; price: PriceResult; shipDate: string; leadTimeDays: number };

export async function createQuoteImpl(input: CreateQuoteRequest, now: Date = new Date()): Promise<QuoteView> {
    const parsed = QuoteConfig.safeParse(input);
    if (!parsed.success) throw validation('Quote configuration is invalid', parsed.error.flatten());
    const config = parsed.data;
    const db = getDb();

    let [part] = await db.select().from(parts).where(eq(parts.id, config.partId)).limit(1);
    if (!part) throw new ApiError('NOT_FOUND', 'Part not found');
    if (part.status !== 'READY' || !part.features) {
        throw new ApiError('CONFLICT', part.status === 'NEEDS_INPUT' ? 'Choose the drawing units (mm or inches) before quoting.' : `Part is not ready to quote (status ${part.status}).`);
    }
    // A newer DFM rule set is active: re-analyze so the quote and the part agree on the version.
    const active = await loadActiveRuleset(db);
    if (part.rulesetVersion !== active.version) {
        await analyzePartImpl(part.id, { units: part.units ?? undefined });
        [part] = await db.select().from(parts).where(eq(parts.id, config.partId)).limit(1);
        if (part.status !== 'READY' || !part.features) throw new ApiError('CONFLICT', 'Part could not be re-analyzed with the current DFM rules.');
    }
    const features = part.features!;
    const ruleset = await loadRuleset(db, part.rulesetVersion);

    // ---- Catalog validation (ids only; prices never come from the client) ----
    const [material] = await db.select().from(materials).where(eq(materials.id, config.materialId)).limit(1);
    if (!material || !material.active) throw validation('Unknown or inactive material');
    const [thickness] = await db.select().from(thicknessOptions).where(eq(thicknessOptions.id, config.thicknessOptionId)).limit(1);
    if (!thickness || !thickness.active || thickness.materialId !== material.id) throw validation(`Thickness option is not available for ${material.name}`);
    const [process] = await db.select().from(processes).where(eq(processes.id, thickness.processId)).limit(1);
    if (!process || (process.kind !== 'FIBER_LASER' && process.kind !== 'CO2_LASER')) throw validation('Thickness option has no cutting process');

    const serviceIds = config.services.map((s) => s.serviceId);
    if (new Set(serviceIds).size !== serviceIds.length) throw validation('Each service can be selected once');
    const allIds = [...serviceIds, ...(config.finishServiceId ? [config.finishServiceId] : [])];
    const serviceRows = await loadServices(db, allIds);
    const byId = new Map(serviceRows.map((s) => [s.id, s]));

    let finishRow: ServiceRow | null = null;
    if (config.finishServiceId) {
        finishRow = byId.get(config.finishServiceId) ?? null;
        if (!finishRow || !finishRow.active || finishRow.kind !== 'FINISH') throw validation('Unknown finish');
        if (!serviceCompatible(finishRow, material)) throw validation(`${finishRow.name} is not available for ${material.name}`);
    }
    const selected: { row: ServiceRow; featureCount: number | null; options: Record<string, string> }[] = [];
    for (const sel of config.services) {
        const row = byId.get(sel.serviceId);
        if (!row || !row.active || row.kind !== 'SECONDARY_OP') throw validation(`Unknown service ${sel.serviceId}`);
        if (!serviceCompatible(row, material)) throw validation(`${row.name} is not available for ${material.name}`);
        if (row.requiresFeatureCount && sel.featureCount == null) throw validation(`${row.name}: featureCount is required (how many per part)`);
        validateServiceOptions(row, sel.options);
        const featureCount = row.slug === 'bending' ? features.bendCount : row.pricingUnit === 'PER_FEATURE' ? (sel.featureCount ?? null) : null;
        selected.push({ row, featureCount, options: sel.options ?? {} });
    }
    const bendingSelected = selected.some((s) => s.row.slug === 'bending');
    const serviceDays = [...selected.map((s) => s.row.leadTimeDaysAdded), finishRow?.leadTimeDaysAdded ?? 0].reduce((a, b) => a + b, 0);

    const pricingBase: Omit<PricingInput, 'rateCard' | 'quantity'> = {
        geometry: {
            netAreaMm2: features.netAreaMm2,
            bboxWidthMm: features.bboxWidthMm,
            bboxHeightMm: features.bboxHeightMm,
            cutLengthMm: features.cutLengthMm,
            pierceCount: features.pierceCount,
            bendCount: features.bendCount,
        },
        material: {
            densityKgM3: material.densityKgM3,
            priceBasis: material.priceBasis,
            priceCentsPerKg: material.priceCentsPerKg,
            sheetWidthMm: material.sheetWidthMm,
            sheetHeightMm: material.sheetHeightMm,
            scrapPct: material.scrapPct,
        },
        thickness: {
            thicknessMm: thickness.thicknessMm,
            feedRateMmPerMin: thickness.feedRateMmPerMin,
            pierceTimeS: thickness.pierceTimeS,
            kerfMm: thickness.kerfMm,
            sheetPriceCents: thickness.sheetPriceCents,
        },
        processKind: process.kind,
        finish: finishRow ? toPricingService(finishRow, null) : null,
        services: selected.map((s) => toPricingService(s.row, s.featureCount)),
    };

    // ---- Route: every ACTIVE shop with an active rate card + capability that fits ----
    const capRows = await db
        .select({ cap: shopCapabilities, shop: shops, rateCard: shopRateCards })
        .from(shopCapabilities)
        .innerJoin(shops, eq(shops.id, shopCapabilities.shopId))
        .innerJoin(shopRateCards, and(eq(shopRateCards.shopId, shops.id), eq(shopRateCards.active, true)))
        .where(
            and(
                eq(shopCapabilities.thicknessOptionId, thickness.id),
                eq(shopCapabilities.processId, thickness.processId),
                eq(shopCapabilities.active, true),
                eq(shops.status, 'ACTIVE'),
            ),
        );
    let brakeShops: Map<string, CapabilityRow> | null = null;
    if (bendingSelected) {
        const brakeProcessIds = (await db.select({ id: processes.id }).from(processes).where(eq(processes.kind, 'PRESS_BRAKE'))).map((p) => p.id);
        const brakeCaps = brakeProcessIds.length
            ? await db
                  .select()
                  .from(shopCapabilities)
                  .where(and(eq(shopCapabilities.thicknessOptionId, thickness.id), inArray(shopCapabilities.processId, brakeProcessIds), eq(shopCapabilities.active, true)))
            : [];
        brakeShops = new Map(brakeCaps.map((c) => [c.shopId, c]));
    }
    // Finishes + secondary ops: a shop is only routable when it offers every selected service.
    const requiredServiceIds = [...new Set([...selected.map((s) => s.row.id), ...(finishRow ? [finishRow.id] : [])])];
    const serviceShops = await shopsOfferingAll(requiredServiceIds, capRows.map((r) => r.shop.id), db);
    const longestBend = features.bendLines.reduce((m, b) => Math.max(m, b.lengthMm), 0);
    const thicknessLimit: SizeLimit = { widthMm: thickness.maxPartWidthMm, heightMm: thickness.maxPartHeightMm };

    const priceAt = (rateCard: RateCardRow, quantity: number) => priceQuote({ ...pricingBase, rateCard: rateCardForPricing(rateCard), quantity });
    const leadFor = (shop: ShopRow, price: PriceResult) => computeLeadTime({ now, timeZone: shop.timezone, queueDays: shop.queueDays, machineHours: price.machineHours, serviceDays });

    const candidates: Candidate[] = [];
    let fallback: Omit<Candidate, 'price' | 'shipDate' | 'leadTimeDays'> | null = null;
    for (const { cap, shop, rateCard } of capRows) {
        const bed = { widthMm: cap.bedWidthMm, heightMm: cap.bedHeightMm };
        fallback ??= { shop, rateCard, laserCap: cap, bed };
        if (!fitsWithin(features.bboxWidthMm, features.bboxHeightMm, limitWithin(thicknessLimit, bed))) continue;
        if (!serviceShops.has(shop.id)) continue;
        if (brakeShops) {
            const brake = brakeShops.get(shop.id);
            if (!brake || (brake.maxBendLengthMm != null && longestBend > brake.maxBendLengthMm)) continue;
        }
        try {
            const price = priceAt(rateCard, config.quantity);
            const lead = leadFor(shop, price);
            candidates.push({ shop, rateCard, laserCap: cap, bed, price, shipDate: lead.shipDate, leadTimeDays: lead.leadTimeDays });
        } catch (err) {
            if (err instanceof PricingError) continue;
            throw err;
        }
    }
    candidates.sort((a, b) => a.price.subtotalCents - b.price.subtotalCents || a.shipDate.localeCompare(b.shipDate) || a.shop.id.localeCompare(b.shop.id));
    let chosen: Candidate | null = candidates[0] ?? null;
    let routed = Boolean(chosen);
    if (!chosen) {
        // Outside what any partner can run instantly: price on the best available card and send to REVIEW.
        if (!fallback) {
            const [anyShop] = await db
                .select({ shop: shops, rateCard: shopRateCards })
                .from(shops)
                .innerJoin(shopRateCards, and(eq(shopRateCards.shopId, shops.id), eq(shopRateCards.active, true)))
                .where(eq(shops.status, 'ACTIVE'))
                .limit(1);
            if (!anyShop) throw new ApiError('CONFLICT', 'No manufacturing partner is available right now. Please try again later.');
            fallback = { shop: anyShop.shop, rateCard: anyShop.rateCard, laserCap: null, bed: thicknessLimit };
        }
        let price: PriceResult;
        try {
            price = priceAt(fallback.rateCard, config.quantity);
        } catch (err) {
            if (err instanceof PricingError) throw new ApiError('CONFLICT', `This configuration cannot be priced instantly: ${err.message}`);
            throw err;
        }
        const lead = leadFor(fallback.shop, price);
        chosen = { ...fallback, price, shipDate: lead.shipDate, leadTimeDays: lead.leadTimeDays };
        routed = false;
    }

    // ---- Material-specific DFM (geometry findings carried over from analysis) ----
    const sizeLimit = routed ? limitWithin(thicknessLimit, chosen.bed) : thicknessLimit;
    const alternatives = (await db.select().from(thicknessOptions).where(and(eq(thicknessOptions.materialId, material.id), eq(thicknessOptions.active, true)))).map(toDfmThickness);
    const dfmServices: DfmServiceSelection[] = selected.map((s) => ({
        serviceId: s.row.id,
        slug: s.row.slug,
        name: s.row.name,
        pricingUnit: s.row.pricingUnit,
        featureCount: s.featureCount,
        options: s.options,
    }));
    const geometryViolations: DfmViolation[] = (part.dfm?.violations ?? []).filter((v) => v.ruleId !== 'part_size_max');
    const materialViolations = runMaterialDfm(features, {
        ruleset,
        material: toDfmMaterial(material),
        thickness: toDfmThickness(thickness),
        alternatives,
        sizeLimit,
        bendingSelected,
        services: dfmServices,
        preview: part.preview ?? null,
    });
    const dfm = buildDfmResult({
        ruleset,
        violations: [...geometryViolations, ...materialViolations],
        penalties: processFitPenalties(features, dfmThresholds(toDfmMaterial(material), toDfmThickness(thickness), ruleset), sizeLimit),
        materialId: material.id,
        thicknessOptionId: thickness.id,
        checkedAt: now,
    });

    const status: QuoteStatus = dfm.blocking ? 'NEEDS_INPUT' : routed ? 'READY' : 'REVIEW';
    const trustLevel: TrustLevel = status === 'READY' ? 'BINDING' : 'SUPPLIER_ESTIMATE';

    // ---- Ladder (same route + rate card) ----
    const ladderQuantities = [...QUOTE_LADDER_QUANTITIES] as number[];
    const ladderPrices = ladderQuantities.map((q) => (q === config.quantity ? chosen.price : priceAt(chosen.rateCard, q)));
    const unitAtOne = ladderPrices[0].unitPriceCents;
    const ladder: QuoteLadderRung[] = ladderPrices.map((p) => ({
        quantity: p.quantity,
        tier: tierForQuantity(p.quantity),
        unitPriceCents: p.unitPriceCents,
        totalCents: p.subtotalCents,
        shipDate: leadFor(chosen.shop, p).shipDate,
        savingsPct: unitAtOne > 0 ? Math.max(0, Math.min(100, Math.round(((unitAtOne - p.unitPriceCents) / unitAtOne) * 100))) : 0,
    }));

    // R3: live EasyPost rates when configured (15 min cache), else the versioned rate table.
    const shipping = await quoteShippingOptions(
        {
            shipDate: chosen.shipDate,
            unitMassG: chosen.price.unitMassG,
            quantity: config.quantity,
            bboxWidthMm: features.bboxWidthMm,
            bboxHeightMm: features.bboxHeightMm,
            thicknessMm: thickness.thicknessMm,
        },
        { fromZip: chosen.shop.address?.postalCode },
    );

    const summary = {
        materialName: material.name,
        thicknessLabel: thickness.label,
        processName: process.name,
        finishName: finishRow?.name ?? null,
        serviceNames: selected.map((s) => s.row.name),
        quantity: config.quantity,
        partFilename: part.filename,
        bboxWidthMm: features.bboxWidthMm,
        bboxHeightMm: features.bboxHeightMm,
        unitMassG: Math.round(chosen.price.unitMassG * 10) / 10,
    };

    const quoteId = newId('quote');
    const validUntil = new Date(now.getTime() + QUOTE_VALIDITY_DAYS * 24 * 3600 * 1000);
    const partRow = part;
    const finalChoice = chosen;
    const row = await withTx(async (tx) => {
        const [inserted] = await tx
            .insert(quotes)
            .values({
                id: quoteId,
                partId: partRow.id,
                buildId: partRow.buildId,
                designVersion: partRow.designVersion,
                shopId: finalChoice.shop.id,
                rateCardId: finalChoice.rateCard.id,
                config,
                summary,
                quantity: config.quantity,
                tier: tierForQuantity(config.quantity),
                lineItems: finalChoice.price.lineItems,
                ladder,
                shippingOptions: shipping,
                dfm,
                unitPriceCents: finalChoice.price.unitPriceCents,
                subtotalCents: finalChoice.price.subtotalCents,
                shopCostCents: finalChoice.price.shopCostCents,
                platformFeeCents: finalChoice.price.platformFeeCents,
                currency: finalChoice.rateCard.currency || 'usd',
                trustLevel,
                status,
                shipDate: finalChoice.shipDate,
                leadTimeDays: finalChoice.leadTimeDays,
                validUntil,
                rulesetVersion: ruleset.version,
                pricingVersion: PRICING_VERSION,
                makeabilityScore: dfm.makeabilityScore,
                createdAt: now,
            })
            .returning();
        const actor = buyerActor(partRow.buildId);
        await emitEvent(tx, {
            type: 'dfm.completed',
            payload: { partId: partRow.id, quoteId, rulesetVersion: ruleset.version, makeabilityScore: dfm.makeabilityScore, blocking: dfm.blocking, violationCount: dfm.violations.length },
            actor,
            correlationId: partRow.buildId,
            buildId: partRow.buildId,
            timestamp: now,
        });
        await emitEvent(tx, {
            type: 'quote.created',
            payload: {
                quoteId,
                partId: partRow.id,
                quantity: config.quantity,
                unitPriceCents: inserted.unitPriceCents,
                subtotalCents: inserted.subtotalCents,
                trustLevel,
                status,
                rulesetVersion: ruleset.version,
            },
            actor,
            correlationId: partRow.buildId,
            buildId: partRow.buildId,
            timestamp: now,
        });
        await setBuildStatus(tx, partRow.buildId, status === 'READY' ? 'READY' : status === 'REVIEW' ? 'REVIEW' : 'NEEDS_INPUT');
        return inserted;
    });

    const view = toQuoteView(row, {
        part: { designVersion: partRow.designVersion, rulesetVersion: partRow.rulesetVersion },
        route: routeOf(finalChoice.shop, process.name, routed ? finalChoice.laserCap?.machineLabel ?? null : null),
        now,
    });
    const { quoteViewExtras } = await import('../prime/quote-view');
    return { ...view, ...(await quoteViewExtras(row, now)) };
}

function routeOf(shop: ShopRow, processName: string, machineLabel: string | null): QuoteRoute {
    return {
        shopId: shop.id,
        shopName: shop.name,
        city: shop.city,
        region: shop.region,
        rating: shop.rating ?? null,
        processName,
        machineLabel,
        certifications: shop.certifications ?? [],
    };
}

export type QuoteFreshness = { designVersion: number; rulesetVersion: string | null };

/** Orderable iff READY + BINDING + not expired + still matches the part's design and rule-set versions. */
export function isQuoteOrderable(row: Pick<QuoteRow, 'status' | 'trustLevel' | 'validUntil' | 'designVersion' | 'rulesetVersion'>, part: QuoteFreshness, now: Date = new Date()): boolean {
    return (
        row.status === 'READY' &&
        row.trustLevel === 'BINDING' &&
        now.getTime() < row.validUntil.getTime() &&
        row.designVersion === part.designVersion &&
        row.rulesetVersion === part.rulesetVersion
    );
}

export function toQuoteView(row: QuoteRow, ctx: { part: QuoteFreshness; route: QuoteRoute; now?: Date }): QuoteView {
    const now = ctx.now ?? new Date();
    const orderable = isQuoteOrderable(row, ctx.part, now);
    // Past validity, or superseded by a new design / rule-set version: needs a fresh quote.
    const status: QuoteStatus = row.status === 'READY' && !orderable ? 'EXPIRED' : row.status;
    return {
        id: row.id,
        partId: row.partId,
        buildId: row.buildId,
        designVersion: row.designVersion,
        config: row.config,
        summary: row.summary,
        route: ctx.route,
        tier: row.tier,
        lineItems: row.lineItems,
        ladder: row.ladder,
        shippingOptions: row.shippingOptions,
        unitPriceCents: row.unitPriceCents,
        subtotalCents: row.subtotalCents,
        currency: row.currency,
        trustLevel: row.trustLevel,
        status,
        orderable,
        shipDate: row.shipDate,
        leadTimeDays: row.leadTimeDays,
        validUntil: row.validUntil.toISOString(),
        rulesetVersion: row.rulesetVersion,
        pricingVersion: row.pricingVersion,
        dfm: row.dfm,
        createdAt: row.createdAt.toISOString(),
    };
}

export async function getQuoteImpl(id: string, now: Date = new Date()): Promise<QuoteView | null> {
    const db = getDb();
    const [r] = await db
        .select({ quote: quotes, part: { designVersion: parts.designVersion, rulesetVersion: parts.rulesetVersion }, shop: shops })
        .from(quotes)
        .innerJoin(parts, eq(parts.id, quotes.partId))
        .innerJoin(shops, eq(shops.id, quotes.shopId))
        .where(eq(quotes.id, id))
        .limit(1);
    if (!r) return null;
    const [thk] = await db
        .select({ processId: thicknessOptions.processId, processName: processes.name })
        .from(thicknessOptions)
        .innerJoin(processes, eq(processes.id, thicknessOptions.processId))
        .where(eq(thicknessOptions.id, r.quote.config.thicknessOptionId))
        .limit(1);
    let machineLabel: string | null = null;
    if (thk && r.quote.status !== 'REVIEW') {
        const [cap] = await db
            .select({ machineLabel: shopCapabilities.machineLabel })
            .from(shopCapabilities)
            .where(and(eq(shopCapabilities.shopId, r.quote.shopId), eq(shopCapabilities.thicknessOptionId, r.quote.config.thicknessOptionId), eq(shopCapabilities.processId, thk.processId)))
            .limit(1);
        machineLabel = cap?.machineLabel ?? null;
    }
    const view = toQuoteView(r.quote, { part: r.part, route: routeOf(r.shop, thk?.processName ?? r.quote.summary.processName, machineLabel), now });
    // R3: route kind, supplier route summary and the Delivery Promise (dynamic import: no cycle with prime).
    const { quoteViewExtras } = await import('../prime/quote-view');
    return { ...view, ...(await quoteViewExtras(r.quote, now)) };
}

/** READY -> ORDERED inside the caller's (payment) transaction. Idempotent. */
export async function markQuoteOrderedImpl(quoteId: string, tx?: DbOrTx): Promise<void> {
    await withTx(async (t) => {
        const [row] = await t.select({ status: quotes.status }).from(quotes).where(eq(quotes.id, quoteId)).for('update');
        if (!row) throw new ApiError('NOT_FOUND', 'Quote not found');
        if (row.status === 'ORDERED') return;
        if (row.status !== 'READY') throw new ApiError('CONFLICT', `Quote ${quoteId} is ${row.status} and cannot be ordered`);
        await t.update(quotes).set({ status: 'ORDERED' }).where(eq(quotes.id, quoteId));
    }, tx);
}
