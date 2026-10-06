/**
 * Instant-quote pricing (workflow 02 "Pricing model"). Pure and deterministic:
 * same inputs -> same cents. All money is integer cents in the outputs.
 *
 *   per part (shop cost, before margin)
 *     material  = nested area (bbox + gap)·(1 + scrap) × t × density × $/kg × markup   (PER_KG)
 *               | nested area·(1 + scrap) / sheet area × sheet price × markup          (PER_SHEET)
 *     cutting   = (cut length / feed rate × (1 + motion overhead) + pierces × pierce time) × laser $/h
 *     bending   = bends × $/bend                       + brake setup / qty
 *     secondary = Σ per-feature / per-part service fees + batch setups / qty
 *     finishing = area (both sides) × $/ft²            + finish batch setup / qty
 *     handling  = part handling + packaging(part size) + packaging base / qty
 *     QA        = per-part inspection
 *     setup     = order setup (programming, sheet loading) / qty
 *   variable per-part costs × (1 − volumeDiscountMax × f(qty)), f = ln(qty)/ln(1000) capped at 1
 *   × (1 + platform margin), rounded per line to cents; floor at the minimum order value.
 *
 * All coefficients come from the shop rate card + catalog rows (ALL uncalibrated in R1)
 * and the PRICING_CONSTANTS below, versioned by PRICING_VERSION.
 */
import type { QuoteLineItem } from '../../contracts/quotes';

export const PRICING_VERSION = 'px-2026.10-r1';

/** Quantities on the price ladder (workflow 02 + R1 brief: 1/10/25/50/100/250). */
export const QUOTE_LADDER_QUANTITIES = [1, 10, 25, 50, 100, 250] as const;

/** Engine constants not stored per shop (uncalibrated R1 defaults). */
export const PRICING_CONSTANTS = {
    /** Minimum gap between nested parts (mm); the gap is max(this, thickness × ratio) + kerf. */
    nestingGapMinMm: 3,
    nestingGapThicknessRatio: 1,
    /** Extra cut time for rapids, acceleration and lead-ins. */
    cutMotionOverhead: 0.15,
    /** Finishes coat both faces. */
    finishSides: 2,
    /** Per-part packaging by bounding-box area. */
    packagingCentsPerFt2: 40,
    /** Quantity at which the volume curve saturates. */
    volumeSaturationQty: 1000,
    /** Press brake cycle time per bend (lead-time capacity only). */
    bendSecondsPerBend: 20,
} as const;

export const MM2_PER_FT2 = 92_903.04;

export type PricingRateCard = {
    fiberLaserCentsPerHour: number;
    co2LaserCentsPerHour: number;
    brakeCentsPerBend: number;
    brakeSetupCents: number;
    orderSetupCents: number;
    partHandlingCents: number;
    finishingCentsPerFt2: number;
    finishBatchSetupCents: number;
    qaCentsPerPart: number;
    packagingBaseCents: number;
    materialMarkup: number;
    platformMarginPct: number;
    minimumOrderCents: number;
    volumeDiscountMax: number;
    serviceOverrides: Record<string, number>;
};

export type PricingMaterial = {
    densityKgM3: number;
    priceBasis: 'PER_KG' | 'PER_SHEET';
    priceCentsPerKg: number | null;
    sheetWidthMm: number | null;
    sheetHeightMm: number | null;
    scrapPct: number;
};

export type PricingThickness = {
    thicknessMm: number;
    feedRateMmPerMin: number;
    pierceTimeS: number;
    kerfMm: number;
    sheetPriceCents: number | null;
};

export type PricingService = {
    serviceId: string;
    slug: string;
    name: string;
    kind: 'SECONDARY_OP' | 'FINISH';
    pricingUnit: 'PER_FEATURE' | 'PER_PART' | 'PER_AREA_FT2';
    unitPriceCents: number;
    batchSetupCents: number;
    minimumCents: number;
    /** PER_FEATURE count per part (bending uses the geometry bend count instead). */
    featureCount: number | null;
};

export type PricingGeometry = {
    netAreaMm2: number;
    bboxWidthMm: number;
    bboxHeightMm: number;
    cutLengthMm: number;
    pierceCount: number;
    bendCount: number;
};

export type PricingInput = {
    geometry: PricingGeometry;
    material: PricingMaterial;
    thickness: PricingThickness;
    processKind: 'FIBER_LASER' | 'CO2_LASER';
    rateCard: PricingRateCard;
    finish: PricingService | null;
    /** SECONDARY_OP services (bending included when selected). */
    services: PricingService[];
    quantity: number;
};

export type PriceResult = {
    quantity: number;
    lineItems: QuoteLineItem[];
    unitPriceCents: number;
    subtotalCents: number;
    shopCostCents: number;
    platformFeeCents: number;
    minimumApplied: boolean;
    /** Laser + brake machine time for the whole order (lead-time input). */
    machineHours: number;
    /** Per-part cut time in minutes. */
    cutMinutesPerPart: number;
    unitMassG: number;
};

