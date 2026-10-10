/**
 * R6 Reconstruct contracts: fix anything from a photo (workflow 01 "Reconstruct", spec §16).
 *
 *   POST  /api/reconstruct                         CreateReconstructRequest -> CreateReconstructResponse (201)
 *   GET   /api/reconstruct/:buildId                                         -> ReconstructView
 *   PATCH /api/reconstruct/:buildId                UpdateReconstructRequest -> ReconstructView
 *   PUT   /api/reconstruct/:buildId/measurements   SaveMeasurementsRequest  -> ReconstructView
 *   POST  /api/reconstruct/:buildId/dimensions     ConfirmDimensionsRequest -> ReconstructView
 *   POST  /api/reconstruct/:buildId/generate                                -> ReconstructGenerateResponse
 *   POST  /api/reconstruct/:buildId/quote          ReconstructQuoteRequest  -> QuoteView
 *   POST  /api/reconstruct/:buildId/segment        SegmentRequest           -> SegmentResponse (GPU worker, optional)
 *
 * Photos are ordinary build attachments (signed upload + magic-byte checks,
 * /api/builds/:buildId/attachments). The hard rule: every critical dimension of the chosen
 * family is a CALIPER reading the buyer typed. Photo estimates only ever prefill; nothing is
 * inferred into CAD.
 */
import { z } from 'zod';
import { BuildId, IsoDateTime } from './common';

// ---------------------------------------------------------------------------
// What is being replaced
// ---------------------------------------------------------------------------

export const RECONSTRUCT_PART_TYPES = ['knob', 'spacer', 'bracket'] as const;
export const ReconstructPartType = z.enum(RECONSTRUCT_PART_TYPES);
export type ReconstructPartType = z.infer<typeof ReconstructPartType>;

export const PART_TYPE_LABELS: Record<ReconstructPartType, { title: string; body: string }> = {
    knob: { title: 'Knob', body: 'Stove, radio, amp or appliance knob on a shaft. 3D printed.' },
    spacer: { title: 'Spacer or bushing', body: 'Round spacer, sleeve or flanged bushing. 3D printed.' },
    bracket: { title: 'Bracket or plate', body: 'Flat plate or bent sheet-metal bracket. Laser cut and bent.' },
};

/**
 * Standard shafts a buyer can pick instead of measuring one. These are published interface
 * standards (the buyer chooses one explicitly), never guesses: the planner records them as
 * `standard`, not `caliper`.
 */
export const SHAFT_STANDARDS = {
    '6mm-d': { label: '6 mm D-shaft (4.5 mm across the flat)', boreType: 'd_shaft', diameterMm: 6, flatDepthMm: 1.5 },
    '6mm-round': { label: '6 mm round shaft', boreType: 'round', diameterMm: 6, flatDepthMm: null },
    '1/4in-round': { label: '1/4 in (6.35 mm) round shaft', boreType: 'round', diameterMm: 6.35, flatDepthMm: null },
} as const;
export type ShaftStandardKey = keyof typeof SHAFT_STANDARDS;
export const SHAFT_CHOICES = ['6mm-d', '6mm-round', '1/4in-round', 'measured'] as const satisfies readonly (ShaftStandardKey | 'measured')[];

/** Knob bore depth when the buyer does not measure the shaft engagement: height minus this cap. */
export const KNOB_DEFAULT_CAP_MM = 2;

export const ReconstructOptions = z.object({
    /** Knob: a shaft standard, or 'measured' (caliper the shaft). */
    shaft: z.enum(SHAFT_CHOICES).default('6mm-d'),
    /** Knob with a measured shaft: D-shaft (measure across the flat too) or round. */
    measuredBoreType: z.enum(['d_shaft', 'round']).default('d_shaft'),
    /** Knob: 'cap' = bore up to KNOB_DEFAULT_CAP_MM under the top; 'measured' = caliper the shaft engagement. */
    boreDepth: z.enum(['cap', 'measured']).default('cap'),
    /** Knob: grip flutes the buyer counted on the old part (0 = smooth). */
    gripRibs: z.number().int().min(0).max(60).default(0),
    pointerNotch: z.boolean().default(false),
    /** Spacer: plain tube or flanged bushing. */
    flanged: z.boolean().default(false),
    /** Bracket: flat plate, L (one bend) or Z (two bends). */
    bracketShape: z.enum(['flat', 'l', 'z']).default('l'),
    /** Flat plate: two mounting holes at a measured spacing, centred on the plate. */
    bracketHoles: z.boolean().default(false),
});
export type ReconstructOptions = z.infer<typeof ReconstructOptions>;
export type ReconstructOptionsInput = z.input<typeof ReconstructOptions>;

