/**
 * Photo measurement math for Reconstruct (pure, client-safe; the server re-runs it).
 *
 * Scale: the buyer marks a reference object of known size in the photo, so
 *   mm/px = reference length (mm) / reference segment length (px)
 * and a measurement line of L px estimates L x mm/px millimetres. This is a single-plane
 * (orthographic) model: it is only right in the reference's plane with the camera square on to
 * it (see PERSPECTIVE_CAVEAT). Its click uncertainty is
 *   ± mm/px x (e √2) x (1 + L / R)    (e = endpoint error in px, L = line px, R = reference px)
 * from the two endpoints of the line and the two of the reference, to first order.
 *
 * Estimates only prefill: the caliper reading is what counts (see the confirmation rule).
 */
import { DELTA_WARN_PCT, type LengthUnit, type MeasurementLine, type PhotoMeasurements, type PixelPoint, type ReferenceMark } from '@/contracts/reconstruct';

export const MM_PER_INCH = 25.4;
/** The reference segment must be at least this long for a usable scale. */
export const MIN_REFERENCE_PX = 20;
/** Assumed endpoint placement error (px) for the uncertainty estimate. */
export const CLICK_ERROR_PX = 2;

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function distancePx(a: PixelPoint, b: PixelPoint): number {
    return Math.hypot(b.x - a.x, b.y - a.y);
}

/** mm per pixel from a marked reference, or null when the mark is too short to trust. */
export function scaleFromReference(ref: Pick<ReferenceMark, 'a' | 'b' | 'lengthMm'> | null | undefined): number | null {
    if (!ref || !(ref.lengthMm > 0)) return null;
    const px = distancePx(ref.a, ref.b);
    if (px < MIN_REFERENCE_PX) return null;
    return ref.lengthMm / px;
}

export function estimateMm(line: Pick<MeasurementLine, 'a' | 'b'>, mmPerPx: number): number {
    return round2(distancePx(line.a, line.b) * mmPerPx);
}

export function estimateUncertaintyMm(line: Pick<MeasurementLine, 'a' | 'b'>, ref: Pick<ReferenceMark, 'a' | 'b' | 'lengthMm'>, clickErrorPx = CLICK_ERROR_PX): number | null {
    const mmPerPx = scaleFromReference(ref);
    if (mmPerPx === null) return null;
    const l = distancePx(line.a, line.b);
    const r = distancePx(ref.a, ref.b);
    return round2(mmPerPx * clickErrorPx * Math.SQRT2 * (1 + l / r));
}

/** Estimates per dimension param from one photo's assigned lines (later lines win). */
export function photoEstimates(photo: Pick<PhotoMeasurements, 'reference' | 'lines'>): Map<string, { mm: number; uncertaintyMm: number | null }> {
    const out = new Map<string, { mm: number; uncertaintyMm: number | null }>();
    const mmPerPx = scaleFromReference(photo.reference);
    if (mmPerPx === null || !photo.reference) return out;
    for (const line of photo.lines) {
        if (!line.param) continue;
        out.set(line.param, { mm: estimateMm(line, mmPerPx), uncertaintyMm: estimateUncertaintyMm(line, photo.reference) });
    }
    return out;
}

/** Normalize a typed caliper / ruler reading to millimetres at 0.01 mm resolution. */
export function toMm(value: number, unit: LengthUnit): number {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError('A reading must be a positive number');
    return round2(unit === 'in' ? value * MM_PER_INCH : value);
}

export function fromMm(mm: number, unit: LengthUnit): number {
    return unit === 'in' ? Math.round((mm / MM_PER_INCH) * 1000) / 1000 : round2(mm);
}

/**
 * Parse what a buyer types: "38.1", "38,1", "1.5 in", "1-1/2\"", "38.1 mm". Returns null when it
 * is not a positive length. A unit written in the text overrides `defaultUnit`.
 */
export function parseReading(text: string, defaultUnit: LengthUnit): { value: number; unit: LengthUnit; mm: number } | null {
    const t = text.trim().toLowerCase().replace(',', '.');
    const m = /^(\d+(?:\.\d+)?)(?:[\s-]+(\d+)\/(\d+))?\s*(mm|millimet(?:er|re)s?|in|inch(?:es)?|")?$/.exec(t) ?? /^(\d+)\/(\d+)\s*(in|inch(?:es)?|")?$/.exec(t);
    if (!m) return null;
    let value: number;
    let unitText: string | undefined;
    if (m.length === 4) {
        value = Number(m[1]) / Number(m[2]);
        unitText = m[3];
    } else {
        value = Number(m[1]) + (m[2] && m[3] ? Number(m[2]) / Number(m[3]) : 0);
        unitText = m[4];
    }
    if (!Number.isFinite(value) || value <= 0) return null;
    const unit: LengthUnit = unitText ? (unitText.startsWith('m') ? 'mm' : 'in') : defaultUnit;
    return { value, unit, mm: toMm(value, unit) };
}

/** |estimate - caliper| / caliper, percent (1 decimal). */
export function deltaPct(estimateMm: number, caliperMm: number): number {
    return Math.round((Math.abs(estimateMm - caliperMm) / caliperMm) * 1000) / 10;
}

export function deltaWarning(estimateMm: number | null, caliperMm: number | null): boolean {
    return estimateMm !== null && caliperMm !== null && deltaPct(estimateMm, caliperMm) > DELTA_WARN_PCT;
}

/** Arrow-key nudge of a handle: 1 px, 10 px with Shift, clamped to the image. */
export function nudge(p: PixelPoint, key: string, shift: boolean, size: { width: number; height: number }): PixelPoint | null {
    const step = shift ? 10 : 1;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const v = d[key];
    if (!v) return null;
    return { x: Math.min(size.width, Math.max(0, p.x + v[0])), y: Math.min(size.height, Math.max(0, p.y + v[1])) };
}

/**
 * Typing a length for a line moves its end point along the line so it measures `targetMm`
 * at this scale (the start point stays put; a zero-length line extends to the right).
 */
export function setLineLength<T extends Pick<MeasurementLine, 'a' | 'b'>>(line: T, targetMm: number, mmPerPx: number, size: { width: number; height: number }): T {
    const px = targetMm / mmPerPx;
    const len = distancePx(line.a, line.b);
    const ux = len > 0 ? (line.b.x - line.a.x) / len : 1;
    const uy = len > 0 ? (line.b.y - line.a.y) / len : 0;
    const b = { x: Math.min(size.width, Math.max(0, line.a.x + ux * px)), y: Math.min(size.height, Math.max(0, line.a.y + uy * px)) };
    return { ...line, b };
}
