/**
 * Print DFM (R6). Pure. Runs on the CAD spec's numbers (min wall, bridge span) and the
 * worker manifest's bounding box, never on a mesh guess.
 *
 *   min_wall_print     BLOCKING  thinnest wall < max(1.2 mm, material minimum)
 *   bridge_span        WARNING   bore ceiling wider than the material's unsupported bridge
 *                                 (prints with support inside the bore; post-processing removes it)
 *   build_volume       WARNING   no active partner printer fits the bounding box (quote goes to REVIEW)
 *   orientation note   WARNING   (only when the part is taller than wide: tip-over risk, brim added)
 */
import type { DfmResult, DfmViolation } from '../../../contracts/parts';
import type { PrintGeometry, PrintMaterialPricing } from './pricing';

export const PRINT_DFM_VERSION = 'print-dfm-2026.10-r6';
/** Stage 5 brief: DFM passes only with every wall at least this thick. */
export const PRINT_MIN_WALL_MM = 1.2;

export function runPrintDfm(input: {
    geometry: PrintGeometry;
    material: Pick<PrintMaterialPricing, 'name' | 'process' | 'minWallMm' | 'maxBridgeMm'>;
    /** false when no active partner printer fits the part. */
    fits: boolean;
    checkedAt: Date;
    materialId: string | null;
    profileId: string | null;
}): DfmResult {
    const { geometry: g, material: m } = input;
    const violations: DfmViolation[] = [];
    const minWall = Math.max(PRINT_MIN_WALL_MM, m.minWallMm);
    if (g.minWallMm < minWall - 1e-9) {
        violations.push({
            ruleId: 'min_wall_print',
            severity: 'BLOCKING',
            message: `The thinnest wall is ${g.minWallMm.toFixed(2)} mm; ${m.name} needs at least ${minWall.toFixed(1)} mm to print reliably. Use a smaller bore or measure a larger part.`,
            measuredMm: g.minWallMm,
            thresholdMm: minWall,
            location: null,
            count: 1,
            fix: { kind: 'WIDEN_FEATURE', label: `Make every wall at least ${minWall.toFixed(1)} mm`, params: { minWallMm: minWall } },
        });
    }
    if (g.bridgeSpanMm > m.maxBridgeMm + 1e-9) {
        violations.push({
            ruleId: 'bridge_span',
            severity: 'WARNING',
            message: `The bore ceiling bridges ${g.bridgeSpanMm.toFixed(1)} mm (more than ${m.maxBridgeMm} mm): it prints with support inside the bore, which is removed by hand.`,
            measuredMm: g.bridgeSpanMm,
            thresholdMm: m.maxBridgeMm,
            location: null,
            count: 1,
            fix: null,
        });
    }
    if (!input.fits) {
        violations.push({
            ruleId: 'build_volume',
            severity: 'WARNING',
            message: `No partner printer for ${m.name} fits a ${g.bboxMm.map((v) => v.toFixed(1)).join(' x ')} mm part right now. A partner will confirm the price (1 business day).`,
            measuredMm: Math.max(...g.bboxMm),
            thresholdMm: null,
            location: null,
            count: 1,
            fix: { kind: 'CONTACT_SUPPORT', label: 'Ask a partner to quote it' },
        });
    }
    const [x, y, z] = g.bboxMm;
    if (z > 2.5 * Math.min(x, y)) {
        violations.push({
            ruleId: 'tall_part',
            severity: 'WARNING',
            message: 'The part is tall and narrow: it prints with a brim so it cannot tip over.',
            measuredMm: z,
            thresholdMm: 2.5 * Math.min(x, y),
            location: null,
            count: 1,
            fix: null,
        });
    }
    const blocking = violations.some((v) => v.severity === 'BLOCKING');
    const warnings = violations.filter((v) => v.severity === 'WARNING').length;
    const score = Math.max(0, Math.min(100, 100 - (blocking ? 45 : 0) - 6 * warnings));
    return {
        rulesetVersion: PRINT_DFM_VERSION,
        makeabilityScore: score,
        blocking,
        violations,
        materialId: input.materialId,
        thicknessOptionId: input.profileId,
        checkedAt: input.checkedAt.toISOString(),
    };
}
