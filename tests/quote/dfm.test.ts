/**
 * Material-specific DFM: exact rule ids + severities per material/thickness
 * (thresholds from the R1 seed catalog), fixes, locations and the Makeability score.
 */
import { describe, expect, it } from 'vitest';
import type { PartFeatures, PartPreview } from '@/contracts';
import { analyzeDxfBytes } from '@/server/quote/analyze';
import {
    buildDfmResult,
    DEFAULT_DFM_RULES,
    dfmThresholds,
    flangeLengths,
    makeabilityScore,
    resolveRuleset,
    runGeometryDfm,
    runMaterialDfm,
    type DfmMaterial,
    type DfmServiceSelection,
    type DfmThickness,
    type MaterialDfmContext,
} from '@/server/quote/dfm';
import { fixture } from './fixtures/fixtures';

const RULESET = resolveRuleset('dfm-test', DEFAULT_DFM_RULES as unknown as Record<string, unknown>);

const STEEL: DfmMaterial = { name: 'Mild steel', minHoleRatio: 1, minFeatureRatio: 1, holeToEdgeRatio: 1, minHoleFloorMm: 0.5, minFeatureFloorMm: 0.5 };
const ALU: DfmMaterial = { name: 'Aluminum 5052', minHoleRatio: 0.75, minFeatureRatio: 1, holeToEdgeRatio: 1, minHoleFloorMm: 0.5, minFeatureFloorMm: 0.5 };
const thk = (id: string, t: number, bendable = true, minBendRadiusMm: number | null = t): DfmThickness => ({
    id,
    label: `${t} mm`,
    thicknessMm: t,
    bendable,
    minBendRadiusMm,
    minFlangeRatio: 4,
    maxPartWidthMm: 1143,
    maxPartHeightMm: 762,
});
const CRS_16GA = thk('thk_crs_16ga', 1.52, true, 1.5);
const CRS_11GA = thk('thk_crs_11ga', 3.04, true, 3.0);
const CRS_250 = thk('thk_crs_250', 6.35, false, null);
const AL_040 = thk('thk_al5052_040', 1.02, true, 0.76);

function analyzed(name: string): { features: PartFeatures; preview: PartPreview } {
    const a = analyzeDxfBytes(new TextEncoder().encode(fixture(name).build()));
    if (a.status !== 'READY') throw new Error(`${name} not READY`);
    return { features: a.features, preview: a.preview };
}

function ctx(over: Partial<MaterialDfmContext> & { preview?: PartPreview | null }): MaterialDfmContext {
    return {
        ruleset: RULESET,
        material: STEEL,
        thickness: CRS_16GA,
        alternatives: [AL_040, CRS_16GA, CRS_11GA, CRS_250],
        sizeLimit: { widthMm: 1143, heightMm: 762 },
        bendingSelected: false,
        services: [],
        preview: null,
        ...over,
    };
}

const ids = (v: { ruleId: string; severity: string }[]) => v.map((x) => `${x.ruleId}:${x.severity}`).sort();

describe('thresholds', () => {
    it('resolves catalog ratios × thickness with floors', () => {
        expect(dfmThresholds(STEEL, CRS_16GA, RULESET)).toEqual({
            minHoleDiameterMm: 1.52,
            minFeatureMm: 1.52,
            minHoleToEdgeMm: 1.52,
            holeToEdgeBlockingMm: 0.76,
            minFlangeMm: 6.08,
            minHoleToBendMm: 5.3, // 2.5 × 1.52 + 1.5 bend radius
        });
        expect(dfmThresholds(ALU, AL_040, RULESET).minHoleDiameterMm).toBe(0.77); // max(0.75 × 1.02, 0.5)
        expect(dfmThresholds(ALU, { ...AL_040, thicknessMm: 0.5 }, RULESET).minHoleDiameterMm).toBe(0.5); // floor
    });

    it('lets a stored ruleset override severities and weights', () => {
        const custom = resolveRuleset('dfm-custom', { weights: { WARNING: 5 }, rules: { text_entities: { severity: 'BLOCKING' }, bogus: { severity: 'WARNING' } } });
        expect(custom.rules.text_entities.severity).toBe('BLOCKING');
        expect(custom.weights).toEqual({ BLOCKING: 30, WARNING: 5 });
        expect(custom.rules.open_contour.severity).toBe('BLOCKING');
    });
});