// ---------------------------------------------------------------------------
// Dimensions: which caliper readings each family needs
// ---------------------------------------------------------------------------

export const MEASUREMENT_KINDS = ['diameter', 'length', 'hole_spacing', 'thickness'] as const;
export const MeasurementKind = z.enum(MEASUREMENT_KINDS);
export type MeasurementKind = z.infer<typeof MeasurementKind>;

export const DIMENSION_PARAMS = [
    'diameter_mm',
    'height_mm',
    'shaft_diameter_mm',
    'shaft_across_flat_mm',
    'bore_depth_mm',
    'outer_diameter_mm',
    'inner_diameter_mm',
    'length_mm',
    'flange_diameter_mm',
    'flange_thickness_mm',
    'leg_a_mm',
    'leg_b_mm',
    'web_mm',
    'width_mm',
    'thickness_mm',
    'hole_diameter_mm',
    'hole_spacing_mm',
] as const;
export const DimensionParam = z.enum(DIMENSION_PARAMS);
export type DimensionParam = z.infer<typeof DimensionParam>;

export type DimensionDef = { param: DimensionParam; label: string; kind: MeasurementKind; hint: string };

const D = (param: DimensionParam, label: string, kind: MeasurementKind, hint: string): DimensionDef => ({ param, label, kind, hint });

/** The critical dimensions the chosen part needs, in the order the buyer measures them. Every one must be a caliper reading. */
export function requiredDimensions(partType: ReconstructPartType, options: ReconstructOptionsInput = {}): DimensionDef[] {
    const o = ReconstructOptions.parse(options);
    switch (partType) {
        case 'knob': {
            const dims = [D('diameter_mm', 'Outer diameter', 'diameter', 'Across the widest part of the knob, jaws flat on the sides.'), D('height_mm', 'Height', 'length', 'From the underside to the top face.')];
            if (o.shaft === 'measured') {
                dims.push(D('shaft_diameter_mm', 'Shaft diameter', 'diameter', 'The shaft the knob fits on, across its round part.'));
                if (o.measuredBoreType === 'd_shaft') dims.push(D('shaft_across_flat_mm', 'Shaft across the flat', 'length', 'From the flat face to the opposite round side.'));
            }
            if (o.boreDepth === 'measured') dims.push(D('bore_depth_mm', 'Shaft engagement depth', 'length', 'How far the shaft goes into the knob (depth gauge of the caliper).'));
            return dims;
        }
        case 'spacer': {
            const dims = [
                D('outer_diameter_mm', 'Outer diameter', 'diameter', 'Across the tube.'),
                D('inner_diameter_mm', 'Inner diameter (hole)', 'diameter', 'Inside jaws of the caliper in the hole.'),
                D('length_mm', 'Overall length', 'length', 'End to end, including any flange.'),
            ];
            if (o.flanged) dims.push(D('flange_diameter_mm', 'Flange diameter', 'diameter', 'Across the flange.'), D('flange_thickness_mm', 'Flange thickness', 'thickness', 'Thickness of the flange only.'));
            return dims;
        }
        case 'bracket': {
            if (o.bracketShape === 'flat') {
                const dims = [D('length_mm', 'Plate length', 'length', 'The long side.'), D('width_mm', 'Plate width', 'length', 'The short side.'), D('thickness_mm', 'Sheet thickness', 'thickness', 'Measure away from any burr or bend.')];
                if (o.bracketHoles) dims.push(D('hole_diameter_mm', 'Hole diameter', 'diameter', 'Inside jaws in one hole.'), D('hole_spacing_mm', 'Hole spacing (centre to centre)', 'hole_spacing', 'Centre of one hole to the centre of the other.'));
                return dims;
            }
            if (o.bracketShape === 'l') {
                return [
                    D('leg_a_mm', 'Leg A (outside)', 'length', 'Outside face of the bend to the free edge.'),
                    D('leg_b_mm', 'Leg B (outside)', 'length', 'Outside face of the bend to the other free edge.'),
                    D('width_mm', 'Width (along the bend)', 'length', 'Along the bend line.'),
                    D('thickness_mm', 'Sheet thickness', 'thickness', 'Measure on a flat leg.'),
                ];
            }
            return [
                D('leg_a_mm', 'First flange (outside)', 'length', 'Free edge to the outside of the first bend.'),
                D('web_mm', 'Web (outside to outside)', 'length', 'Between the outside faces of the two bends.'),
                D('leg_b_mm', 'Last flange (outside)', 'length', 'Outside of the second bend to the free edge.'),
                D('width_mm', 'Width (along the bends)', 'length', 'Along the bend lines.'),
                D('thickness_mm', 'Sheet thickness', 'thickness', 'Measure on a flat flange.'),
            ];
        }
    }
}

