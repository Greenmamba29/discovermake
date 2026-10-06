/**
 * Deterministic, versioned DFM engine (workflow 02 "DFM rules").
 *
 * Rules are data: severities, weights and parameters come from the
 * `dfm_rulesets.rules` jsonb row for the part's `ruleset_version`, merged over
 * the code defaults below (which mirror the R1 seed). Thresholds that depend on
 * material and thickness come from the catalog rows (`materials.*_ratio`,
 * `thickness_options.*`).
 *
 * Two passes:
 * - geometry-only (`runGeometryDfm`) at analyze time: open contours, size, text...
 * - material-specific (`runMaterialDfm`) at quote time: holes, webs, edges, bends, services.
 * Pure module: no I/O.
 */
import type { DfmFix, DfmResult, DfmViolation, PartFeatures, PartPreview } from '../../contracts/parts';
import type { DfmSeverity } from '../../contracts/enums';

export type RuleId =
    | 'open_contour'
    | 'no_cut_geometry'
    | 'part_size_max'
    | 'part_size_min'
    | 'min_hole_diameter'
    | 'min_feature'
    | 'hole_to_edge'
    | 'bend_flange_min'
    | 'hole_to_bend'
    | 'bend_not_supported'
    | 'bend_lines_missing'
    | 'text_entities'
    | 'multiple_outer_contours'
    | 'service_feature_count'
    | 'tap_drill_mismatch';

export type RuleConfig = { severity: DfmSeverity; [param: string]: unknown };

export type DfmRuleset = {
    version: string;
    weights: Record<DfmSeverity, number>;
    rules: Record<RuleId, RuleConfig>;
};

/** Code defaults (mirror the R1 seed `R1_DFM_RULES`, plus rules added by the quote engine). */
export const DEFAULT_DFM_RULES: Omit<DfmRuleset, 'version'> = {
    weights: { BLOCKING: 30, WARNING: 8 },
    rules: {
        open_contour: { severity: 'BLOCKING', closeToleranceMm: 0.01 },
        no_cut_geometry: { severity: 'BLOCKING' },
        part_size_max: { severity: 'BLOCKING' },
        part_size_min: { severity: 'BLOCKING', minMm: 10 },
        min_hole_diameter: { severity: 'BLOCKING' },
        min_feature: { severity: 'BLOCKING' },
        hole_to_edge: { severity: 'WARNING', blockingBelowRatio: 0.5 },
        bend_flange_min: { severity: 'BLOCKING' },
        hole_to_bend: { severity: 'WARNING', ratio: 2.5, addBendRadius: true },
        bend_not_supported: { severity: 'BLOCKING' },
        bend_lines_missing: { severity: 'BLOCKING' },
        text_entities: { severity: 'WARNING' },
        multiple_outer_contours: { severity: 'WARNING' },
        service_feature_count: { severity: 'BLOCKING' },
        tap_drill_mismatch: { severity: 'WARNING', toleranceMm: 0.15 },
    },
};

/** Merge a stored ruleset row over the defaults. Unknown keys are ignored. */
export function resolveRuleset(version: string, stored: Record<string, unknown> | null | undefined): DfmRuleset {
    const weightsIn = (stored?.weights ?? {}) as Partial<Record<DfmSeverity, number>>;
    const rulesIn = (stored?.rules ?? {}) as Partial<Record<string, Partial<RuleConfig>>>;
    const rules = { ...DEFAULT_DFM_RULES.rules };
    for (const id of Object.keys(rules) as RuleId[]) {
        const r = rulesIn[id];
        if (!r) continue;
        const severity = r.severity === 'BLOCKING' || r.severity === 'WARNING' ? r.severity : rules[id].severity;
        rules[id] = { ...rules[id], ...r, severity };
    }
    return {
        version,
        weights: {
            BLOCKING: typeof weightsIn.BLOCKING === 'number' ? weightsIn.BLOCKING : DEFAULT_DFM_RULES.weights.BLOCKING,
            WARNING: typeof weightsIn.WARNING === 'number' ? weightsIn.WARNING : DEFAULT_DFM_RULES.weights.WARNING,
        },
        rules,
    };
}

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const r2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => `${r2(n)} mm`;

