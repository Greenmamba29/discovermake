/**
 * Manufacturing Route comparison (GET /api/builds/:buildId/routes?quote=): partner shops from the
 * dispatch matcher and supplier offers on the build, scored by ./compare.ts. Buyer-safe: suppliers
 * appear only as "Verified partner · <country>".
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { RouteComparisonView } from '../../contracts/promise';
import { getDb } from '../db';
import { parts, processes, quotes, receivingSites, shopRateCards, shops, supplierOffers, supplierQuotes, suppliers, thicknessOptions } from '../db/schema';
import { findCandidates, type JobRequirements } from '../dispatch/match';
import { SERVICE_IDS } from '../dispatch/inspection-plan';
import { ApiError } from '../http';
import { primePolicy } from '../prime/config';
import { priceSupplierQuote } from '../prime/pricing';
import { computePromise, loadModelIndex, materialDaysFromStock } from '../promise/engine';
import { bufferDays, predictLegs, promiseDates } from '../promise/math';
import { resolveSlips } from '../promise/training';
import { orderStartDate } from '../quote/leadtime';
import { routeOfferLabel } from '../sourcing/views';
import { estimateCo2Kg, materialFactor, ROUTE_WEIGHTS, scoreRoutes, type RouteCandidateInput } from './compare';

const UNRATED_QUALITY = 0.8;

export async function compareRoutes(buildId: string, quoteId: string, opts: { now?: Date } = {}): Promise<RouteComparisonView> {
    const now = opts.now ?? new Date();
    const db = getDb();
    const [quote] = await db.select().from(quotes).where(and(eq(quotes.id, quoteId), eq(quotes.buildId, buildId)));
    if (!quote) throw new ApiError('NOT_FOUND', 'Quote not found');
    const [part] = await db.select().from(parts).where(eq(parts.id, quote.partId));
    const [thk] = await db
        .select({ thk: thicknessOptions, processKind: processes.kind, processName: processes.name })
        .from(thicknessOptions)
        .innerJoin(processes, eq(processes.id, thicknessOptions.processId))
        .where(eq(thicknessOptions.id, quote.config.thicknessOptionId));
    const [quotedShop] = await db.select().from(shops).where(eq(shops.id, quote.shopId));
    const index = await loadModelIndex(db);
    const standard = quote.shippingOptions.find((o) => o.method === 'STANDARD') ?? quote.shippingOptions[0];
    const massKg = (quote.summary.unitMassG * quote.quantity) / 1000;
    const candidates: RouteCandidateInput[] = [];
    const [isSupplierQuote] = await db.select({ id: supplierQuotes.quoteId }).from(supplierQuotes).where(eq(supplierQuotes.quoteId, quote.id));

    // ---- Partner shops (dispatch matcher), priced on their own rate card; only the quoted one is binding.
    if (!isSupplierQuote && part?.features && thk && quotedShop) {
        const f = part.features;
        const serviceIds = [...quote.config.services.map((s) => s.serviceId), ...(quote.config.finishServiceId ? [quote.config.finishServiceId] : [])];
        const bending = quote.config.services.some((s) => s.serviceId === SERVICE_IDS.bending) && f.bendCount > 0;
        const req: JobRequirements = {
            thicknessOptionId: thk.thk.id,
            processId: thk.thk.processId,
            processKind: thk.processKind,
            bboxWidthMm: f.bboxWidthMm,
            bboxHeightMm: f.bboxHeightMm,
            cutLengthMm: f.cutLengthMm,
            pierceCount: f.pierceCount,
            netAreaMm2: f.netAreaMm2,
            feedRateMmPerMin: thk.thk.feedRateMmPerMin,
            pierceTimeS: thk.thk.pierceTimeS,
            quantity: quote.quantity,
            bending: bending ? { bendCount: f.bendCount, longestBendMm: Math.max(0, ...f.bendLines.map((b) => b.lengthMm)) } : null,
            finished: Boolean(quote.config.finishServiceId),
            requiredServiceIds: [...new Set(serviceIds)],
            quotedShopId: quote.shopId,
        };
        const matched = await findCandidates(db, req, []);
        const processOnly = Math.max(0, quote.leadTimeDays - Math.round(quotedShop.queueDays) - 1);
        for (const c of matched.slice(0, 5)) {
            const quoted = c.shop.id === quote.shopId;
            const stock = await materialDaysFromStock(db, c.shop.id, quote);
            const legs = predictLegs(
                { materialArrivalDays: [stock.days], shopQueueDays: c.shop.queueDays, processDays: processOnly, qaDays: 1, packDays: 0, transitDays: standard.transitDays },
                resolveSlips(index, { shopId: c.shop.id, process: quote.summary.processName, carrierService: standard.method, zone: 'Z3' }),
            );
            const arrivesBy = promiseDates({ startDate: orderStartDate(now, c.shop.timezone), legs, bufferDays: bufferDays(c.shop.rating == null ? 0.15 : c.shop.rating < 4 ? 0.25 : 0) }).promiseDate;
            const total = quoted ? quote.subtotalCents : Math.round(c.estimatedCostCents * (1 + c.rateCard.platformMarginPct));
            candidates.push({
                id: `shop:${c.shop.id}`,
                kind: 'shop',
                label: c.shop.name,
                location: `${c.shop.city}, ${c.shop.region}`,
                trustLevel: quoted ? quote.trustLevel : 'SUPPLIER_ESTIMATE',
                totalCents: total,
                unitCents: Math.ceil(total / quote.quantity),
                quantity: quote.quantity,
                arrivesBy,
                quality: c.shop.rating != null ? Math.max(0, Math.min(1, c.shop.rating / 5)) : UNRATED_QUALITY,
                rating: c.shop.rating,
                verified: true,
                co2Kg: estimateCo2Kg({ massKg, materialName: quote.summary.materialName, originCountry: 'US' }),
                filledFromStock: stock.fromStock,
                capabilities: [thk.processName, ...(c.capability.machineLabel ? [c.capability.machineLabel] : [])],
                certifications: c.shop.certifications ?? [],
                orderable: quoted && quote.trustLevel === 'BINDING' && quote.status === 'READY' && quote.validUntil.getTime() > now.getTime(),
            });
        }
    }

    // ---- Supplier offers on this build (buyer-safe), priced as a binding supplier quote would be.
    const offerRows = await db
        .select({ offer: supplierOffers, supplier: suppliers })
        .from(supplierOffers)
        .innerJoin(suppliers, eq(suppliers.id, supplierOffers.supplierId))
        .where(and(eq(supplierOffers.buildId, buildId), inArray(supplierOffers.status, ['ACTIVE', 'SELECTED'])))
        .orderBy(desc(supplierOffers.createdAt))
        .limit(10);
    if (offerRows.length && quotedShop) {
        const [site] = await db
            .select({ site: receivingSites, shop: shops })
            .from(receivingSites)
            .innerJoin(shops, eq(shops.id, receivingSites.shopId))
            .innerJoin(shopRateCards, and(eq(shopRateCards.shopId, shops.id), eq(shopRateCards.active, true)))
            .where(eq(receivingSites.active, true))
            .limit(1);
        const policy = primePolicy();
        for (const { offer, supplier } of offerRows) {
            const [binding] = await db
                .select({ quote: quotes })
                .from(supplierQuotes)
                .innerJoin(quotes, eq(quotes.id, supplierQuotes.quoteId))
                .where(and(eq(supplierQuotes.offerId, offer.id), eq(quotes.status, 'READY')))
                .orderBy(desc(quotes.createdAt))
                .limit(1);
            const price = priceSupplierQuote({
                offer: { ...offer },
                supplier: { verified: supplier.verified, country: supplier.country },
                firstOrder: true,
                receiving: site ? { feeCents: site.site.receivingFeeCents, perUnitCents: site.site.perUnitCents } : null,
                policy,
            });
            const shop = site?.shop ?? quotedShop;
            const promise = computePromise({
                quote: { summary: quote.summary, quantity: offer.quantity, leadTimeDays: 1 },
                shop,
                option: standard,
                zone: 'Z3',
                now,
                index,
                supplier: { offer, riskScore: price.risk.score, directShip: !site },
                materialDays: 0,
            });
            const total = binding ? binding.quote.subtotalCents : price.subtotalCents;
            candidates.push({
                id: `offer:${offer.id}`,
                kind: 'supplier',
                label: routeOfferLabel(supplier),
                location: supplier.country,
                trustLevel: binding ? 'BINDING' : offer.trustLevel,
                totalCents: total,
                unitCents: Math.ceil(total / offer.quantity),
                quantity: offer.quantity,
                arrivesBy: binding ? (binding.quote.shippingOptions[0]?.deliveryDate ?? promise.p90Date) : promise.p90Date,
                quality: Math.round(((supplier.verified ? 0.6 : 0.2) + 0.4 * offer.confidence) * 100) / 100,
                rating: null,
                verified: supplier.verified,
                co2Kg: estimateCo2Kg({ massKg: (quote.summary.unitMassG * offer.quantity) / 1000, materialName: offer.material, originCountry: supplier.country }),
                filledFromStock: false,
                capabilities: offer.processes,
                certifications: offer.certificationsClaimed,
                orderable: Boolean(binding),
            });
        }
    }

    const scored = scoreRoutes(candidates);
    const quoted = scored.find((c) => c.id === `shop:${quote.shopId}`);
    const steps: RouteComparisonView['processes'] = isSupplierQuote
        ? [
              { step: 'Made by a verified partner', detail: `${quote.summary.materialName} · ${quote.summary.processName}` },
              { step: 'Freight and customs', detail: 'Consolidated freight to our US receiving partner, duties cleared' },
              { step: 'QA at receipt', detail: 'Count, finish and critical dimensions checked against your inspection plan' },
              { step: 'Ships to you', detail: standard.label },
          ]
        : [
              { step: 'Material', detail: `${quote.summary.materialName}, ${quote.summary.thicknessLabel}${quoted?.filledFromStock ? ' · in stock at the shop' : ''}` },
              { step: 'Cutting', detail: quote.summary.processName },
              ...quote.summary.serviceNames.map((n) => ({ step: 'Operation', detail: n })),
              ...(quote.summary.finishName ? [{ step: 'Finish', detail: quote.summary.finishName }] : []),
              { step: 'Inspection', detail: 'Inspection plan from your design: critical dimensions, holes, finish' },
              { step: 'Ships to you', detail: standard.label },
          ];
    return {
        quoteId,
        candidates: scored,
        recommendedId: scored.find((c) => c.recommended)?.id ?? null,
        weights: { ...ROUTE_WEIGHTS },
        processes: steps,
        impact: {
            materialKgCo2e: Math.round(massKg * materialFactor(quote.summary.materialName) * 10) / 10,
            method: 'Estimate: part mass x a typical cradle-to-gate factor for the material, plus truck and ocean freight per tonne-km. Not a certified footprint.',
        },
    };
}
