/**
 * Inspection plan generation (workflow 05 · Quality): derived from the part's
 * real DFM features + the buyer's configuration. Pure (no I/O) so it is unit-testable.
 *
 * Checks (ids are stable within a plan):
 *   chk_bbox_w / chk_bbox_h     DIMENSION      overall size, critical
 *   chk_hole_<n>                HOLE_DIAMETER  one per distinct circular hole diameter (max 6), critical
 *   chk_bend_<n>                BEND_ANGLE     one per distinct bend angle when bending is ordered, critical
 *   chk_flatness                FLATNESS       deviation on a surface plate (unbent parts)
 *   chk_threads                 VISUAL         go/no-go thread gauge when tapping is ordered, critical
 *   chk_finish                  FINISH         finish coverage when a finish is ordered, critical
 *   chk_edges                   VISUAL         burrs / dross / scratches
 *   chk_count                   COUNT          quantity shipped, critical
 *
 * Tolerances are R1 defaults (uncalibrated): laser profile ±0.13 mm (±0.005") up to
 * 300 mm, ±0.25 mm beyond; holes ±0.13 mm; bends ±1°; flatness 0.5 % of the longest side (min 0.5 mm).
 */
import type { InspectionCheck } from '../../contracts/shop';
import type { InspectionCheckKind } from '../../contracts/enums';
import type { PartFeatures } from '../../contracts/parts';

export const MEASURED_CHECK_KINDS: ReadonlySet<InspectionCheckKind> = new Set(['DIMENSION', 'HOLE_DIAMETER', 'FLATNESS', 'BEND_ANGLE']);

export const SERVICE_IDS = {
    bending: 'svc_bending',
    tapping: 'svc_tapping',
    deburr: 'svc_deburr',
} as const;