function violation(
    ruleset: DfmRuleset,
    ruleId: RuleId,
    v: { message: string; measuredMm?: number | null; thresholdMm?: number | null; location?: [number, number] | null; count?: number; fix?: DfmFix | null; severity?: DfmSeverity },
): DfmViolation {
    return {
        ruleId,
        severity: v.severity ?? ruleset.rules[ruleId].severity,
        message: v.message,
        measuredMm: v.measuredMm != null ? r2(v.measuredMm) : null,
        thresholdMm: v.thresholdMm != null ? r2(v.thresholdMm) : null,
        location: v.location ?? null,
        count: Math.max(1, v.count ?? 1),
        fix: v.fix ?? null,
    };
}

// ---------------------------------------------------------------------------
// Geometry-only pass
// ---------------------------------------------------------------------------

export type SizeLimit = { widthMm: number; heightMm: number };

export function fitsWithin(w: number, h: number, limit: SizeLimit): boolean {
    return (w <= limit.widthMm && h <= limit.heightMm) || (w <= limit.heightMm && h <= limit.widthMm);
}

export type GeometryDfmContext = {
    ruleset: DfmRuleset;
    /** Every active catalog size limit (thickness option max part size); empty = skip the size check. */
    catalogLimits: SizeLimit[];
    openEnds: [number, number][];
};

export function runGeometryDfm(f: PartFeatures, ctx: GeometryDfmContext): DfmViolation[] {
    const { ruleset } = ctx;
    const out: DfmViolation[] = [];
    if (f.openContourCount > 0) {
        out.push(
            violation(ruleset, 'open_contour', {
                message: `${f.openContourCount} contour${f.openContourCount > 1 ? 's are' : ' is'} not closed (gap larger than ${num(ruleset.rules.open_contour.closeToleranceMm, 0.01)} mm). The laser needs closed outlines.`,
                location: ctx.openEnds[0] ?? null,
                count: f.openContourCount,
                fix: { kind: 'CLOSE_CONTOUR', label: 'Close the highlighted gap in your CAD tool (join/PEDIT) and re-upload' },
            }),
        );
    }
    if (f.outerContourCount === 0) {
        out.push(
            violation(ruleset, 'no_cut_geometry', {
                message: 'No closed outline was found to cut.',
                fix: { kind: 'CONTACT_SUPPORT', label: 'Check that the part outline is on a visible layer and re-upload' },
            }),
        );
    }
    if (f.outerContourCount > 1) {
        out.push(
            violation(ruleset, 'multiple_outer_contours', {
                message: `This file contains ${f.outerContourCount} separate parts. They are quoted as one set; quantity is the number of sets.`,
                count: f.outerContourCount,
                fix: { kind: 'SPLIT_PART', label: 'Upload each part as its own file to quote them separately' },
            }),
        );
    }
    const minMm = num(ruleset.rules.part_size_min.minMm, 10);
    if (f.outerContourCount > 0 && (f.bboxWidthMm < minMm || f.bboxHeightMm < minMm)) {
        out.push(
            violation(ruleset, 'part_size_min', {
                message: `Parts must be at least ${minMm} mm in each direction (this one is ${fmt(f.bboxWidthMm)} × ${fmt(f.bboxHeightMm)}).`,
                measuredMm: Math.min(f.bboxWidthMm, f.bboxHeightMm),
                thresholdMm: minMm,
                fix: { kind: 'CONTACT_SUPPORT', label: 'Enlarge the part or add a carrier tab, then re-upload' },
            }),
        );
    }
    if (ctx.catalogLimits.length && f.outerContourCount > 0 && !ctx.catalogLimits.some((l) => fitsWithin(f.bboxWidthMm, f.bboxHeightMm, l))) {
        const biggest = ctx.catalogLimits.reduce((p, q) => (q.widthMm * q.heightMm > p.widthMm * p.heightMm ? q : p));
        out.push(
            violation(ruleset, 'part_size_max', {
                message: `The part (${fmt(f.bboxWidthMm)} × ${fmt(f.bboxHeightMm)}) is larger than any material we cut (max ${fmt(biggest.widthMm)} × ${fmt(biggest.heightMm)}).`,
                measuredMm: Math.max(f.bboxWidthMm, f.bboxHeightMm),
                thresholdMm: Math.max(biggest.widthMm, biggest.heightMm),
                fix: { kind: 'SPLIT_PART', label: 'Split the part into smaller pieces that fit the bed', params: { maxWidthMm: biggest.widthMm, maxHeightMm: biggest.heightMm } },
            }),
        );
    }
    if (f.textEntityCount > 0) {
        out.push(
            violation(ruleset, 'text_entities', {
                message: `${f.textEntityCount} text object${f.textEntityCount > 1 ? 's' : ''} will not be cut. Convert text to outlines (with bridges or a stencil font) if you want it cut.`,
                count: f.textEntityCount,
                fix: { kind: 'CONVERT_TEXT', label: 'Explode text to outlines using a stencil font' },
            }),
        );
    }
    return out;
}