export class PricingError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PricingError';
    }
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** Volume curve f(q) in [0, 1]: 0 at q = 1, 1 at the saturation quantity. */
export function volumeCurve(quantity: number): number {
    if (quantity <= 1) return 0;
    return Math.min(1, Math.log(quantity) / Math.log(PRICING_CONSTANTS.volumeSaturationQty));
}

export function nestingGapMm(t: PricingThickness): number {
    return Math.max(PRICING_CONSTANTS.nestingGapMinMm, t.thicknessMm * PRICING_CONSTANTS.nestingGapThicknessRatio) + t.kerfMm;
}

/** Nested area per part for the instant quote (bounding-box heuristic + gap). */
export function nestedAreaMm2(g: PricingGeometry, t: PricingThickness): number {
    const gap = nestingGapMm(t);
    return (g.bboxWidthMm + gap) * (g.bboxHeightMm + gap);
}

/** Raw material cost per part in (fractional) cents, before markup. */
export function materialCostCents(g: PricingGeometry, m: PricingMaterial, t: PricingThickness): number {
    const area = nestedAreaMm2(g, t) * (1 + m.scrapPct);
    if (m.priceBasis === 'PER_KG') {
        if (m.priceCentsPerKg == null) throw new PricingError('Material has no $/kg price');
        const kg = area * t.thicknessMm * 1e-9 * m.densityKgM3;
        return kg * m.priceCentsPerKg;
    }
    if (!m.sheetWidthMm || !m.sheetHeightMm || t.sheetPriceCents == null) throw new PricingError('Sheet-priced material is missing sheet size or price');
    return (area / (m.sheetWidthMm * m.sheetHeightMm)) * t.sheetPriceCents;
}

/** Laser time per part in minutes. */
export function cutMinutes(g: PricingGeometry, t: PricingThickness): number {
    if (!(t.feedRateMmPerMin > 0)) throw new PricingError('Thickness option has no feed rate');
    return (g.cutLengthMm / t.feedRateMmPerMin) * (1 + PRICING_CONSTANTS.cutMotionOverhead) + (g.pierceCount * t.pierceTimeS) / 60;
}

export function unitMassGrams(g: PricingGeometry, m: PricingMaterial, t: PricingThickness): number {
    return g.netAreaMm2 * t.thicknessMm * m.densityKgM3 * 1e-6;
}

function servicePerPart(s: PricingService, rc: PricingRateCard, g: PricingGeometry, sides: number): number {
    const unit = rc.serviceOverrides[s.slug] ?? s.unitPriceCents;
    switch (s.pricingUnit) {
        case 'PER_FEATURE':
            return unit * (s.featureCount ?? 0);
        case 'PER_PART':
            return unit;
        case 'PER_AREA_FT2':
            return unit * ((g.netAreaMm2 * sides) / MM2_PER_FT2);
    }
}

type Component = { code: QuoteLineItem['code']; label: string; explainer: string; perPart: number; perOrder: number; keepZero?: boolean };