// ---------------------------------------------------------------------------
// Photo measurement (estimates only)
// ---------------------------------------------------------------------------

/** Reference objects of known size that set the photo's mm/px scale. */
export const REFERENCE_PRESETS = {
    credit_card: { label: 'Credit card (long edge, 85.60 mm)', lengthMm: 85.6, note: 'ISO/IEC 7810 ID-1: 85.60 x 53.98 mm. Mark the long edge.' },
    credit_card_short: { label: 'Credit card (short edge, 53.98 mm)', lengthMm: 53.98, note: 'ISO/IEC 7810 ID-1 short edge.' },
    us_quarter: { label: 'US quarter (diameter, 24.26 mm)', lengthMm: 24.26, note: 'Mark across the coin through its centre.' },
    ruler: { label: 'Ruler segment (type its length)', lengthMm: null, note: 'Mark two graduations and type the distance between them.' },
} as const;
export type ReferencePresetKey = keyof typeof REFERENCE_PRESETS;
export const ReferencePreset = z.enum(Object.keys(REFERENCE_PRESETS) as [ReferencePresetKey, ...ReferencePresetKey[]]);

export const PERSPECTIVE_CAVEAT =
    'Photo estimates are only right in the plane of the reference object, with the camera square on to it. Tilt, lens distortion and depth differences (the knob is taller than the card) can be off by 10% or more, so every critical size still needs a caliper or ruler reading.';

export const PixelPoint = z.object({ x: z.number().min(0).max(20_000), y: z.number().min(0).max(20_000) });
export type PixelPoint = z.infer<typeof PixelPoint>;

export const ReferenceMark = z.object({
    preset: ReferencePreset,
    a: PixelPoint,
    b: PixelPoint,
    /** Known length of the marked segment (mm). Fixed for presets, typed for a ruler. */
    lengthMm: z.number().positive().max(2000),
});
export type ReferenceMark = z.infer<typeof ReferenceMark>;

export const MeasurementLine = z.object({
    id: z.string().regex(/^[a-z0-9_-]{1,24}$/),
    kind: MeasurementKind,
    /** Which dimension this line estimates (null = not assigned yet). */
    param: DimensionParam.nullable(),
    a: PixelPoint,
    b: PixelPoint,
});
export type MeasurementLine = z.infer<typeof MeasurementLine>;

export const PhotoMeasurements = z.object({
    attachmentId: z.string().regex(/^att_[A-Za-z0-9_-]+$/),
    imageWidth: z.number().int().positive().max(20_000),
    imageHeight: z.number().int().positive().max(20_000),
    reference: ReferenceMark.nullable(),
    lines: z.array(MeasurementLine).max(20),
});
export type PhotoMeasurements = z.infer<typeof PhotoMeasurements>;

export const SaveMeasurementsRequest = z.object({ photos: z.array(PhotoMeasurements).max(6) });
export type SaveMeasurementsRequest = z.infer<typeof SaveMeasurementsRequest>;

// ---------------------------------------------------------------------------
// Caliper confirmation (the hard rule)
// ---------------------------------------------------------------------------

export const LENGTH_UNITS = ['mm', 'in'] as const;
export const LengthUnit = z.enum(LENGTH_UNITS);
export type LengthUnit = z.infer<typeof LengthUnit>;

