/**
 * Supplier-route BINDING quotes.
 *
 * Once ops approves the buyer's selection of a SUPPLIER_CONFIRMED offer (an APPROVED
 * SELECT_SUPPLIER_OFFER approval, offer SELECTED), the buyer can turn it into a BINDING quote:
 * offer landed cost + DiscoverMake margin + risk reserve (./pricing.ts), shipped through an
 * active receiving partner. The quote is an ordinary `quotes` row (shop = the receiving partner,
 * so checkout, freshness and the order pipeline work unchanged) plus a `supplier_quotes` row with
 * its full composition. Buyer views never show the supplier's identity.
 */
import { and, asc, count, desc, eq } from 'drizzle-orm';
import { tierForQuantity, type QuoteView } from '../../contracts/quotes';
import type { SupplierQuoteComposition } from '../../contracts/promise';
import { getDb, withTx } from '../db';
import {
    approvals,
    parts,
    quotes,
    receivingSites,
    shopRateCards,
    shops,
    sourcingJobs,
    supplierLegs,
    supplierOffers,
    supplierQuotes,
    suppliers,
    thicknessOptions,
} from '../db/schema';
import { emitEvent } from '../events/outbox';
import { ApiError } from '../http';
import { newId } from '../ids';
import { computePromise, loadModelIndex } from '../promise/engine';
import { businessDaysBetween } from '../promise/math';
import { buyerActor } from '../quote/parts';
import { getQuoteImpl } from '../quote/quotes';
import { shippingOptions } from '../quote/shipping';
import { currentDesignVersion } from '../sourcing/jobs';
import { primePolicy } from './config';
import { priceSupplierQuote } from './pricing';

export const SUPPLIER_PRICING_VERSION = 'supplier-route-r3.1';

const conflict = (message: string) => new ApiError('CONFLICT', message);

/** The receiving partner used for new supplier quotes: the oldest active site with an active shop and rate card. */
export async function activeReceivingSite(db = getDb()) {
    const [row] = await db
        .select({ site: receivingSites, shop: shops, rateCard: shopRateCards })
        .from(receivingSites)
        .innerJoin(shops, eq(shops.id, receivingSites.shopId))
        .innerJoin(shopRateCards, and(eq(shopRateCards.shopId, shops.id), eq(shopRateCards.active, true)))
        .where(and(eq(receivingSites.active, true), eq(shops.status, 'ACTIVE')))
        .orderBy(asc(receivingSites.createdAt))
        .limit(1);
    return row ?? null;
}

/**
 * Buyer: "Get your binding price" on an approved supplier route. Idempotent: a still-valid
 * BINDING quote for the same offer is returned instead of a new one.
 */
