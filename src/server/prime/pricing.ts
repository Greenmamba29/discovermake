/**
 * Supplier-route pricing (pure, no I/O): a supplier-confirmed offer becomes a BINDING quote.
 *
 *   landed     = unit x qty + tooling + freight + duties          (offer, converted to cents)
 *   receiving  = partner receiving fee + per-unit handling          (0 for direct ship)
 *   margin     = ceil(marginPct x landed)
 *   reserve    = ceil(reservePct(risk tier) x landed)
 *   unit price = ceil((landed + receiving + margin + reserve) / qty);  subtotal = unit x qty
 *
 * Rounding is always UP and lands in the platform fee, so the subtotal is never below
 * cost (landed + receiving). The buyer-facing line items never name the supplier.
 */
import type { Incoterm } from '../../contracts/enums';
import type { QuoteLineItem } from '../../contracts/quotes';
import type { PrimePolicy, RiskTier } from './config';

export type OfferForPricing = {
    unitPriceCents: number;
    quantity: number;
    toolingCents: number;
    /** Freight to the destination under the incoterm; null when the supplier did not quote it. */
    shippingCents: number | null;
    incoterm: Incoterm;
    productionLeadDays: number;
    shippingLeadDays: number;
    confidence: number;
};

export type SupplierForPricing = { verified: boolean; country: string };

export type ReceivingForPricing = { feeCents: number; perUnitCents: number } | null;

export type RiskAssessment = { score: number; tier: RiskTier; reservePct: number; factors: string[] };

export type SupplierQuotePrice = {
    goodsCents: number;
    toolingCents: number;
    freightCents: number;
    dutiesCents: number;
    landedCents: number;
    receivingFeeCents: number;
    marginCents: number;
    riskReserveCents: number;
    roundingCents: number;
    subtotalCents: number;
    unitPriceCents: number;
    /** Paid to the receiving partner (quotes.shop_cost_cents). */
    shopCostCents: number;
    /** Everything else (supplier landed cost is paid out of it by DiscoverMake). */
    platformFeeCents: number;
    risk: RiskAssessment;
    lineItems: QuoteLineItem[];
    assumptions: string[];
    excludedCosts: string[];
};

/** Incoterms whose price already includes delivery (and, for DDP, duties) to the destination. */
const DELIVERED: ReadonlySet<Incoterm> = new Set<Incoterm>(['DAP', 'DPU', 'DDP']);
const MAIN_CARRIAGE_PAID: ReadonlySet<Incoterm> = new Set<Incoterm>(['CFR', 'CIF', 'CPT', 'CIP']);

/**
 * US import duty estimate as a share of the goods value until an HTS classification is
 * done (owner input: a customs broker replaces these). Only used when the offer is not DDP.
 */
export const DUTY_RATE_ESTIMATE: Readonly<Record<string, number>> = { CN: 0.3, VN: 0.1, IN: 0.1, MX: 0, CA: 0, TW: 0.1, TH: 0.1, MY: 0.1 };
export const DEFAULT_DUTY_RATE = 0.1;
/** Freight estimate when the supplier did not quote it: 12% of goods, at least $150. */
export const FREIGHT_ESTIMATE = { pct: 0.12, minCents: 15_000 } as const;

const ceilDiv = (a: number, b: number) => Math.ceil(a / b);