// ---------------------------------------------------------------------------
// Material-specific pass
// ---------------------------------------------------------------------------

export type DfmMaterial = {
    name: string;
    minHoleRatio: number;
    minFeatureRatio: number;
    holeToEdgeRatio: number;
    minHoleFloorMm: number;
    minFeatureFloorMm: number;
};

export type DfmThickness = {
    id: string;
    label: string;
    thicknessMm: number;
    bendable: boolean;
    minBendRadiusMm: number | null;
    minFlangeRatio: number;
    maxPartWidthMm: number;
    maxPartHeightMm: number;
};

export type DfmServiceSelection = {
    serviceId: string;
    slug: string;
    name: string;
    pricingUnit: 'PER_FEATURE' | 'PER_PART' | 'PER_AREA_FT2';
    featureCount: number | null;
    options: Record<string, string>;
};

export type MaterialDfmContext = {
    ruleset: DfmRuleset;
    material: DfmMaterial;
    thickness: DfmThickness;
    /** Other active thickness options of the same material (for CHANGE_THICKNESS suggestions). */
    alternatives?: DfmThickness[];
    /** Effective size limit (thickness option max, capped by the shop bed). */
    sizeLimit: SizeLimit;
    bendingSelected: boolean;
    services: DfmServiceSelection[];
    preview: PartPreview | null;
};

export type DfmThresholds = {
    minHoleDiameterMm: number;
    minFeatureMm: number;
    minHoleToEdgeMm: number;
    holeToEdgeBlockingMm: number;
    minFlangeMm: number;
    minHoleToBendMm: number;
};

export function dfmThresholds(material: DfmMaterial, thickness: DfmThickness, ruleset: DfmRuleset): DfmThresholds {
    const t = thickness.thicknessMm;
    const holeToEdge = material.holeToEdgeRatio * t;
    const bendCfg = ruleset.rules.hole_to_bend;
    return {
        minHoleDiameterMm: r2(Math.max(material.minHoleRatio * t, material.minHoleFloorMm)),
        minFeatureMm: r2(Math.max(material.minFeatureRatio * t, material.minFeatureFloorMm)),
        minHoleToEdgeMm: r2(holeToEdge),
        holeToEdgeBlockingMm: r2(num(ruleset.rules.hole_to_edge.blockingBelowRatio, 0.5) * t),
        minFlangeMm: r2(thickness.minFlangeRatio * t),
        minHoleToBendMm: r2(num(bendCfg.ratio, 2.5) * t + (bendCfg.addBendRadius === false ? 0 : (thickness.minBendRadiusMm ?? t))),
    };
}

/** Tap drill diameters (mm) for the threads offered by the tapping service. */
export const TAP_DRILL_MM: Record<string, number> = {
    M3: 2.5,
    M4: 3.3,
    M5: 4.2,
    M6: 5.0,
    '#4-40': 2.26,
    '#6-32': 2.71,
    '#8-32': 3.45,
    '#10-24': 3.8,
    '#10-32': 4.04,
    '1/4-20': 5.11,
};

type P = [number, number];

function bendGeometry(from: P, to: P) {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const len = Math.hypot(dx, dy) || 1;
    return { u: [dx / len, dy / len] as P, n: [-dy / len, dx / len] as P, len };
}

/** Flat flange lengths on each side of a bend line, from the outer outline. */
export function flangeLengths(from: P, to: P, outer: P[][]): [number, number] {
    const { n } = bendGeometry(from, to);
    let pos = 0;
    let neg = 0;
    for (const poly of outer) {
        for (const p of poly) {
            const s = (p[0] - from[0]) * n[0] + (p[1] - from[1]) * n[1];
            if (s > pos) pos = s;
            if (-s > neg) neg = -s;
        }
    }
    return [pos, neg];
}

