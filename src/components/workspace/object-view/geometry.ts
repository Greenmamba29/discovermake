/**
 * Pure helpers for the Object View (600-3 / 300-2): units, bounding-box text, two-point
 * distance, GLB scale and camera fit. No React, no three.js: unit-tested directly and shared by
 * the 3D viewport and its text alternative.
 */

export type LengthUnit = 'mm' | 'in';
export type Vec3 = readonly [number, number, number];

export const MM_PER_INCH = 25.4;

export function convertLength(mm: number, unit: LengthUnit): number {
    return unit === 'in' ? mm / MM_PER_INCH : mm;
}

/** "120.0 mm" / "4.724 in". Millimetres to 0.1 mm, inches to 0.001 in (a thou). */
export function formatLength(mm: number, unit: LengthUnit): string {
    if (!Number.isFinite(mm)) return '—';
    const v = convertLength(mm, unit);
    return unit === 'in' ? `${v.toFixed(3)} in` : `${v.toFixed(1)} mm`;
}

/** "120.0 × 80.0 × 40.0 mm" */
export function formatBbox(bbox: Vec3, unit: LengthUnit): string {
    const digits = unit === 'in' ? 3 : 1;
    return `${bbox.map((v) => convertLength(v, unit).toFixed(digits)).join(' × ')} ${unit}`;
}

export type DimensionRow = { axis: 'X' | 'Y' | 'Z'; label: string; mm: number; text: string };

/** X/Y/Z rows (CAD axes: X width, Y depth, Z height) for the dimensions list. */
export function dimensionRows(bbox: Vec3, unit: LengthUnit): DimensionRow[] {
    const labels = ['Width', 'Depth', 'Height'] as const;
    return (['X', 'Y', 'Z'] as const).map((axis, i) => ({ axis, label: labels[i]!, mm: bbox[i]!, text: formatLength(bbox[i]!, unit) }));
}

/** One sentence for screen readers and the canvas label. */
export function dimensionSummary(bbox: Vec3, unit: LengthUnit): string {
    const [x, y, z] = dimensionRows(bbox, unit);
    return `Overall size ${x!.text} wide (X), ${y!.text} deep (Y), ${z!.text} tall (Z).`;
}

export function distance3(a: Vec3, b: Vec3): number {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * glTF is Y-up; CAD (CadQuery) is Z-up. The worker exports with Z mapped to glTF +Y and Y to
 * glTF -Z, so a glTF size [sx, sy, sz] is the CAD size [sx, sz, sy].
 */
export function gltfSizeToCad(size: Vec3): Vec3 {
    return [size[0], size[2], size[1]];
}

const CANDIDATE_SCALES = [1000, 1, 10, MM_PER_INCH] as const;

/**
 * Factor from GLB units to millimetres. glTF files are in metres (CadQuery converts mm to m on
 * export), so the default is 1000. When the CAD record's bounding box is known, pick the
 * candidate (m, mm, cm, in) that best matches it, so a file exported in mm still measures right.
 */
export function inferScaleToMm(meshMaxExtent: number, expectedMaxMm: number | null): number {
    if (!(meshMaxExtent > 0)) return 1000;
    if (!expectedMaxMm || !(expectedMaxMm > 0)) return 1000;
    let best: number = CANDIDATE_SCALES[0];
    let bestErr = Infinity;
    for (const s of CANDIDATE_SCALES) {
        const err = Math.abs(Math.log((meshMaxExtent * s) / expectedMaxMm));
        if (err < bestErr) {
            bestErr = err;
            best = s;
        }
    }
    return best;
}

/** Camera distance that fits a bounding sphere of `size` in a perspective view (with margin). */
export function fitCameraDistance(size: Vec3, fovDeg: number, aspect = 1, margin = 1.35): number {
    const radius = Math.hypot(size[0], size[1], size[2]) / 2 || 1;
    const vFov = (fovDeg * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(aspect, 1e-3));
    const fov = Math.min(vFov, hFov);
    return (radius / Math.sin(fov / 2)) * margin;
}

export function roundTo(v: number, step: number): number {
    return Math.round(v / step) * step;
}
