/** Photo measurement math, unit normalization and the >10% delta warning (pure). */
import { describe, expect, it } from 'vitest';
import { DELTA_WARN_PCT, REFERENCE_PRESETS } from '@/contracts/reconstruct';
import {
    deltaPct,
    deltaWarning,
    distancePx,
    estimateMm,
    estimateUncertaintyMm,
    fromMm,
    nudge,
    parseReading,
    photoEstimates,
    scaleFromReference,
    setLineLength,
    toMm,
} from '@/lib/reconstruct/measure';

const card = { preset: 'credit_card' as const, a: { x: 100, y: 500 }, b: { x: 956, y: 500 }, lengthMm: REFERENCE_PRESETS.credit_card.lengthMm };

describe('scale from a reference object', () => {
    it('uses the credit-card long edge (85.60 mm) and the quarter (24.26 mm)', () => {
        expect(REFERENCE_PRESETS.credit_card.lengthMm).toBe(85.6);
        expect(REFERENCE_PRESETS.credit_card_short.lengthMm).toBe(53.98);
        expect(REFERENCE_PRESETS.us_quarter.lengthMm).toBe(24.26);
        expect(scaleFromReference(card)).toBeCloseTo(0.1, 10); // 85.6 mm over 856 px
        // The same physical scale from a quarter 242.6 px across.
        expect(scaleFromReference({ a: { x: 0, y: 0 }, b: { x: 242.6, y: 0 }, lengthMm: 24.26 })).toBeCloseTo(0.1, 10);
    });

    it('is orientation free and refuses a reference shorter than 20 px or without a length', () => {
        const diag = { a: { x: 0, y: 0 }, b: { x: 300, y: 400 }, lengthMm: 50 };
        expect(distancePx(diag.a, diag.b)).toBe(500);
        expect(scaleFromReference(diag)).toBeCloseTo(0.1);
        expect(scaleFromReference({ a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, lengthMm: 50 })).toBeNull();
        expect(scaleFromReference({ ...diag, lengthMm: 0 })).toBeNull();
        expect(scaleFromReference(null)).toBeNull();
    });

    it('turns a line into an estimate with a click uncertainty', () => {
        const line = { a: { x: 200, y: 200 }, b: { x: 581, y: 200 } };
        expect(estimateMm(line, 0.1)).toBe(38.1);
        // ± mm/px · e·√2 · (1 + L/R) = 0.1 · 2·1.414 · (1 + 381/856)
        expect(estimateUncertaintyMm(line, card)).toBeCloseTo(0.1 * 2 * Math.SQRT2 * (1 + 381 / 856), 2);
    });

    it('collects the latest estimate per assigned dimension, ignoring unassigned lines and unscaled photos', () => {
        const lines = [
            { id: 'l1', kind: 'diameter' as const, param: 'diameter_mm' as const, a: { x: 0, y: 0 }, b: { x: 370, y: 0 } },
            { id: 'l2', kind: 'diameter' as const, param: 'diameter_mm' as const, a: { x: 0, y: 0 }, b: { x: 381, y: 0 } },
            { id: 'l3', kind: 'length' as const, param: null, a: { x: 0, y: 0 }, b: { x: 220, y: 0 } },
        ];
        const est = photoEstimates({ reference: card, lines });
        expect([...est.keys()]).toEqual(['diameter_mm']);
        expect(est.get('diameter_mm')!.mm).toBe(38.1);
        expect(photoEstimates({ reference: null, lines }).size).toBe(0);
    });
});

describe('caliper readings', () => {
    it('normalizes mm and inches to mm at 0.01 mm', () => {
        expect(toMm(38.1, 'mm')).toBe(38.1);
        expect(toMm(1.5, 'in')).toBe(38.1);
        expect(toMm(0.236, 'in')).toBe(5.99);
        expect(toMm(12.3456, 'mm')).toBe(12.35);
        expect(() => toMm(0, 'mm')).toThrow(RangeError);
        expect(() => toMm(Number.NaN, 'in')).toThrow(RangeError);
        expect(fromMm(38.1, 'in')).toBe(1.5);
    });

    it('parses what buyers type', () => {
        expect(parseReading('38.1', 'mm')).toEqual({ value: 38.1, unit: 'mm', mm: 38.1 });
        expect(parseReading('38,1 mm', 'in')).toEqual({ value: 38.1, unit: 'mm', mm: 38.1 });
        expect(parseReading('1.5 in', 'mm')).toEqual({ value: 1.5, unit: 'in', mm: 38.1 });
        expect(parseReading('1-1/2"', 'mm')).toEqual({ value: 1.5, unit: 'in', mm: 38.1 });
        expect(parseReading('1/4', 'in')?.mm).toBe(6.35);
        expect(parseReading('abc', 'mm')).toBeNull();
        expect(parseReading('-3', 'mm')).toBeNull();
        expect(parseReading('0', 'mm')).toBeNull();
    });

    it(`warns when the photo estimate is more than ${DELTA_WARN_PCT}% off the reading`, () => {
        expect(deltaPct(42, 38.1)).toBe(10.2);
        expect(deltaWarning(42, 38.1)).toBe(true);
        expect(deltaWarning(41.9, 38.1)).toBe(false); // 9.97%
        expect(deltaWarning(null, 38.1)).toBe(false);
        expect(deltaWarning(40, null)).toBe(false);
    });
});

describe('keyboard and numeric editing', () => {
    const size = { width: 1000, height: 800 };
    it('nudges a handle 1 px (10 px with Shift) and clamps to the photo', () => {
        expect(nudge({ x: 5, y: 5 }, 'ArrowRight', false, size)).toEqual({ x: 6, y: 5 });
        expect(nudge({ x: 5, y: 5 }, 'ArrowUp', true, size)).toEqual({ x: 5, y: 0 });
        expect(nudge({ x: 995, y: 5 }, 'ArrowRight', true, size)).toEqual({ x: 1000, y: 5 });
        expect(nudge({ x: 5, y: 5 }, 'Enter', false, size)).toBeNull();
    });

    it('typing a length moves the end point along the line', () => {
        const line = { a: { x: 100, y: 100 }, b: { x: 400, y: 500 } }; // 500 px
        const set = setLineLength(line, 25, 0.1, size);
        expect(distancePx(set.a, set.b)).toBeCloseTo(250);
        expect(set.a).toEqual(line.a);
        expect(set.b.x).toBeCloseTo(250);
        expect(set.b.y).toBeCloseTo(300);
        const flat = setLineLength({ a: { x: 10, y: 10 }, b: { x: 10, y: 10 } }, 5, 0.1, size);
        expect(flat.b).toEqual({ x: 60, y: 10 });
    });
});