/** Photo estimate vs caliper: warn the buyer above this difference. */
export const DELTA_WARN_PCT = 10;

export const CaliperReading = z.object({
    param: DimensionParam,
    /** As typed (0.01 mm or 0.001 in resolution); normalized to mm on the server. */
    value: z.number().positive().max(3000),
    unit: LengthUnit,
});
export type CaliperReading = z.infer<typeof CaliperReading>;

export const ConfirmDimensionsRequest = z.object({ readings: z.array(CaliperReading).min(1).max(20) });
export type ConfirmDimensionsRequest = z.infer<typeof ConfirmDimensionsRequest>;

export const DimensionSource = z.enum(['photo_estimate', 'caliper']);
export type DimensionSource = z.infer<typeof DimensionSource>;

export const DimensionView = z.object({
    param: DimensionParam,
    label: z.string(),
    kind: MeasurementKind,
    hint: z.string(),
    /** Latest photo estimate (mm, 0.01) and its uncertainty, or null. */
    estimateMm: z.number().nullable(),
    estimateUncertaintyMm: z.number().nullable(),
    /** Confirmed caliper reading (mm, 0.01), the unit it was typed in, and when. */
    caliperMm: z.number().nullable(),
    enteredValue: z.number().nullable(),
    enteredUnit: LengthUnit.nullable(),
    confirmedAt: IsoDateTime.nullable(),
    source: DimensionSource.nullable(),
    /** |estimate - caliper| / caliper in percent, when both exist. */
    deltaPct: z.number().nullable(),
    deltaWarning: z.boolean(),
});
export type DimensionView = z.infer<typeof DimensionView>;

// ---------------------------------------------------------------------------
// Plan (family + spec, only from caliper readings)
// ---------------------------------------------------------------------------

export const TraceSource = z.enum(['caliper', 'caliper_derived', 'standard', 'buyer_choice', 'design_rule']);
export type TraceSource = z.infer<typeof TraceSource>;

export const PlanTrace = z.object({ field: z.string(), value: z.union([z.number(), z.string(), z.boolean(), z.null()]), source: TraceSource, from: z.string() });
export type PlanTrace = z.infer<typeof PlanTrace>;

export const ReconstructPlan = z.discriminatedUnion('status', [
    z.object({
        status: z.literal('ready'),
        family: z.string(),
        /** The CadSpec the worker will build (validated). */
        spec: z.record(z.unknown()),
        trace: z.array(PlanTrace),
        printed: z.boolean(),
    }),
    z.object({ status: z.literal('needs_input'), missing: z.array(DimensionParam), questions: z.array(z.string()) }),
]);
export type ReconstructPlan = z.infer<typeof ReconstructPlan>;

// ---------------------------------------------------------------------------
// Requests / responses
// ---------------------------------------------------------------------------

export const CreateReconstructRequest = z.object({
    partType: ReconstructPartType,
    description: z.string().trim().max(500).default(''),
    passportId: z.string().regex(/^pps_[A-Za-z0-9_-]{1,60}$/).nullable().optional(),
    options: ReconstructOptions.partial().optional(),
});
export type CreateReconstructRequest = z.input<typeof CreateReconstructRequest>;

export const CreateReconstructResponse = z.object({ buildId: BuildId, displayId: z.string(), url: z.string() });
export type CreateReconstructResponse = z.infer<typeof CreateReconstructResponse>;

export const UpdateReconstructRequest = z.object({
    options: ReconstructOptions.partial().optional(),
    description: z.string().trim().max(500).optional(),
    printMaterialSlug: z.string().regex(/^[a-z0-9-]{1,40}$/).optional(),
    quantity: z.number().int().min(1).max(100).optional(),
});
export type UpdateReconstructRequest = z.infer<typeof UpdateReconstructRequest>;

export const PrintMaterialOption = z.object({
    slug: z.string(),
    name: z.string(),
    process: z.string(),
    description: z.string(),
    swatchHex: z.string(),
    heatDeflectionC: z.number().nullable(),
});
export type PrintMaterialOption = z.infer<typeof PrintMaterialOption>;

