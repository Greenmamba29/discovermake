/**
 * 3D-print instant pricing (R6). Pure and deterministic: same inputs -> same cents.
 *
 *   effective volume   V_eff = shell + infill x (V - shell),  shell = min(V, area x shell thickness)
 *                      (SLS parts are solid: V_eff = V)
 *   mass               V_eff x density
 *   per part (shop cost, before margin)
 *     material         mass x $/kg x (1 + waste) x markup
 *     printing         (V_eff / deposition rate + layers x per-layer overhead) x printer $/h
 *     post-processing  support removal / depowdering, per part
 *     QA               caliper check of the buyer's confirmed dimensions, per part
 *     handling         part handling + packaging base / qty
 *     setup            slicing, bed prep and first-layer check / qty
 *   margin             platform margin x (1 - volumeDiscountMax x f(qty)), never below minMarginPct
 *                      (f = the R1 volume curve). Volume discounts come out of the MARGIN only,
 *                      so a quote is never below cost: shop cost = the full cost at every quantity.
 *   floor              the rate card's minimum order value.
 *
 * Every coefficient comes from the shop's print rate card and the print material (all
 * uncalibrated R6 defaults, see docs/architecture/r6-reconstruct.md "Calibration").
 */
import type { QuoteLineItem } from '../../../contracts/quotes';

export const PRINT_PRICING_VERSION = 'px-print-2026.10-r6';
/** Ladder for printed parts (Stage 5 brief: 1/10/25/50/100). */
export const PRINT_LADDER_QUANTITIES = [1, 10, 25, 50, 100] as const;

export type PrintProcess = 'FDM' | 'SLS';

export type PrintGeometry = {
    /** Bounding box in mm (x, y, z) as modelled: z = build direction. */
    bboxMm: [number, number, number];
    volumeMm3: number;
    surfaceAreaMm2: number;
    /** Thinnest wall of the part (from the spec), mm. */
    minWallMm: number;
    /** Widest unsupported bridge (bore ceiling), mm. */
    bridgeSpanMm: number;
};

export type PrintMaterialPricing = {
    name: string;
    process: PrintProcess;
    densityKgM3: number;
    priceCentsPerKg: number;
    minWallMm: number;
    maxBridgeMm: number;
};

export type PrintRateCardPricing = {
    fdmCentsPerHour: number;
    fdmMm3PerHour: number;
    fdmLayerHeightMm: number;
    fdmLayerSeconds: number;
    slsCentsPerHour: number;
    slsMm3PerHour: number;
    slsLayerHeightMm: number;
    slsLayerSeconds: number;
    shellMm: number;
    infillPct: number;
    orderSetupCents: number;
    postProcessCentsPerPart: number;
    qaCentsPerPart: number;
    partHandlingCents: number;
    packagingBaseCents: number;
    materialMarkup: number;
    materialWastePct: number;
    platformMarginPct: number;
    minMarginPct: number;
    volumeDiscountMax: number;
    minimumOrderCents: number;
    printerHoursPerDay: number;
};

export type PrintPriceResult = {
    quantity: number;
    lineItems: QuoteLineItem[];
    unitPriceCents: number;
    subtotalCents: number;
    shopCostCents: number;
    platformFeeCents: number;
    /** Unrounded full cost of the order (material + machine + labour + setup), cents. */
    rawCostCents: number;
    effectiveMarginPct: number;
    minimumApplied: boolean;
    layerHeightMm: number;
    layers: number;
    effectiveVolumeMm3: number;
    unitMassG: number;
    printHoursPerPart: number;
    /** Printer hours for the whole order (lead-time input). */
    machineHours: number;
};

export class PrintPricingError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PrintPricingError';
    }
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function layerHeightFor(process: PrintProcess, rc: Pick<PrintRateCardPricing, 'fdmLayerHeightMm' | 'slsLayerHeightMm'>): number {
    return process === 'SLS' ? rc.slsLayerHeightMm : rc.fdmLayerHeightMm;
}