export type InspectionPlanInput = {
    features: Pick<PartFeatures, 'bboxWidthMm' | 'bboxHeightMm' | 'holes' | 'bendLines' | 'bendCount'>;
    thicknessMm: number;
    quantity: number;
    serviceIds: string[];
    finish: { name: string; colorName: string | null } | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function profileTolMm(nominalMm: number): number {
    return nominalMm <= 300 ? 0.13 : 0.25;
}

/** R1 sampling: first-article min(qty, 3) plus every 25th part. */
export function sampleSizeFor(quantity: number): number {
    return Math.max(1, Math.min(quantity, 3 + Math.floor(quantity / 25)));
}

export function buildInspectionChecks(input: InspectionPlanInput): InspectionCheck[] {
    const { features, quantity, serviceIds } = input;
    const checks: InspectionCheck[] = [];
    const bendingOrdered = serviceIds.includes(SERVICE_IDS.bending) && features.bendCount > 0;

    const w = round2(features.bboxWidthMm);
    const h = round2(features.bboxHeightMm);
    checks.push({
        id: 'chk_bbox_w',
        kind: 'DIMENSION',
        label: `Overall width ${w} mm${bendingOrdered ? ' (flat pattern, before bending)' : ''}`,
        nominalMm: w,
        tolPlusMm: profileTolMm(w),
        tolMinusMm: profileTolMm(w),
        critical: !bendingOrdered,
        instructions: bendingOrdered
            ? 'Measure the flat blank across its widest point with calipers before bending (first article).'
            : 'Measure across the widest point with calibrated calipers.',
    });
    checks.push({
        id: 'chk_bbox_h',
        kind: 'DIMENSION',
        label: `Overall height ${h} mm${bendingOrdered ? ' (flat pattern, before bending)' : ''}`,
        nominalMm: h,
        tolPlusMm: profileTolMm(h),
        tolMinusMm: profileTolMm(h),
        critical: !bendingOrdered,
        instructions: bendingOrdered
            ? 'Measure the flat blank across its tallest point with calipers before bending (first article).'
            : 'Measure across the tallest point with calibrated calipers.',
    });

    // Distinct circular hole diameters (tapped holes are verified with a gauge instead).
    const tapping = serviceIds.includes(SERVICE_IDS.tapping);
    const byDiameter = new Map<number, number>();
    for (const hole of features.holes) {
        if (!hole.circular) continue;
        const d = round2(hole.diameterMm);
        byDiameter.set(d, (byDiameter.get(d) ?? 0) + 1);
    }
    const diameters = [...byDiameter.entries()].sort((a, b) => a[0] - b[0]).slice(0, 6);
    diameters.forEach(([d, count], i) => {
        checks.push({
            id: `chk_hole_${i + 1}`,
            kind: 'HOLE_DIAMETER',
            label: `Hole Ø ${d} mm (×${count} per part)`,
            nominalMm: d,
            tolPlusMm: 0.13,
            tolMinusMm: 0.13,
            critical: true,
            instructions: tapping
                ? 'Measure an untapped hole of this size with a pin gauge or calipers (tapped holes are checked with the thread gauge).'
                : 'Measure with a pin gauge or calipers; record the smallest reading.',
        });
    });

    if (bendingOrdered) {
        const angles = new Map<number, number>();
        for (const b of features.bendLines) {
            const a = Math.round(b.angleDeg ?? 90);
            angles.set(a, (angles.get(a) ?? 0) + 1);
        }
        [...angles.entries()]
            .sort((a, b) => a[0] - b[0])
            .forEach(([angle, count], i) => {
                checks.push({
                    id: `chk_bend_${i + 1}`,
                    kind: 'BEND_ANGLE',
                    label: `Bend angle ${angle}° (×${count}) · value in degrees`,
                    nominalMm: angle,
                    tolPlusMm: 1,
                    tolMinusMm: 1,
                    critical: true,
                    instructions: 'Measure with a protractor or angle gauge; record degrees.',
                });
            });
    } else {
        const tol = round2(Math.max(0.5, 0.005 * Math.max(w, h)));
        checks.push({
            id: 'chk_flatness',
            kind: 'FLATNESS',
            label: `Flatness ≤ ${tol} mm`,
            nominalMm: 0,
            tolPlusMm: tol,
            tolMinusMm: 0,
            critical: false,
            instructions: 'Place the part on a surface plate and record the largest gap with a feeler gauge.',
        });
    }

    if (tapping) {
        checks.push({
            id: 'chk_threads',
            kind: 'VISUAL',
            label: 'Tapped holes accept go/no-go thread gauge',
            nominalMm: null,
            tolPlusMm: null,
            tolMinusMm: null,
            critical: true,
            instructions: 'Check every tapped hole on the sampled parts with the go/no-go gauge for the ordered thread.',
        });
    }

    if (input.finish) {
        const name = input.finish.colorName ? `${input.finish.name} (${input.finish.colorName})` : input.finish.name;
        checks.push({
            id: 'chk_finish',
            kind: 'FINISH',
            label: `Finish: ${name}`,
            nominalMm: null,
            tolPlusMm: null,
            tolMinusMm: null,
            critical: true,
            instructions: 'Uniform coverage and colour, no runs, bare spots, blisters or masking residue on visible faces.',
        });
    }

    checks.push({
        id: 'chk_edges',
        kind: 'VISUAL',
        label: serviceIds.includes(SERVICE_IDS.deburr) ? 'Edges deburred, no dross or scratches' : 'No dross, sharp burrs or deep scratches',
        nominalMm: null,
        tolPlusMm: null,
        tolMinusMm: null,
        critical: serviceIds.includes(SERVICE_IDS.deburr),
        instructions: `Inspect edges and faces under good light (thickness ${round2(input.thicknessMm)} mm stock).`,
    });

    checks.push({
        id: 'chk_count',
        kind: 'COUNT',
        label: `Quantity: ${quantity} parts`,
        nominalMm: null,
        tolPlusMm: null,
        tolMinusMm: null,
        critical: true,
        instructions: 'Count the parts going into the box.',
    });

    return checks;
}

/** True when `measured` lies within nominal - tolMinus .. nominal + tolPlus. */
export function withinTolerance(check: Pick<InspectionCheck, 'nominalMm' | 'tolPlusMm' | 'tolMinusMm'>, measured: number): boolean {
    if (check.nominalMm === null) return false;
    const eps = 1e-9;
    const hi = check.nominalMm + (check.tolPlusMm ?? 0);
    const lo = check.nominalMm - (check.tolMinusMm ?? 0);
    return measured <= hi + eps && measured >= lo - eps;
}