export async function createSupplierBindingQuote(buildId: string, offerId: string, opts: { now?: Date } = {}): Promise<{ quote: QuoteView; created: boolean }> {
    const now = opts.now ?? new Date();
    const db = getDb();
    const [row] = await db
        .select({ offer: supplierOffers, supplier: suppliers, job: sourcingJobs })
        .from(supplierOffers)
        .innerJoin(suppliers, eq(suppliers.id, supplierOffers.supplierId))
        .innerJoin(sourcingJobs, eq(sourcingJobs.id, supplierOffers.jobId))
        .where(and(eq(supplierOffers.id, offerId), eq(supplierOffers.buildId, buildId)));
    if (!row) throw new ApiError('NOT_FOUND', 'Offer not found');
    const { offer, supplier, job } = row;
    if (offer.trustLevel !== 'SUPPLIER_CONFIRMED') throw conflict('Only supplier-confirmed offers can become a binding quote.');
    if (offer.status !== 'SELECTED') throw conflict('Choose this route first; DiscoverMake confirms it before a binding price is made.');
    const [selection] = await db
        .select()
        .from(approvals)
        .where(and(eq(approvals.supplierOfferId, offer.id), eq(approvals.kind, 'SELECT_SUPPLIER_OFFER'), eq(approvals.status, 'APPROVED')))
        .orderBy(desc(approvals.decidedAt))
        .limit(1);
    if (!selection) throw conflict('DiscoverMake has not confirmed this route yet.');
    if (offer.validUntil && offer.validUntil.getTime() <= now.getTime()) throw conflict('This partner offer has expired. Ask partners for a fresh quote.');
    const current = await currentDesignVersion(db, job);
    if (current !== offer.designVersion) throw conflict('Your design changed after this offer was confirmed. Ask partners to quote the current version.');
    if (!job.partId) throw conflict('Supplier-route checkout needs a part file for this build (the receiving inspection plan is made from it).');

    const [part] = await db.select().from(parts).where(eq(parts.id, job.partId));
    if (!part || part.status !== 'READY' || !part.features || part.designVersion !== offer.designVersion) throw conflict('The part is not ready for a binding quote.');
    const [source] = await db
        .select()
        .from(quotes)
        .where(and(eq(quotes.partId, part.id), eq(quotes.designVersion, part.designVersion)))
        .orderBy(desc(quotes.createdAt))
        .limit(1);
    if (!source) throw conflict('Configure the part once (material and thickness) so the binding quote can carry its specification.');

    // Idempotent: reuse a READY, unexpired supplier quote for this offer.
    const [existing] = await db
        .select({ quote: quotes })
        .from(supplierQuotes)
        .innerJoin(quotes, eq(quotes.id, supplierQuotes.quoteId))
        .where(and(eq(supplierQuotes.offerId, offer.id), eq(quotes.status, 'READY')))
        .orderBy(desc(quotes.createdAt))
        .limit(1);
    if (existing && existing.quote.validUntil.getTime() > now.getTime() && existing.quote.rulesetVersion === part.rulesetVersion) {
        const view = await getQuoteImpl(existing.quote.id, now);
        if (view?.orderable) return { quote: view, created: false };
    }

    const site = await activeReceivingSite(db);
    if (!site) throw conflict('No receiving partner is available for supplier freight right now. Our team has been notified.');
    const [{ n: priorLegs }] = await db.select({ n: count() }).from(supplierLegs).where(eq(supplierLegs.supplierId, supplier.id));
    const policy = primePolicy();
    const price = priceSupplierQuote({
        offer: {
            unitPriceCents: offer.unitPriceCents,
            quantity: offer.quantity,
            toolingCents: offer.toolingCents,
            shippingCents: offer.shippingCents,
            incoterm: offer.incoterm,
            productionLeadDays: offer.productionLeadDays,
            shippingLeadDays: offer.shippingLeadDays,
            confidence: offer.confidence,
        },
        supplier: { verified: supplier.verified, country: supplier.country },
        firstOrder: priorLegs === 0,
        receiving: { feeCents: site.site.receivingFeeCents, perUnitCents: site.site.perUnitCents },
        policy,
    });

    const [thk] = await db.select({ mm: thicknessOptions.thicknessMm }).from(thicknessOptions).where(eq(thicknessOptions.id, source.config.thicknessOptionId));
    const summary = { ...source.summary, quantity: offer.quantity };
    // One shipping method on a supplier route: one price, one date.
    // Only the price and transit days are used here; the delivery date is the promise below.
    const standard = shippingOptions({
        shipDate: '2000-01-03',
        unitMassG: source.summary.unitMassG,
        quantity: offer.quantity,
        bboxWidthMm: source.summary.bboxWidthMm,
        bboxHeightMm: source.summary.bboxHeightMm,
        thicknessMm: thk?.mm ?? 1,
    }).find((o) => o.method === 'STANDARD')!;
    const index = await loadModelIndex(db);
    const promise = computePromise({
        quote: { summary, quantity: offer.quantity, leadTimeDays: 1 },
        shop: site.shop,
        option: standard,
        zone: 'Z3',
        now,
        index,
        supplier: { offer, riskScore: price.risk.score, directShip: false },
        materialDays: 0,
    });
    // The binding date is the P90 arrival with the risk buffer: what we can stand behind.
    const shipping = [{ ...standard, deliveryDate: promise.p90Date }];
    const leadTimeDays = Math.max(1, businessDaysBetween(promise.startDate, promise.shipDate));
    const validMs = Math.min(offer.validUntil?.getTime() ?? Infinity, now.getTime() + policy.supplierQuoteValidityDays * 86_400_000);
    const validUntil = new Date(validMs);

    const composition: SupplierQuoteComposition = {
        source: { offerId: offer.id, jobId: job.id, supplierId: supplier.id, selectionApprovalId: selection.id },
        designVersion: offer.designVersion,
        quantity: offer.quantity,
        createdAt: now.toISOString(),
        validUntil: validUntil.toISOString(),
        confidence: offer.confidence,
        supplierStatus: { verified: supplier.verified, country: supplier.country, trustLevel: offer.trustLevel, incoterm: offer.incoterm, firstOrder: priorLegs === 0 },
        landed: { goodsCents: price.goodsCents, toolingCents: price.toolingCents, freightCents: price.freightCents, dutiesCents: price.dutiesCents, totalCents: price.landedCents },
        receivingFeeCents: price.receivingFeeCents,
        marginPct: policy.marginPct,
        marginCents: price.marginCents,
        risk: { score: price.risk.score, tier: price.risk.tier, reservePct: price.risk.reservePct, factors: price.risk.factors },
        riskReserveCents: price.riskReserveCents,
        roundingCents: price.roundingCents,
        subtotalCents: price.subtotalCents,
        unitPriceCents: price.unitPriceCents,
        assumptions: price.assumptions,
        excludedCosts: price.excludedCosts,
    };

    const quoteId = newId('quote');
    await withTx(async (tx) => {
        await tx.insert(quotes).values({
            id: quoteId,
            partId: part.id,
            buildId: part.buildId,
            designVersion: part.designVersion,
            shopId: site.shop.id,
            rateCardId: site.rateCard.id,
            config: { ...source.config, quantity: offer.quantity },
            summary,
            quantity: offer.quantity,
            tier: tierForQuantity(offer.quantity),
            lineItems: price.lineItems,
            ladder: [],
            shippingOptions: shipping,
            dfm: source.dfm,
            unitPriceCents: price.unitPriceCents,
            subtotalCents: price.subtotalCents,
            shopCostCents: price.shopCostCents,
            platformFeeCents: price.platformFeeCents,
            currency: offer.currency,
            trustLevel: 'BINDING',
            status: 'READY',
            shipDate: promise.shipDate,
            leadTimeDays,
            validUntil,
            rulesetVersion: part.rulesetVersion ?? source.rulesetVersion,
            pricingVersion: SUPPLIER_PRICING_VERSION,
            makeabilityScore: source.makeabilityScore,
            createdAt: now,
        });
        await tx.insert(supplierQuotes).values({
            quoteId,
            offerId: offer.id,
            jobId: job.id,
            supplierId: supplier.id,
            selectionApprovalId: selection.id,
            receivingShopId: site.shop.id,
            composition,
            riskScore: price.risk.score,
            depositPct: policy.depositPct,
            createdAt: now,
        });
        const actor = buyerActor(buildId);
        const ctx = { actor, correlationId: buildId, buildId, timestamp: now };
        await emitEvent(tx, {
            type: 'quote.created',
            payload: { quoteId, partId: part.id, quantity: offer.quantity, unitPriceCents: price.unitPriceCents, subtotalCents: price.subtotalCents, trustLevel: 'BINDING', status: 'READY', rulesetVersion: part.rulesetVersion ?? source.rulesetVersion },
            ...ctx,
        });
        await emitEvent(tx, {
            type: 'quote.binding',
            payload: { quoteId, buildId, offerId: offer.id, subtotalCents: price.subtotalCents, riskReserveCents: price.riskReserveCents, riskScore: price.risk.score, depositPct: policy.depositPct, validUntil: validUntil.toISOString() },
            ...ctx,
        });
    });
    const view = await getQuoteImpl(quoteId, now);
    if (!view) throw new Error(`Supplier quote ${quoteId} vanished`);
    return { quote: view, created: true };
}