export const PassportPrefill = z.object({
    passportId: z.string(),
    orderNumber: z.string(),
    buildName: z.string(),
    materialName: z.string(),
    processName: z.string(),
    /** Print material slug matching the original material, when there is one. */
    printMaterialSlug: z.string().nullable(),
    suggestedPartType: ReconstructPartType,
});
export type PassportPrefill = z.infer<typeof PassportPrefill>;

/** A photo of the broken part (a verified build attachment) and its measurements. */
export const ReconstructPhoto = z.object({
    attachmentId: z.string(),
    filename: z.string(),
    url: z.string().nullable(),
    measurements: PhotoMeasurements.nullable(),
    /** mm per pixel from the reference object, when one was marked. */
    mmPerPx: z.number().nullable(),
});
export type ReconstructPhoto = z.infer<typeof ReconstructPhoto>;

export const ReconstructView = z.object({
    buildId: BuildId,
    displayId: z.string(),
    name: z.string(),
    partType: ReconstructPartType,
    description: z.string(),
    options: ReconstructOptions,
    passport: PassportPrefill.nullable(),
    photos: z.array(ReconstructPhoto),
    dimensions: z.array(DimensionView),
    /** Every required dimension has a confirmed caliper reading. */
    allConfirmed: z.boolean(),
    plan: ReconstructPlan,
    printMaterials: z.array(PrintMaterialOption),
    printMaterialSlug: z.string().nullable(),
    quantity: z.number().int().positive(),
    /** CAD worker configured (Generate can run). */
    cadAvailable: z.boolean(),
    /** GPU segmentation worker configured (the "Auto-detect" button shows). */
    autoDetect: z.boolean(),
    /** Latest generated CAD version, if any (same shape as GET /api/builds/:id/cad). */
    cadVersion: z.number().int().nullable(),
    /** Latest print quote for the current CAD version, if any. */
    quoteId: z.string().nullable(),
    /** Sheet families: the flat-pattern part to quote on /parts/:partId (R1 laser engine). */
    sheetPartId: z.string().nullable(),
    canEdit: z.boolean(),
    updatedAt: IsoDateTime,
});
export type ReconstructView = z.infer<typeof ReconstructView>;

export const ReconstructQuoteRequest = z.object({
    printMaterialSlug: z.string().regex(/^[a-z0-9-]{1,40}$/),
    quantity: z.number().int().min(1).max(100),
});
export type ReconstructQuoteRequest = z.infer<typeof ReconstructQuoteRequest>;

export const ReconstructGenerateResponse = z.discriminatedUnion('status', [
    z.object({ status: z.literal('generated'), version: z.number().int().positive(), family: z.string(), quoteId: z.string().nullable(), sheetPartId: z.string().nullable() }),
    z.object({ status: z.literal('needs_input'), missing: z.array(DimensionParam), questions: z.array(z.string()) }),
]);
export type ReconstructGenerateResponse = z.infer<typeof ReconstructGenerateResponse>;

// ---------------------------------------------------------------------------
// Optional GPU worker (RECONSTRUCT_WORKER_URL): SAM 2 -> OpenCV -> COLMAP / Open3D
// ---------------------------------------------------------------------------

export const SegmentRequest = z.object({ attachmentId: z.string().regex(/^att_[A-Za-z0-9_-]+$/), hint: z.string().max(200).optional() });
export type SegmentRequest = z.infer<typeof SegmentRequest>;

export const SegmentPolygon = z.object({ label: z.string().max(60), score: z.number().min(0).max(1), points: z.array(PixelPoint).min(3).max(2000) });
export const SuggestedDimension = z.object({ param: DimensionParam, valueMm: z.number().positive().max(3000), uncertaintyMm: z.number().nonnegative().max(100), method: z.string().max(80) });
export type SuggestedDimension = z.infer<typeof SuggestedDimension>;

/** What the app returns: masks to draw and SUGGESTED estimates (never confirmed, never CAD input). */
export const SegmentResponse = z.object({
    polygons: z.array(SegmentPolygon).max(20),
    reference: z.object({ preset: ReferencePreset, a: PixelPoint, b: PixelPoint }).nullable(),
    suggestions: z.array(SuggestedDimension).max(20),
    model: z.string().max(80),
});
export type SegmentResponse = z.infer<typeof SegmentResponse>;