/** Risk score 0..1 from supplier verification, lead time, incoterm, first order and confidence. */
export function assessRisk(offer: OfferForPricing, supplier: SupplierForPricing, firstOrder: boolean, policy: Pick<PrimePolicy, 'riskReservePct'>): RiskAssessment {
    let score = 0;
    const factors: string[] = [];
    if (!supplier.verified) {
        score += 0.35;
        factors.push('Supplier is not verified');
    }
    const lead = offer.productionLeadDays + offer.shippingLeadDays;
    if (lead > 45) {
        score += 0.25;
        factors.push(`Lead time of ${lead} days (over 45)`);
    } else if (lead > 30) {
        score += 0.15;
        factors.push(`Lead time of ${lead} days (over 30)`);
    } else if (lead > 21) {
        score += 0.05;
        factors.push(`Lead time of ${lead} days (over 21)`);
    }
    if (offer.incoterm === 'EXW' || offer.incoterm === 'FCA' || offer.incoterm === 'FOB') {
        score += 0.2;
        factors.push(`${offer.incoterm}: freight and customs are on our side`);
    } else if (MAIN_CARRIAGE_PAID.has(offer.incoterm)) {
        score += 0.1;
        factors.push(`${offer.incoterm}: import clearance and last mile are on our side`);
    } else if (offer.incoterm !== 'DDP') {
        score += 0.05;
        factors.push(`${offer.incoterm}: duties are on our side`);
    }
    if (firstOrder) {
        score += 0.15;
        factors.push('First order with this supplier');
    }
    if (offer.confidence < 0.8) {
        score += 0.1;
        factors.push(`Offer confidence ${offer.confidence.toFixed(2)} (under 0.80)`);
    }
    score = Math.min(1, Math.round(score * 100) / 100);
    const tier: RiskTier = score < 0.25 ? 'LOW' : score < 0.5 ? 'MEDIUM' : score < 0.75 ? 'HIGH' : 'VERY_HIGH';
    return { score, tier, reservePct: policy.riskReservePct[tier], factors };
}

function assertCents(name: string, v: number): void {
    if (!Number.isSafeInteger(v) || v < 0) throw new Error(`${name} must be a non-negative integer number of cents (got ${v})`);
}