describe('material DFM', () => {
    it('clean plate on 16 ga steel has no violations and a high score', () => {
        const { features } = analyzed('plate-holes-mm');
        const v = runMaterialDfm(features, ctx({}));
        expect(v).toEqual([]);
        expect(buildDfmResult({ ruleset: RULESET, violations: v }).makeabilityScore).toBe(100);
    });

    it('tiny hole: BLOCKING on 16 ga steel with a thinner-stock fix, fine on 0.040" aluminum', () => {
        const { features } = analyzed('tiny-hole');
        const steel = runMaterialDfm(features, ctx({}));
        expect(ids(steel)).toEqual(['min_hole_diameter:BLOCKING']);
        expect(steel[0]).toMatchObject({ measuredMm: 0.8, thresholdMm: 1.52, location: [25, 25], count: 1 });
        expect(steel[0].fix?.kind).toBe('ENLARGE_HOLE');
        expect(runMaterialDfm(features, ctx({ material: ALU, thickness: AL_040, alternatives: [AL_040] }))).toEqual([]);
        // On 11 ga the engine suggests the thickest option that would pass (none here pass for 0.8 mm on steel -> enlarge).
        const al = runMaterialDfm(features, ctx({ material: ALU, thickness: { ...AL_040, id: 'thk_al5052_125', thicknessMm: 3.18 }, alternatives: [AL_040] }));
        expect(al[0].fix).toMatchObject({ kind: 'CHANGE_THICKNESS', params: { thicknessOptionId: 'thk_al5052_040' } });
    });

    it('hole near edge: WARNING on 16 ga, BLOCKING on 11 ga', () => {
        const { features } = analyzed('hole-near-edge');
        const thin = runMaterialDfm(features, ctx({}));
        expect(ids(thin)).toEqual(['hole_to_edge:WARNING']);
        expect(thin[0]).toMatchObject({ measuredMm: 1, thresholdMm: 1.52, location: [3.5, 20], fix: { kind: 'MOVE_HOLE' } });
        const thick = runMaterialDfm(features, ctx({ thickness: CRS_11GA }));
        expect(ids(thick)).toEqual(['hole_to_edge:BLOCKING']);
        expect(thick[0]).toMatchObject({ thresholdMm: 1.52 });
    });

    it('narrow web: min_feature BLOCKING when slots are closer than the thickness', () => {
        const { features } = analyzed('slotted-panel'); // 7 mm webs between slots
        expect(runMaterialDfm(features, ctx({}))).toEqual([]);
        const v = runMaterialDfm(features, ctx({ thickness: { ...CRS_250, thicknessMm: 8 } }));
        expect(ids(v)).toContain('min_feature:BLOCKING');
    });

    it('oversize: part_size_max BLOCKING with a split fix', () => {
        const { features } = analyzed('oversize-panel');
        const v = runMaterialDfm(features, ctx({}));
        expect(ids(v)).toEqual(['part_size_max:BLOCKING']);
        expect(v[0].fix?.kind).toBe('SPLIT_PART');
        // Rotation is allowed: 700 × 1100 fits a 1143 × 762 limit.
        expect(runMaterialDfm({ ...features, bboxWidthMm: 700, bboxHeightMm: 1100 }, ctx({}))).toEqual([]);
    });

    it('bends: needs bending selected, a bendable thickness, long flanges and holes clear of the bend', () => {
        const bent = analyzed('bent-bracket');
        expect(runMaterialDfm(bent.features, ctx({ bendingSelected: true, preview: bent.preview }))).toEqual([]);
        const unselected = runMaterialDfm(bent.features, ctx({ preview: bent.preview }));
        expect(ids(unselected)).toEqual(['bend_not_supported:BLOCKING']);
        expect(unselected[0].fix).toMatchObject({ kind: 'ADD_SERVICE', params: { serviceId: 'svc_bending' } });
        const notBendable = runMaterialDfm(bent.features, ctx({ thickness: CRS_250, bendingSelected: true, preview: bent.preview }));
        // 1/4" steel: not bendable, and the Ø5 holes are below its 6.35 mm minimum too.
        expect(ids(notBendable)).toEqual(['bend_not_supported:BLOCKING', 'min_hole_diameter:BLOCKING']);
        expect(notBendable.find((x) => x.ruleId === 'bend_not_supported')?.fix).toMatchObject({ kind: 'CHANGE_THICKNESS', params: { thicknessOptionId: 'thk_crs_11ga' } });

        const short = analyzed('short-flange');
        const v = runMaterialDfm(short.features, ctx({ bendingSelected: true, preview: short.preview }));
        expect(ids(v)).toEqual(['bend_flange_min:BLOCKING']);
        expect(v[0]).toMatchObject({ measuredMm: 4, thresholdMm: 6.08, location: [60, 4], fix: { kind: 'EXTEND_FLANGE' } });

        const plain = analyzed('plate-holes-mm');
        const noLines = runMaterialDfm(plain.features, ctx({ bendingSelected: true, preview: plain.preview }));
        expect(ids(noLines)).toEqual(['bend_lines_missing:BLOCKING']);
        expect(noLines[0].fix).toMatchObject({ kind: 'REMOVE_SERVICE', params: { serviceId: 'svc_bending' } });

        // Hole within 2.5t + r of the bend line.
        const nearBend = { ...bent.features, holes: [{ center: [30, 23] as [number, number], diameterMm: 2, circular: true, edgeDistanceMm: 20 }] };
        expect(ids(runMaterialDfm(nearBend, ctx({ bendingSelected: true, preview: bent.preview })))).toEqual(['hole_to_bend:WARNING']);
    });

    it('measures flat flanges on both sides of a bend line', () => {
        const outer: [number, number][][] = [
            [
                [0, 0],
                [120, 0],
                [120, 60],
                [0, 60],
            ],
        ];
        expect(flangeLengths([0, 20], [120, 20], outer)).toEqual([40, 20]);
    });

    it('hole services: counts must fit the part and tapped holes must match the tap drill', () => {
        const { features } = analyzed('plate-holes-mm'); // four Ø6 holes
        const tap = (n: number, thread: string): DfmServiceSelection => ({ serviceId: 'svc_tapping', slug: 'tapping', name: 'Tapping', pricingUnit: 'PER_FEATURE', featureCount: n, options: { thread } });
        expect(ids(runMaterialDfm(features, ctx({ services: [tap(6, 'M4')] })))).toEqual(['service_feature_count:BLOCKING']);
        expect(ids(runMaterialDfm(features, ctx({ services: [tap(4, 'M4')] })))).toEqual(['tap_drill_mismatch:WARNING']);
        const m6ok = { ...features, holes: features.holes.map((h) => ({ ...h, diameterMm: 5 })) };
        expect(runMaterialDfm(m6ok, ctx({ services: [tap(4, 'M6')] }))).toEqual([]);
    });
});