/** Deposited volume: solid shell plus sparse infill (FDM); solid for SLS. */
export function effectiveVolumeMm3(g: Pick<PrintGeometry, 'volumeMm3' | 'surfaceAreaMm2'>, process: PrintProcess, rc: Pick<PrintRateCardPricing, 'shellMm' | 'infillPct'>): number {
    if (process === 'SLS') return g.volumeMm3;
    const shell = Math.min(g.volumeMm3, g.surfaceAreaMm2 * rc.shellMm);
    return shell + rc.infillPct * Math.max(0, g.volumeMm3 - shell);
}

/** Printer time per part in hours (deposition + per-layer overhead). */
export function printHoursPerPart(g: PrintGeometry, process: PrintProcess, rc: PrintRateCardPricing): { hours: number; layers: number; layerHeightMm: number } {
    const layerHeightMm = layerHeightFor(process, rc);
    const rate = process === 'SLS' ? rc.slsMm3PerHour : rc.fdmMm3PerHour;
    if (!(rate > 0) || !(layerHeightMm > 0)) throw new PrintPricingError('Print rate card has no deposition rate or layer height');
    const layers = Math.ceil(g.bboxMm[2] / layerHeightMm - 1e-9);
    const layerSeconds = process === 'SLS' ? rc.slsLayerSeconds : rc.fdmLayerSeconds;
    const hours = effectiveVolumeMm3(g, process, rc) / rate + (layers * layerSeconds) / 3600;
    return { hours, layers, layerHeightMm };
}

export function unitMassG(g: Pick<PrintGeometry, 'volumeMm3' | 'surfaceAreaMm2'>, m: Pick<PrintMaterialPricing, 'process' | 'densityKgM3'>, rc: Pick<PrintRateCardPricing, 'shellMm' | 'infillPct'>): number {
    return effectiveVolumeMm3(g, m.process, rc) * m.densityKgM3 * 1e-6;
}

/** Margin at this quantity: the volume discount is taken out of the margin, never below the floor. */
/**
 * Print volume curve: 0 at one part, 1 at the top of the print ladder (100), log-shaped like
 * the sheet curve but saturating at print quantities instead of the sheet ladder's.
 */
export const PRINT_VOLUME_SATURATION_QTY = 100;
export function printVolumeCurve(quantity: number): number {
    if (quantity <= 1) return 0;
    return Math.min(1, Math.log(quantity) / Math.log(PRINT_VOLUME_SATURATION_QTY));
}

export function effectiveMarginPct(rc: Pick<PrintRateCardPricing, 'platformMarginPct' | 'minMarginPct' | 'volumeDiscountMax'>, quantity: number): number {
    return Math.max(rc.minMarginPct, rc.platformMarginPct * (1 - rc.volumeDiscountMax * printVolumeCurve(quantity)));
}

type Component = { code: QuoteLineItem['code']; label: string; explainer: string; perPart: number; perOrder: number; keepZero?: boolean };