export function runMaterialDfm(f: PartFeatures, ctx: MaterialDfmContext): DfmViolation[] {
    const { ruleset, material, thickness } = ctx;
    const th = dfmThresholds(material, thickness, ruleset);
    const out: DfmViolation[] = [];
    const t = thickness.thicknessMm;

    if (f.outerContourCount > 0 && !fitsWithin(f.bboxWidthMm, f.bboxHeightMm, ctx.sizeLimit)) {
        out.push(
            violation(ruleset, 'part_size_max', {
                message: `The part (${fmt(f.bboxWidthMm)} × ${fmt(f.bboxHeightMm)}) is larger than the ${fmt(ctx.sizeLimit.widthMm)} × ${fmt(ctx.sizeLimit.heightMm)} maximum for ${material.name} ${thickness.label}.`,
                measuredMm: Math.max(f.bboxWidthMm, f.bboxHeightMm),
                thresholdMm: Math.max(ctx.sizeLimit.widthMm, ctx.sizeLimit.heightMm),
                fix: { kind: 'SPLIT_PART', label: 'Split the part or choose a material with a larger sheet', params: { maxWidthMm: ctx.sizeLimit.widthMm, maxHeightMm: ctx.sizeLimit.heightMm } },
            }),
        );
    }

    // Holes smaller than the material/thickness minimum.
    const small = f.holes.filter((h) => h.diameterMm < th.minHoleDiameterMm - 1e-9);
    if (small.length) {
        const worst = small.reduce((p, q) => (q.diameterMm < p.diameterMm ? q : p));
        const thinner = (ctx.alternatives ?? [])
            .filter((a) => a.id !== thickness.id && a.thicknessMm < t)
            .filter((a) => Math.max(material.minHoleRatio * a.thicknessMm, material.minHoleFloorMm) <= worst.diameterMm)
            .sort((p, q) => q.thicknessMm - p.thicknessMm)[0];
        out.push(
            violation(ruleset, 'min_hole_diameter', {
                message: `${small.length} hole${small.length > 1 ? 's are' : ' is'} smaller than ${fmt(th.minHoleDiameterMm)}, the minimum for ${material.name} ${thickness.label} (smallest: ${fmt(worst.diameterMm)}).`,
                measuredMm: worst.diameterMm,
                thresholdMm: th.minHoleDiameterMm,
                location: worst.center,
                count: small.length,
                fix: thinner
                    ? { kind: 'CHANGE_THICKNESS', label: `Switch to ${thinner.label}, or enlarge holes to ${fmt(th.minHoleDiameterMm)}`, params: { thicknessOptionId: thinner.id, minDiameterMm: th.minHoleDiameterMm } }
                    : { kind: 'ENLARGE_HOLE', label: `Enlarge holes to at least ${fmt(th.minHoleDiameterMm)} (or drill them after cutting)`, params: { minDiameterMm: th.minHoleDiameterMm } },
            }),
        );
    }

    // Narrow webs / tabs.
    if (f.smallestFeatureMm != null && f.smallestFeatureMm < th.minFeatureMm - 1e-9) {
        out.push(
            violation(ruleset, 'min_feature', {
                message: `A web or tab is ${fmt(f.smallestFeatureMm)} wide; ${material.name} ${thickness.label} needs at least ${fmt(th.minFeatureMm)} or it may warp or burn away.`,
                measuredMm: f.smallestFeatureMm,
                thresholdMm: th.minFeatureMm,
                fix: { kind: 'WIDEN_FEATURE', label: `Widen narrow webs to at least ${fmt(th.minFeatureMm)}`, params: { minWidthMm: th.minFeatureMm } },
            }),
        );
    }

    // Holes too close to the outer edge.
    const close = f.holes.filter((h) => h.edgeDistanceMm < th.minHoleToEdgeMm - 1e-9);
    if (close.length) {
        const worst = close.reduce((p, q) => (q.edgeDistanceMm < p.edgeDistanceMm ? q : p));
        const blocking = worst.edgeDistanceMm < th.holeToEdgeBlockingMm - 1e-9;
        out.push(
            violation(ruleset, 'hole_to_edge', {
                severity: blocking ? 'BLOCKING' : ruleset.rules.hole_to_edge.severity,
                message: blocking
                    ? `A hole is only ${fmt(worst.edgeDistanceMm)} from the edge; below ${fmt(th.holeToEdgeBlockingMm)} the edge will tear out in ${thickness.label}.`
                    : `${close.length} hole${close.length > 1 ? 's are' : ' is'} closer than ${fmt(th.minHoleToEdgeMm)} to the edge (closest: ${fmt(worst.edgeDistanceMm)}). Expect a slight bulge at the edge.`,
                measuredMm: worst.edgeDistanceMm,
                thresholdMm: blocking ? th.holeToEdgeBlockingMm : th.minHoleToEdgeMm,
                location: worst.center,
                count: close.length,
                fix: { kind: 'MOVE_HOLE', label: `Move holes at least ${fmt(th.minHoleToEdgeMm)} from the edge`, params: { minEdgeDistanceMm: th.minHoleToEdgeMm } },
            }),
        );
    }

    // Bending.
    const hasBends = f.bendCount > 0;
    if (ctx.bendingSelected && !thickness.bendable) {
        const bendable = (ctx.alternatives ?? []).filter((a) => a.bendable).sort((p, q) => Math.abs(p.thicknessMm - t) - Math.abs(q.thicknessMm - t))[0];
        out.push(
            violation(ruleset, 'bend_not_supported', {
                message: `${material.name} ${thickness.label} cannot be bent.`,
                fix: bendable
                    ? { kind: 'CHANGE_THICKNESS', label: `Switch to ${bendable.label} (bendable)`, params: { thicknessOptionId: bendable.id } }
                    : { kind: 'CHANGE_MATERIAL', label: 'Choose a bendable material such as aluminum 5052 or mild steel' },
            }),
        );
    } else if (hasBends && !ctx.bendingSelected) {
        out.push(
            violation(ruleset, 'bend_not_supported', {
                message: `The file has ${f.bendCount} bend line${f.bendCount > 1 ? 's' : ''} but bending is not selected.`,
                count: f.bendCount,
                fix: { kind: 'CONTACT_SUPPORT', label: 'Add press brake bending, or remove the BEND layer to order flat parts', params: { addServiceId: 'svc_bending' } },
            }),
        );
    }
    if (ctx.bendingSelected && !hasBends) {
        out.push(
            violation(ruleset, 'bend_lines_missing', {
                message: 'Bending is selected but the file has no bend lines. Draw them as lines on a layer named "BEND".',
                fix: { kind: 'CONTACT_SUPPORT', label: 'Add bend lines on a layer named BEND and re-upload, or remove bending' },
            }),
        );
    }
    if (hasBends && ctx.bendingSelected && thickness.bendable) {
        const outer = ctx.preview?.outer ?? [];
        let shortCount = 0;
        let worst: { len: number; at: P } | null = null;
        if (outer.length) {
            for (const b of f.bendLines) {
                const [a, c] = flangeLengths(b.from, b.to, outer);
                const len = Math.min(a, c);
                if (len < th.minFlangeMm - 1e-9) {
                    shortCount++;
                    if (!worst || len < worst.len) worst = { len, at: [(b.from[0] + b.to[0]) / 2, (b.from[1] + b.to[1]) / 2] };
                }
            }
        }
        if (worst) {
            out.push(
                violation(ruleset, 'bend_flange_min', {
                    message: `A flange is ${fmt(worst.len)} long; the press brake needs at least ${fmt(th.minFlangeMm)} (${thickness.minFlangeRatio}× thickness).`,
                    measuredMm: worst.len,
                    thresholdMm: th.minFlangeMm,
                    location: worst.at,
                    count: shortCount,
                    fix: { kind: 'EXTEND_FLANGE', label: `Extend flanges to at least ${fmt(th.minFlangeMm)}`, params: { minFlangeMm: th.minFlangeMm } },
                }),
            );
        }
        // Holes too close to a bend line distort when bent.
        const near: { d: number; at: P }[] = [];
        for (const h of f.holes) {
            const r = h.diameterMm / 2;
            let best = Infinity;
            for (const b of f.bendLines) {
                const g = bendGeometry(b.from, b.to);
                const rel: P = [h.center[0] - b.from[0], h.center[1] - b.from[1]];
                const along = rel[0] * g.u[0] + rel[1] * g.u[1];
                if (along < -r || along > g.len + r) continue;
                const d = Math.abs(rel[0] * g.n[0] + rel[1] * g.n[1]) - r;
                if (d < best) best = d;
            }
            if (best < th.minHoleToBendMm - 1e-9) near.push({ d: Math.max(0, best), at: h.center });
        }
        if (near.length) {
            const w = near.reduce((p, q) => (q.d < p.d ? q : p));
            out.push(
                violation(ruleset, 'hole_to_bend', {
                    message: `${near.length} hole${near.length > 1 ? 's are' : ' is'} within ${fmt(th.minHoleToBendMm)} of a bend line (closest: ${fmt(w.d)}) and will distort when bent.`,
                    measuredMm: w.d,
                    thresholdMm: th.minHoleToBendMm,
                    location: w.at,
                    count: near.length,
                    fix: { kind: 'MOVE_HOLE', label: `Move holes at least ${fmt(th.minHoleToBendMm)} from bend lines or add bend relief`, params: { minDistanceMm: th.minHoleToBendMm } },
                }),
            );
        }
    }

    // Per-feature hole services (tapping, countersinking, PEM): enough holes, right size.
    const holeCount = f.holes.filter((h) => h.circular).length;
    for (const s of ctx.services) {
        if (s.pricingUnit !== 'PER_FEATURE' || s.slug === 'bending' || s.featureCount == null) continue;
        if (s.featureCount > holeCount) {
            out.push(
                violation(ruleset, 'service_feature_count', {
                    message: `${s.name}: ${s.featureCount} holes requested but the part has ${holeCount} round hole${holeCount === 1 ? '' : 's'}.`,
                    count: s.featureCount - holeCount,
                    fix: { kind: 'CONTACT_SUPPORT', label: `Set the ${s.name.toLowerCase()} count to ${holeCount} or fewer`, params: { serviceId: s.serviceId, maxFeatureCount: holeCount } },
                }),
            );
            continue;
        }
        if (s.slug === 'tapping') {
            const thread = s.options.thread;
            const drill = thread ? TAP_DRILL_MM[thread] : undefined;
            if (drill) {
                const tolMm = num(ruleset.rules.tap_drill_mismatch.toleranceMm, 0.15);
                const matching = f.holes.filter((h) => h.circular && Math.abs(h.diameterMm - drill) <= tolMm).length;
                if (matching < s.featureCount) {
                    out.push(
                        violation(ruleset, 'tap_drill_mismatch', {
                            message: `Tapping ${thread} needs ${fmt(drill)} holes; only ${matching} of the ${s.featureCount} requested match.`,
                            measuredMm: null,
                            thresholdMm: drill,
                            count: s.featureCount - matching,
                            fix: { kind: 'ENLARGE_HOLE', label: `Draw tapped holes at the ${thread} tap drill size (${fmt(drill)})`, params: { diameterMm: drill, thread } },
                        }),
                    );
                }
            }
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------

/** Process-fit penalties (small deductions that are not violations). */
export function processFitPenalties(f: PartFeatures, th: DfmThresholds | null, sizeLimit: SizeLimit | null): number {
    let p = 0;
    if (th) {
        const nearMin = f.holes.filter((h) => h.diameterMm >= th.minHoleDiameterMm && h.diameterMm < th.minHoleDiameterMm * 1.2).length;
        p += Math.min(6, nearMin * 2);
        if (f.smallestFeatureMm != null && f.smallestFeatureMm >= th.minFeatureMm && f.smallestFeatureMm < th.minFeatureMm * 1.2) p += 3;
    }
    if (sizeLimit) {
        const long = Math.max(f.bboxWidthMm, f.bboxHeightMm);
        if (long > 0.9 * Math.max(sizeLimit.widthMm, sizeLimit.heightMm)) p += 3;
    }
    return p;
}

/** Makeability = 100 − weighted violations − process-fit penalties, clamped to 0..100. */
export function makeabilityScore(violations: DfmViolation[], ruleset: DfmRuleset, penalties = 0): number {
    let score = 100 - penalties;
    for (const v of violations) score -= ruleset.weights[v.severity] + 2 * Math.min(v.count - 1, 5);
    return Math.max(0, Math.min(100, Math.round(score)));
}

const SEVERITY_ORDER: Record<DfmSeverity, number> = { BLOCKING: 0, WARNING: 1 };

export function buildDfmResult(input: {
    ruleset: DfmRuleset;
    violations: DfmViolation[];
    penalties?: number;
    materialId?: string | null;
    thicknessOptionId?: string | null;
    checkedAt?: Date;
}): DfmResult {
    const violations = [...input.violations].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.ruleId.localeCompare(b.ruleId));
    return {
        rulesetVersion: input.ruleset.version,
        makeabilityScore: makeabilityScore(violations, input.ruleset, input.penalties ?? 0),
        blocking: violations.some((v) => v.severity === 'BLOCKING'),
        violations,
        materialId: input.materialId ?? null,
        thicknessOptionId: input.thicknessOptionId ?? null,
        checkedAt: (input.checkedAt ?? new Date()).toISOString(),
    };
}