describe('geometry DFM + score', () => {
    it('flags open contours with the gap location and a close-contour fix', () => {
        const { features } = analyzed('open-contour');
        const v = runGeometryDfm(features, { ruleset: RULESET, catalogLimits: [], openEnds: [[0, 0.5]] });
        const open = v.find((x) => x.ruleId === 'open_contour');
        expect(open).toMatchObject({ severity: 'BLOCKING', location: [0, 0.5], fix: { kind: 'CLOSE_CONTOUR' } });
    });

    it('flags tiny parts', () => {
        const { features } = analyzed('l-bracket-flat');
        const v = runGeometryDfm({ ...features, bboxWidthMm: 8, bboxHeightMm: 30 }, { ruleset: RULESET, catalogLimits: [], openEnds: [] });
        expect(ids(v)).toEqual(['part_size_min:BLOCKING']);
    });

    it('scores 100 − weights − count bonus − penalties, clamped, blocking first', () => {
        const mk = (severity: 'BLOCKING' | 'WARNING', count = 1) => ({ ruleId: 'x', severity, message: '', measuredMm: null, thresholdMm: null, location: null, count, fix: null });
        expect(makeabilityScore([], RULESET)).toBe(100);
        expect(makeabilityScore([mk('WARNING')], RULESET)).toBe(92);
        expect(makeabilityScore([mk('BLOCKING', 3)], RULESET)).toBe(66);
        expect(makeabilityScore([mk('BLOCKING'), mk('BLOCKING'), mk('BLOCKING'), mk('BLOCKING')], RULESET)).toBe(0);
        expect(makeabilityScore([mk('WARNING')], RULESET, 5)).toBe(87);
        const result = buildDfmResult({ ruleset: RULESET, violations: [{ ...mk('WARNING'), ruleId: 'b' }, { ...mk('BLOCKING'), ruleId: 'a' }] });
        expect(result.blocking).toBe(true);
        expect(result.violations.map((x) => x.severity)).toEqual(['BLOCKING', 'WARNING']);
        expect(result.rulesetVersion).toBe('dfm-test');
    });
});
