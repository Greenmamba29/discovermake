/**
 * Pricing math, quantity ladder, lead time and shipping (pure functions).
 * Hand-computed expectations use the R1 seed coefficients (16 ga mild steel on
 * the Philadelphia Precision Works rate card).
 */
import { describe, expect, it } from 'vitest';
import {
    cutMinutes,
    materialCostCents,
    nestedAreaMm2,
    priceQuote,
    PricingError,
    volumeCurve,
    type PricingInput,
    type PricingService,
} from '@/server/quote/pricing';
import { addBusinessDays, computeLeadTime, isBusinessDay, localDateTime, usHolidays } from '@/server/quote/leadtime';
import { billableWeightKg, shippingOptions } from '@/server/quote/shipping';

const RATE_CARD: PricingInput['rateCard'] = {
    fiberLaserCentsPerHour: 15000,
    co2LaserCentsPerHour: 9000,
    brakeCentsPerBend: 250,
    brakeSetupCents: 2000,
    orderSetupCents: 1500,
    partHandlingCents: 50,
    finishingCentsPerFt2: 350,
    finishBatchSetupCents: 3500,
    qaCentsPerPart: 25,
    packagingBaseCents: 400,
    materialMarkup: 1.1,
    platformMarginPct: 0.35,
    minimumOrderCents: 2900,
    volumeDiscountMax: 0.25,
    serviceOverrides: {},
};

const STEEL_16GA = {
    material: { densityKgM3: 7850, priceBasis: 'PER_KG' as const, priceCentsPerKg: 220, sheetWidthMm: null, sheetHeightMm: null, scrapPct: 0.15 },
    thickness: { thicknessMm: 1.52, feedRateMmPerMin: 7500, pierceTimeS: 0.25, kerfMm: 0.15, sheetPriceCents: null },
};

/** plate-holes-mm fixture geometry. */
const PLATE = { netAreaMm2: 5886.9027, bboxWidthMm: 100, bboxHeightMm: 60, cutLengthMm: 395.3982, pierceCount: 5, bendCount: 0 };

const base = (over: Partial<PricingInput> = {}): PricingInput => ({
    geometry: PLATE,
    ...STEEL_16GA,
    processKind: 'FIBER_LASER',
    rateCard: RATE_CARD,
    finish: null,
    services: [],
    quantity: 1,
    ...over,
});

const POWDER_BLACK: PricingService = {
    serviceId: 'svc_powder_black_matte',
    slug: 'powder-coat-matte-black',
    name: 'Powder coat · matte black',
    kind: 'FINISH',
    pricingUnit: 'PER_AREA_FT2',
    unitPriceCents: 350,
    batchSetupCents: 3500,
    minimumCents: 2500,
    featureCount: null,
};
const TAPPING = (n: number): PricingService => ({
    serviceId: 'svc_tapping',
    slug: 'tapping',
    name: 'Tapping',
    kind: 'SECONDARY_OP',
    pricingUnit: 'PER_FEATURE',
    unitPriceCents: 175,
    batchSetupCents: 0,
    minimumCents: 0,
    featureCount: n,
});
const BENDING: PricingService = {
    serviceId: 'svc_bending',
    slug: 'bending',
    name: 'Press brake bending',
    kind: 'SECONDARY_OP',
    pricingUnit: 'PER_FEATURE',
    unitPriceCents: 250,
    batchSetupCents: 2000,
    minimumCents: 0,
    featureCount: 2,
};

const line = (r: ReturnType<typeof priceQuote>, code: string) => r.lineItems.find((l) => l.code === code);

describe('pricing components', () => {
    it('computes nested area, material and cut time from the formulas', () => {
        // gap = max(3, 1.52) + 0.15 kerf = 3.15 mm
        expect(nestedAreaMm2(PLATE, STEEL_16GA.thickness)).toBeCloseTo(103.15 * 63.15, 6);
        // 6513.9225 mm² × 1.15 scrap × 1.52 mm × 7850 kg/m³ × 1e-9 = 0.0893827 kg × 220 ¢/kg
        expect(materialCostCents(PLATE, STEEL_16GA.material, STEEL_16GA.thickness)).toBeCloseTo(19.6642, 3);
        // 395.3982 / 7500 × 1.15 + 5 × 0.25 s / 60
        expect(cutMinutes(PLATE, STEEL_16GA.thickness)).toBeCloseTo(0.0814611, 6);
    });

    it('prices per sheet for sheet-stock materials', () => {
        const acrylic = {
            material: { densityKgM3: 1190, priceBasis: 'PER_SHEET' as const, priceCentsPerKg: null, sheetWidthMm: 610, sheetHeightMm: 1220, scrapPct: 0.2 },
            thickness: { thicknessMm: 3, feedRateMmPerMin: 1800, pierceTimeS: 0.1, kerfMm: 0.2, sheetPriceCents: 3800 },
        };
        // gap = max(3, 3) + 0.2 = 3.2 -> (103.2 × 63.2) × 1.2 / (610 × 1220) × 3800 ¢
        expect(materialCostCents(PLATE, acrylic.material, acrylic.thickness)).toBeCloseTo(((103.2 * 63.2 * 1.2) / (610 * 1220)) * 3800, 6);
        expect(() => materialCostCents(PLATE, { ...acrylic.material, sheetWidthMm: null }, acrylic.thickness)).toThrow(PricingError);
    });

    it('volume curve is 0 at qty 1, monotonic, and saturates at 1000', () => {
        expect(volumeCurve(1)).toBe(0);
        expect(volumeCurve(100)).toBeCloseTo(2 / 3, 9);
        expect(volumeCurve(1000)).toBe(1);
        expect(volumeCurve(5000)).toBe(1);
        let prev = -1;
        for (const q of [1, 2, 5, 10, 25, 50, 100, 250, 999]) {
            expect(volumeCurve(q)).toBeGreaterThan(prev);
            prev = volumeCurve(q);
        }
    });
});