/** Price a supplier-confirmed offer as a BINDING quote. Pure; throws on malformed input. */
export function priceSupplierQuote(input: {
    offer: OfferForPricing;
    supplier: SupplierForPricing;
    firstOrder: boolean;
    receiving: ReceivingForPricing;
    policy: Pick<PrimePolicy, 'marginPct' | 'riskReservePct'>;
}): SupplierQuotePrice {
    const { offer, supplier, receiving, policy } = input;
    if (!Number.isSafeInteger(offer.quantity) || offer.quantity <= 0) throw new Error('quantity must be a positive integer');
    assertCents('unitPriceCents', offer.unitPriceCents);
    assertCents('toolingCents', offer.toolingCents);
    if (offer.shippingCents !== null) assertCents('shippingCents', offer.shippingCents);

    const assumptions: string[] = [];
    const excludedCosts: string[] = [];
    const goodsCents = offer.unitPriceCents * offer.quantity;
    const toolingCents = offer.toolingCents;

    let freightCents: number;
    if (offer.shippingCents !== null) {
        freightCents = offer.shippingCents;
    } else if (DELIVERED.has(offer.incoterm)) {
        freightCents = 0;
        assumptions.push(`Freight is included in the ${offer.incoterm} unit price`);
    } else {
        freightCents = Math.max(FREIGHT_ESTIMATE.minCents, Math.ceil(goodsCents * FREIGHT_ESTIMATE.pct));
        assumptions.push(`Freight not quoted: estimated at ${Math.round(FREIGHT_ESTIMATE.pct * 100)}% of goods value (at least $${FREIGHT_ESTIMATE.minCents / 100})`);
    }

    let dutiesCents = 0;
    if (offer.incoterm === 'DDP') {
        assumptions.push('DDP: import duties and taxes are paid by the supplier');
    } else {
        const rate = DUTY_RATE_ESTIMATE[supplier.country.toUpperCase()] ?? DEFAULT_DUTY_RATE;
        dutiesCents = Math.ceil(goodsCents * rate);
        assumptions.push(`Import duties estimated at ${Math.round(rate * 100)}% of goods value until the HTS classification is confirmed`);
    }
    const landedCents = goodsCents + toolingCents + freightCents + dutiesCents;

    const receivingFeeCents = receiving ? receiving.feeCents + receiving.perUnitCents * offer.quantity : 0;
    if (receiving) assumptions.push('A DiscoverMake partner receives the freight, inspects it against the inspection plan and ships it to you');
    else assumptions.push('Ships directly from the supplier after a pre-shipment inspection');

    const risk = assessRisk(offer, supplier, input.firstOrder, policy);
    const marginCents = Math.ceil(landedCents * policy.marginPct);
    const riskReserveCents = Math.ceil(landedCents * risk.reservePct);
    const raw = landedCents + receivingFeeCents + marginCents + riskReserveCents;
    const unitPriceCents = ceilDiv(raw, offer.quantity);
    const subtotalCents = unitPriceCents * offer.quantity;
    const roundingCents = subtotalCents - raw;
    if (!Number.isSafeInteger(subtotalCents)) throw new Error('Quote total is too large');
    if (subtotalCents < landedCents + receivingFeeCents) throw new Error('Supplier quote would be priced below cost');

    excludedCosts.push('Sales tax (not collected)', 'Samples (none requested)', 'Engineering changes after this design version');
    if (offer.toolingCents === 0) excludedCosts.push('Tooling (the supplier quoted none)');

    const platformFeeCents = subtotalCents - receivingFeeCents;
    const lineItems: QuoteLineItem[] = [
        {
            code: 'PARTNER_PRODUCTION',
            label: 'Production',
            explainer: 'Made by a verified manufacturing partner to your exact design version.',
            unitCents: offer.unitPriceCents,
            quantity: offer.quantity,
            totalCents: goodsCents,
        },
    ];
    if (toolingCents > 0) lineItems.push({ code: 'TOOLING', label: 'Tooling', explainer: 'One-time fixtures or tooling for this run.', unitCents: toolingCents, quantity: 1, totalCents: toolingCents });
    if (freightCents + dutiesCents > 0) {
        lineItems.push({
            code: 'FREIGHT_DUTIES',
            label: 'Freight and duties',
            explainer: 'International freight, customs clearance and import duties to our receiving partner.',
            unitCents: freightCents + dutiesCents,
            quantity: 1,
            totalCents: freightCents + dutiesCents,
        });
    }
    if (receivingFeeCents > 0) {
        lineItems.push({
            code: 'RECEIVING_QA',
            label: 'Receiving inspection',
            explainer: 'A DiscoverMake partner checks the parts against your inspection plan before they ship to you.',
            unitCents: receivingFeeCents,
            quantity: 1,
            totalCents: receivingFeeCents,
        });
    }
    lineItems.push({
        code: 'DELIVERY_GUARANTEE',
        label: 'Delivery guarantee',
        explainer: 'Covers our promise: if a part arrives late or fails inspection, we credit or remake it.',
        unitCents: riskReserveCents,
        quantity: 1,
        totalCents: riskReserveCents,
    });
    lineItems.push({
        code: 'PLATFORM_FEE',
        label: 'DiscoverMake fee',
        explainer: 'Sourcing, negotiation, purchase order management and support.',
        unitCents: marginCents + roundingCents,
        quantity: 1,
        totalCents: marginCents + roundingCents,
    });
    // Zero lines (e.g. a zero reserve) are dropped; the sum still equals the subtotal.
    const nonZero = lineItems.filter((li) => li.totalCents > 0);
    const sum = nonZero.reduce((s, li) => s + li.totalCents, 0);
    if (sum !== subtotalCents) throw new Error(`Supplier quote line items (${sum}) do not add up to the subtotal (${subtotalCents})`);

    return {
        goodsCents,
        toolingCents,
        freightCents,
        dutiesCents,
        landedCents,
        receivingFeeCents,
        marginCents,
        riskReserveCents,
        roundingCents,
        subtotalCents,
        unitPriceCents,
        shopCostCents: receivingFeeCents,
        platformFeeCents,
        risk,
        lineItems: nonZero,
        assumptions,
        excludedCosts,
    };
}

/** Deposit at checkout and balance at shipment. Deposit rounds up; deposit + balance = total. */
export function depositSplit(totalCents: number, depositPct: number): { depositCents: number; balanceCents: number } {
    if (!Number.isSafeInteger(totalCents) || totalCents < 0) throw new Error('total must be a non-negative integer');
    if (!(depositPct >= 0 && depositPct <= 1)) throw new Error('depositPct must be within 0..1');
    const depositCents = Math.min(totalCents, Math.ceil(totalCents * depositPct));
    return { depositCents, balanceCents: totalCents - depositCents };
}

/** Card processors refuse tiny charges (Stripe: $0.50), so a credit always leaves at least this much to pay. */
export const MIN_CHARGE_CENTS = 50;

/** What a payment plan charges now, after a promise credit (applied to the first charge only). */
export function firstChargeCents(firstCents: number, availableCreditCents: number): { chargeCents: number; creditCents: number } {
    const usable = Math.max(0, firstCents - MIN_CHARGE_CENTS);
    const creditCents = Math.max(0, Math.min(usable, availableCreditCents));
    return { chargeCents: firstCents - creditCents, creditCents };
}