/** Price one printed part at one quantity. */
export function pricePrint(input: { geometry: PrintGeometry; material: PrintMaterialPricing; rateCard: PrintRateCardPricing; quantity: number }): PrintPriceResult {
    const { geometry: g, material: m, rateCard: rc, quantity: q } = input;
    if (!Number.isInteger(q) || q < 1) throw new PrintPricingError('Quantity must be a positive integer');
    if (!(g.volumeMm3 > 0) || !(g.surfaceAreaMm2 > 0)) throw new PrintPricingError('The CAD manifest has no volume or surface area');
    const margin = effectiveMarginPct(rc, q);
    const time = printHoursPerPart(g, m.process, rc);
    const eff = effectiveVolumeMm3(g, m.process, rc);
    const massG = eff * m.densityKgM3 * 1e-6;
    const materialCents = (massG / 1000) * m.priceCentsPerKg * (1 + rc.materialWastePct) * rc.materialMarkup;
    const hourly = m.process === 'SLS' ? rc.slsCentsPerHour : rc.fdmCentsPerHour;
    const printCents = time.hours * hourly;
    const discountNote = margin < rc.platformMarginPct ? ` Includes a volume discount at this quantity.` : '';
    const processName = m.process === 'SLS' ? 'SLS powder bed' : 'FDM';

    const components: Component[] = [
        {
            code: 'MATERIAL',
            label: `${m.name}`,
            explainer: `${massG.toFixed(1)} g of ${m.name} per part (${(eff / 1000).toFixed(1)} cm³ deposited${m.process === 'FDM' ? `: ${rc.shellMm} mm walls and skins, ${Math.round(rc.infillPct * 100)}% infill` : ', solid'}) plus ${Math.round(rc.materialWastePct * 100)}% purge and support waste.`,
            perPart: materialCents,
            perOrder: 0,
            keepZero: true,
        },
        {
            code: 'PRINTING',
            label: `${processName} printing`,
            explainer: `${time.hours.toFixed(2)} h of printer time per part: ${time.layers} layers at ${time.layerHeightMm} mm.${discountNote}`,
            perPart: printCents,
            perOrder: 0,
            keepZero: true,
        },
        {
            code: 'POST_PROCESSING',
            label: m.process === 'SLS' ? 'Depowdering & bead blast' : 'Support removal & cleanup',
            explainer: m.process === 'SLS' ? 'Each part is depowdered and bead blasted.' : 'Supports and brim are removed and edges cleaned by hand.',
            perPart: rc.postProcessCentsPerPart,
            perOrder: 0,
        },
        {
            code: 'QA',
            label: 'Quality inspection',
            explainer: 'Every part is checked with calipers against the dimensions you confirmed before it ships.',
            perPart: rc.qaCentsPerPart,
            perOrder: 0,
        },
        {
            code: 'HANDLING',
            label: 'Handling & packaging',
            explainer: 'Bagged, padded and boxed for shipping.',
            perPart: rc.partHandlingCents,
            perOrder: rc.packagingBaseCents,
        },
        {
            code: 'SETUP',
            label: 'Setup & slicing',
            explainer: `One-time ${usd(rc.orderSetupCents)} for slicing, bed preparation and a first-layer check, spread over ${q} part${q === 1 ? '' : 's'}.`,
            perPart: 0,
            perOrder: rc.orderSetupCents,
        },
    ];

    const rawCostCents = components.reduce((s, c) => s + c.perPart * q + c.perOrder, 0);
    const lineItems: QuoteLineItem[] = [];
    for (const c of components) {
        // Round each line UP: the sum of lines can then never fall below cost, even at a 0% margin floor.
        const unitCents = Math.ceil((c.perPart + c.perOrder / q) * (1 + margin) - 1e-9);
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
            explainer: `Printed orders have a ${usd(rc.minimumOrderCents)} minimum to cover printer setup and shipping prep.`,
            unitCents: diff,
            quantity: 1,
            totalCents: diff,
        });
        subtotalCents = rc.minimumOrderCents;
        minimumApplied = true;
    }
    // The shop is paid the full cost (or more, under the minimum); the platform keeps the rest.
    const shopCostCents = Math.min(subtotalCents, Math.max(Math.ceil(rawCostCents), Math.round(subtotalCents / (1 + margin))));
    return {
        quantity: q,
        lineItems,
        unitPriceCents,
        subtotalCents,
        shopCostCents,
        platformFeeCents: subtotalCents - shopCostCents,
        rawCostCents,
        effectiveMarginPct: margin,
        minimumApplied,
        layerHeightMm: time.layerHeightMm,
        layers: time.layers,
        effectiveVolumeMm3: eff,
        unitMassG: massG,
        printHoursPerPart: time.hours,
        machineHours: time.hours * q,
    };
}

// ---------------------------------------------------------------------------
// Build volume fit
// ---------------------------------------------------------------------------

export type BuildVolume = { buildXMm: number; buildYMm: number; buildZMm: number };

/**
 * Does a part's bounding box fit a printer's build volume in some axis-aligned orientation?
 * (A box fits another under 90-degree rotations iff its sorted sides each fit the sorted sides.)
 */
export function fitsBuildVolume(bbox: readonly [number, number, number], v: BuildVolume): boolean {
    const part = [...bbox].sort((a, b) => a - b);
    const box = [v.buildXMm, v.buildYMm, v.buildZMm].sort((a, b) => a - b);
    return part.every((p, i) => p <= box[i]! + 1e-9);
}