describe('priceQuote', () => {
    it('matches a hand-computed quote at qty 1 (minimum order applies)', () => {
        const r = priceQuote(base());
        expect(r.lineItems.map((l) => [l.code, l.unitCents, l.quantity, l.totalCents])).toEqual([
            ['MATERIAL', 29, 1, 29], // 21.6306 ¢ (incl. 1.10 markup) × 1.35
            ['CUTTING', 27, 1, 27], // 20.3653 ¢ × 1.35
            ['HANDLING', 611, 1, 611], // (50 + 0.0646 ft² × 40 + 400 base) × 1.35
            ['QA', 34, 1, 34],
            ['SETUP', 2025, 1, 2025],
            ['MINIMUM_ORDER', 174, 1, 174],
        ]);
        expect(r.unitPriceCents).toBe(2726);
        expect(r.subtotalCents).toBe(2900);
        expect(r.minimumApplied).toBe(true);
        expect(r.shopCostCents).toBe(2148); // round(2900 / 1.35)
        expect(r.platformFeeCents).toBe(752);
    });

    it('matches a hand-computed quote at qty 100 (volume discount, setups amortized)', () => {
        const r = priceQuote(base({ quantity: 100 }));
        expect(r.lineItems.map((l) => [l.code, l.unitCents])).toEqual([
            ['MATERIAL', 24],
            ['CUTTING', 23],
            ['HANDLING', 65],
            ['QA', 34],
            ['SETUP', 20],
        ]);
        expect(r.unitPriceCents).toBe(166);
        expect(r.subtotalCents).toBe(16600);
        expect(r.minimumApplied).toBe(false);
    });

    it('prices finishing per coated ft² (both sides) plus batch setup', () => {
        const r = priceQuote(base({ finish: POWDER_BLACK }));
        // 2 × 5886.9 mm² = 0.126732 ft² × 350 = 44.356 ¢ + 3500 setup, × 1.35
        expect(line(r, 'FINISHING')?.unitCents).toBe(4785);
        expect(line(r, 'FINISHING')?.label).toBe('Powder coat · matte black');
    });

    it('applies a service minimum when the line is below it', () => {
        const anodize: PricingService = { ...POWDER_BLACK, slug: 'anodize', unitPriceCents: 450, batchSetupCents: 0, minimumCents: 3500 };
        const r = priceQuote(base({ finish: anodize, rateCard: { ...RATE_CARD, finishBatchSetupCents: 0 } }));
        // 0.126732 ft² × 450 = 57.03 ¢ -> uplifted to 3500 ¢ minimum
        expect(line(r, 'FINISHING')?.unitCents).toBe(Math.round(3500 * 1.35));
    });

    it('prices per-feature services and bends from the geometry', () => {
        const r = priceQuote(base({ services: [TAPPING(4)] }));
        expect(line(r, 'SECONDARY')?.unitCents).toBe(Math.round(4 * 175 * 1.35));
        const bent = priceQuote(base({ geometry: { ...PLATE, bendCount: 2 }, services: [BENDING] }));
        expect(line(bent, 'BENDING')?.unitCents).toBe(Math.round((2 * 250 + 2000) * 1.35));
        const overridden = priceQuote(base({ services: [TAPPING(4)], rateCard: { ...RATE_CARD, serviceOverrides: { tapping: 100 } } }));
        expect(line(overridden, 'SECONDARY')?.unitCents).toBe(Math.round(4 * 100 * 1.35));
    });

    it('keeps the invariants: lines sum to subtotal, unit × qty, shop cost + fee', () => {
        for (const q of [1, 3, 10, 25, 50, 100, 250, 1000, 5000]) {
            for (const over of [{}, { finish: POWDER_BLACK }, { services: [TAPPING(4)] }, { geometry: { ...PLATE, bendCount: 2 }, services: [BENDING] }]) {
                const r = priceQuote(base({ ...over, quantity: q }));
                expect(r.lineItems.reduce((s, l) => s + l.totalCents, 0)).toBe(r.subtotalCents);
                if (!r.minimumApplied) expect(r.unitPriceCents * q).toBe(r.subtotalCents);
                else expect(r.subtotalCents).toBe(RATE_CARD.minimumOrderCents);
                expect(r.shopCostCents + r.platformFeeCents).toBe(r.subtotalCents);
                expect(r.shopCostCents).toBeGreaterThan(0);
                for (const l of r.lineItems) {
                    expect(Number.isInteger(l.unitCents) && Number.isInteger(l.totalCents)).toBe(true);
                    expect(l.explainer.length).toBeGreaterThan(10);
                }
            }
        }
    });

    it('is deterministic', () => {
        const input = base({ quantity: 25, finish: POWDER_BLACK, services: [TAPPING(2)] });
        expect(priceQuote(input)).toEqual(priceQuote(structuredClone(input)));
    });

    it('produces a monotonic quantity ladder (unit price never rises, total never falls)', () => {
        const qs = [1, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
        for (const over of [{}, { finish: POWDER_BLACK }, { services: [TAPPING(6)] }, { geometry: { ...PLATE, bendCount: 3 }, services: [BENDING] }]) {
            const rungs = qs.map((q) => priceQuote(base({ ...over, quantity: q })));
            for (let i = 1; i < rungs.length; i++) {
                expect(rungs[i].unitPriceCents).toBeLessThanOrEqual(rungs[i - 1].unitPriceCents);
                expect(rungs[i].subtotalCents).toBeGreaterThanOrEqual(rungs[i - 1].subtotalCents);
            }
            expect(rungs[rungs.length - 1].unitPriceCents).toBeLessThan(rungs[0].unitPriceCents);
        }
    });

    it('rejects non-integer quantities', () => {
        expect(() => priceQuote(base({ quantity: 0 }))).toThrow(PricingError);
        expect(() => priceQuote(base({ quantity: 1.5 }))).toThrow(PricingError);
    });
});

describe('lead time', () => {
    it('knows observed US holidays', () => {
        const h2026 = usHolidays(2026);
        expect(h2026.has('2026-07-03')).toBe(true); // July 4th is a Saturday
        expect(h2026.has('2026-11-26')).toBe(true); // Thanksgiving
        expect(h2026.has('2026-05-25')).toBe(true); // Memorial Day
        expect(usHolidays(2027).has('2027-12-24')).toBe(true); // Christmas on Saturday
        expect(isBusinessDay('2026-10-10')).toBe(false); // Saturday
        expect(isBusinessDay('2026-10-12')).toBe(true); // Columbus Day: shops open
    });

    it('adds business days across weekends and holidays', () => {
        expect(addBusinessDays('2026-10-09', 1)).toBe('2026-10-12');
        expect(addBusinessDays('2026-11-25', 1)).toBe('2026-11-27');
        expect(addBusinessDays('2026-12-23', 2)).toBe('2026-12-28');
    });

    it('reads the local date in the shop timezone', () => {
        expect(localDateTime(new Date('2026-10-07T02:30:00Z'), 'America/New_York')).toEqual({ date: '2026-10-06', hour: 22 });
    });

    it('starts today before the noon cutoff, tomorrow after it', () => {
        const base = { timeZone: 'America/New_York', queueDays: 2, machineHours: 0.5, serviceDays: 0 };
        // Tue 2026-10-06 10:00 EDT: 2 queue + 1 production + 1 QA/pack = 4 business days.
        expect(computeLeadTime({ ...base, now: new Date('2026-10-06T14:00:00Z') })).toEqual({ leadTimeDays: 4, startDate: '2026-10-06', shipDate: '2026-10-12' });
        expect(computeLeadTime({ ...base, now: new Date('2026-10-06T18:00:00Z') })).toMatchObject({ startDate: '2026-10-07', shipDate: '2026-10-13' });
        // Machine time and services extend it.
        expect(computeLeadTime({ ...base, now: new Date('2026-10-06T14:00:00Z'), machineHours: 13, serviceDays: 3 }).leadTimeDays).toBe(2 + 3 + 3 + 1);
    });
});

describe('shipping options', () => {
    const input = { shipDate: '2026-10-12', unitMassG: 70, quantity: 10, bboxWidthMm: 100, bboxHeightMm: 60, thicknessMm: 1.52 };

    it('offers standard / expedited / express with delivery dates after the ship date', () => {
        const opts = shippingOptions(input);
        expect(opts.map((o) => o.method)).toEqual(['STANDARD', 'EXPEDITED', 'EXPRESS']);
        expect(opts[0].priceCents).toBeLessThan(opts[1].priceCents);
        expect(opts[1].priceCents).toBeLessThan(opts[2].priceCents);
        expect(opts.map((o) => o.deliveryDate)).toEqual(['2026-10-19', '2026-10-14', '2026-10-13']);
        for (const o of opts) expect(o.priceCents % 50).toBe(0);
    });

    it('uses billable weight and switches to freight for heavy orders', () => {
        expect(billableWeightKg(input)).toBeGreaterThan(0.3);
        const heavy = shippingOptions({ ...input, unitMassG: 20000, quantity: 10 });
        expect(heavy).toHaveLength(1);
        expect(heavy[0].label).toMatch(/Freight/);
        const oversize = shippingOptions({ ...input, bboxWidthMm: 1100 });
        expect(oversize[0].priceCents).toBeGreaterThan(shippingOptions(input)[0].priceCents + 3000);
    });
});