/** Price one configuration at one quantity. */
export function priceQuote(input: PricingInput): PriceResult {
    const { geometry: g, material, thickness, rateCard: rc, quantity: q } = input;
    if (!Number.isInteger(q) || q < 1) throw new PricingError('Quantity must be a positive integer');
    const margin = rc.platformMarginPct;
    const vf = 1 - rc.volumeDiscountMax * volumeCurve(q);
    const volumeNote = vf < 1 ? ` Includes a ${Math.round((1 - vf) * 100)}% volume discount at this quantity.` : '';

    const laserRate = input.processKind === 'CO2_LASER' ? rc.co2LaserCentsPerHour : rc.fiberLaserCentsPerHour;
    const mat = materialCostCents(g, material, thickness) * rc.materialMarkup;
    const cutMin = cutMinutes(g, thickness);
    const cut = (cutMin / 60) * laserRate;

    const bending = input.services.find((s) => s.slug === 'bending') ?? null;
    const secondary = input.services.filter((s) => s.slug !== 'bending');

    const components: Component[] = [
        {
            code: 'MATERIAL',
            label: 'Material',
            explainer: `Sheet stock for a ${Math.round(g.bboxWidthMm)} × ${Math.round(g.bboxHeightMm)} mm part plus nesting gap and ${Math.round(material.scrapPct * 100)}% scrap allowance.${volumeNote}`,
            perPart: mat * vf,
            perOrder: 0,
            keepZero: true,
        },
        {
            code: 'CUTTING',
            label: 'Laser cutting',
            explainer: `${(g.cutLengthMm / 1000).toFixed(2)} m of cut path and ${g.pierceCount} pierce${g.pierceCount === 1 ? '' : 's'} per part (${cutMin.toFixed(2)} min of laser time).${volumeNote}`,
            perPart: cut * vf,
            perOrder: 0,
            keepZero: true,
        },
    ];

    if (bending) {
        const bends = g.bendCount;
        components.push({
            code: 'BENDING',
            label: 'Bending',
            explainer: `${bends} bend${bends === 1 ? '' : 's'} per part on a CNC press brake, plus a one-time ${usd(rc.brakeSetupCents)} tooling setup spread over the order.`,
            perPart: bends * (rc.serviceOverrides.bending ?? rc.brakeCentsPerBend) * vf,
            perOrder: rc.brakeSetupCents,
        });
    }

    if (secondary.length) {
        let perPart = 0;
        let perOrder = 0;
        for (const s of secondary) {
            const pp = servicePerPart(s, rc, g, 1) * vf;
            const line = pp * q + s.batchSetupCents;
            perPart += pp;
            perOrder += s.batchSetupCents + Math.max(0, s.minimumCents - line);
        }
        components.push({
            code: 'SECONDARY',
            label: 'Hardware & secondary ops',
            explainer: `${secondary.map((s) => (s.pricingUnit === 'PER_FEATURE' ? `${s.name} × ${s.featureCount ?? 0}` : s.name)).join(', ')} per part.${volumeNote}`,
            perPart,
            perOrder,
        });
    }

    if (input.finish) {
        const f = input.finish;
        const pp = servicePerPart(f, rc, g, PRICING_CONSTANTS.finishSides) * vf;
        const setup = f.batchSetupCents > 0 ? f.batchSetupCents : rc.finishBatchSetupCents;
        const line = pp * q + setup;
        const areaFt2 = (g.netAreaMm2 * PRICING_CONSTANTS.finishSides) / MM2_PER_FT2;
        components.push({
            code: 'FINISHING',
            label: f.name,
            explainer: `${areaFt2.toFixed(2)} ft² of coated surface per part (both sides) plus a ${usd(setup)} batch setup spread over the order.`,
            perPart: pp,
            perOrder: setup + Math.max(0, f.minimumCents - line),
        });
    }

    const bboxFt2 = (g.bboxWidthMm * g.bboxHeightMm) / MM2_PER_FT2;
    components.push({
        code: 'HANDLING',
        label: 'Handling & packaging',
        explainer: 'Deburr-safe handling, protective wrap and a box sized to your parts.',
        perPart: (rc.partHandlingCents + bboxFt2 * PRICING_CONSTANTS.packagingCentsPerFt2) * vf,
        perOrder: rc.packagingBaseCents,
    });
    if (rc.qaCentsPerPart > 0) {
        components.push({
            code: 'QA',
            label: 'Quality inspection',
            explainer: 'Every part is checked against your drawing (dimensions, holes, finish) before it ships.',
            perPart: rc.qaCentsPerPart,
            perOrder: 0,
        });
    }
    components.push({
        code: 'SETUP',
        label: 'Setup & programming',
        explainer: `One-time ${usd(rc.orderSetupCents)} for CAM programming and sheet loading, spread over ${q} part${q === 1 ? '' : 's'}.`,
        perPart: 0,
        perOrder: rc.orderSetupCents,
    });

    const lineItems: QuoteLineItem[] = [];
    for (const c of components) {
        const unitCents = Math.round((c.perPart + c.perOrder / q) * (1 + margin));
        if (unitCents <= 0 && !c.keepZero) continue;
        lineItems.push({ code: c.code, label: c.label, explainer: c.explainer, unitCents: Math.max(0, unitCents), quantity: q, totalCents: Math.max(0, unitCents) * q });
    }
    const unitPriceCents = lineItems.reduce((s, l) => s + l.unitCents, 0);
    let subtotalCents = unitPriceCents * q;
    let minimumApplied = false;
    if (subtotalCents < rc.minimumOrderCents) {
        const diff = rc.minimumOrderCents - subtotalCents;
        lineItems.push({
            code: 'MINIMUM_ORDER',
            label: 'Minimum order',
            explainer: `Orders have a ${usd(rc.minimumOrderCents)} minimum to cover machine setup and shipping prep. Add parts at no extra cost up to this amount.`,
            unitCents: diff,
            quantity: 1,
            totalCents: diff,
        });
        subtotalCents = rc.minimumOrderCents;
        minimumApplied = true;
    }
    const shopCostCents = Math.round(subtotalCents / (1 + margin));
    const machineHours = (q * cutMin) / 60 + (bending ? (q * g.bendCount * PRICING_CONSTANTS.bendSecondsPerBend) / 3600 : 0);
    return {
        quantity: q,
        lineItems,
        unitPriceCents,
        subtotalCents,
        shopCostCents,
        platformFeeCents: subtotalCents - shopCostCents,
        minimumApplied,
        machineHours,
        cutMinutesPerPart: cutMin,
        unitMassG: unitMassGrams(g, material, thickness),
    };
}
