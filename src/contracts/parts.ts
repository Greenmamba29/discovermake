/**
 * Part upload + geometry analysis contracts.
 *
 * POST /api/parts                     CreatePartRequest   -> CreatePartResponse
 *   (client then PUTs the bytes to `upload.url`)
 * POST /api/parts/:partId/analyze     AnalyzePartRequest  -> PartView
 * GET  /api/parts/:partId                                 -> PartView
 * GET  /api/builds/:buildId                               -> BuildView
 *
 * All geometry is normalized to millimetres before it is stored or returned.
 * `PartFeatures`, `PartPreview` and `DfmResult` are also the exact shapes stored
 * in the `parts.features`, `parts.preview` and `parts.dfm` jsonb columns.
 */
import { z } from 'zod';
import { DfmSeverity, PartFileFormat, PartStatus, PartUnits, UniversalStatus } from './enums';
import { BuildDisplayId, BuildId, IsoDateTime, PartId, Point2, SignedUpload } from './common';

/** 25 MB upload cap for R1 instant quotes (workflow 02 §Security). Enforced server-side with 413. */
export const MAX_PART_UPLOAD_BYTES = 25 * 1024 * 1024;

export const CreatePartRequest = z.object({
    filename: z
        .string()
        .trim()
        .min(1)
        .max(255)
        .regex(/\.dxf$/i, 'R1 accepts .dxf files only'),
    contentType: z.string().max(100).optional(),
    sizeBytes: z.number().int().positive().max(MAX_PART_UPLOAD_BYTES),
    /** Optional friendly name for the Build; defaults to the filename stem. */
    buildName: z.string().trim().min(1).max(120).optional(),
});
export type CreatePartRequest = z.infer<typeof CreatePartRequest>;

export const CreatePartResponse = z.object({
    partId: PartId,
    buildId: BuildId,
    buildDisplayId: BuildDisplayId,
    upload: SignedUpload,
});
export type CreatePartResponse = z.infer<typeof CreatePartResponse>;

export const AnalyzePartRequest = z.object({
    /** Required when a previous analyze returned NEEDS_INPUT because units were ambiguous. */
    units: PartUnits.optional(),
});
export type AnalyzePartRequest = z.infer<typeof AnalyzePartRequest>;

export const HoleFeature = z.object({
    center: Point2,
    diameterMm: z.number().positive(),
    /** true for true circles/arcs; false for closed non-circular inner contours (diameter = min bbox side). */
    circular: z.boolean(),
    /** Shortest distance from the hole edge to the outer contour. */
    edgeDistanceMm: z.number().nonnegative(),
});
export type HoleFeature = z.infer<typeof HoleFeature>;

export const BendLine = z.object({
    from: Point2,
    to: Point2,
    lengthMm: z.number().positive(),
    /** Optional angle parsed from layer/annotation; null when unknown (assume 90). */
    angleDeg: z.number().nullable(),
});
export type BendLine = z.infer<typeof BendLine>;

export const PartFeatures = z.object({
    /** Units the source file was interpreted in (geometry below is always mm). */
    sourceUnits: PartUnits,
    /** True when units came from the DXF header ($INSUNITS); false when user-supplied or inferred. */
    unitsFromFile: z.boolean(),
    bboxWidthMm: z.number().nonnegative(),
    bboxHeightMm: z.number().nonnegative(),
    outerContourCount: z.number().int().nonnegative(),
    innerContourCount: z.number().int().nonnegative(),
    openContourCount: z.number().int().nonnegative(),
    cutLengthMm: z.number().nonnegative(),
    pierceCount: z.number().int().nonnegative(),
    /** Outer area minus holes. */
    netAreaMm2: z.number().nonnegative(),
    /** Bounding-box area (instant-quote nesting heuristic input). */
    grossAreaMm2: z.number().nonnegative(),
    /**
     * Narrowest material web or tab between two contours, EXCLUDING hole-to-edge distances
     * (those are `minHoleToEdgeMm`). Null when every contour is a circle (e.g. a washer).
     */
    smallestFeatureMm: z.number().nonnegative().nullable(),
    smallestHoleMm: z.number().nonnegative().nullable(),
    minHoleToEdgeMm: z.number().nonnegative().nullable(),
    holes: z.array(HoleFeature),
    bendLines: z.array(BendLine),
    bendCount: z.number().int().nonnegative(),
    textEntityCount: z.number().int().nonnegative(),
    /** Raw DXF entity counts by type, for debugging + support. */
    entityCounts: z.record(z.number().int().nonnegative()),
});
export type PartFeatures = z.infer<typeof PartFeatures>;

/**
 * Flat geometry for the Three.js viewer (extrude by thickness) and the SVG flat pattern.
 * Polygons are closed (last point != first point; consumers close them) and approximated
 * (arcs tessellated). Origin is bottom-left of the bounding box.
 */
export const PartPreview = z.object({
    outer: z.array(z.array(Point2)),
    holes: z.array(z.array(Point2)),
    bendLines: z.array(z.tuple([Point2, Point2])),
    widthMm: z.number().nonnegative(),
    heightMm: z.number().nonnegative(),
    /** Ready-to-embed SVG path data (`d` attribute) for outer + holes, evenodd fill. */
    svgPath: z.string(),
});
export type PartPreview = z.infer<typeof PartPreview>;

export const DfmFix = z.object({
    /** Machine-readable fix kind; the UI renders `label`. */
    kind: z.enum([
        'ENLARGE_HOLE',
        'MOVE_HOLE',
        'WIDEN_FEATURE',
        'EXTEND_FLANGE',
        'CHANGE_THICKNESS',
        'CHANGE_MATERIAL',
        'SPLIT_PART',
        'CLOSE_CONTOUR',
        'CONVERT_TEXT',
        'SET_UNITS',
        /** params: `{ serviceId }` - select this secondary operation. */
        'ADD_SERVICE',
        /** params: `{ serviceId }` - deselect this secondary operation. */
        'REMOVE_SERVICE',
        'CONTACT_SUPPORT',
    ]),
    label: z.string(),
    /** Optional suggested target, e.g. `{ thicknessOptionId: "thk_..." }` or `{ minDiameterMm: 3.2 }`. */
    params: z.record(z.unknown()).optional(),
});
export type DfmFix = z.infer<typeof DfmFix>;

export const DfmViolation = z.object({
    ruleId: z.string(), // e.g. "min_hole_diameter"
    severity: DfmSeverity,
    message: z.string(),
    measuredMm: z.number().nullable(),
    thresholdMm: z.number().nullable(),
    location: Point2.nullable(),
    /** How many features violate this rule. */
    count: z.number().int().positive(),
    fix: DfmFix.nullable(),
});
export type DfmViolation = z.infer<typeof DfmViolation>;

export const DfmResult = z.object({
    rulesetVersion: z.string(),
    /** 0..100, shown as the Makeability ring. */
    makeabilityScore: z.number().int().min(0).max(100),
    /** Any BLOCKING violation -> not orderable. Warnings never block. */
    blocking: z.boolean(),
    violations: z.array(DfmViolation),
    /** Material/thickness the checks ran against; null for geometry-only checks at analyze time. */
    materialId: z.string().nullable(),
    thicknessOptionId: z.string().nullable(),
    checkedAt: IsoDateTime,
});
export type DfmResult = z.infer<typeof DfmResult>;

export const PartView = z.object({
    id: PartId,
    buildId: BuildId,
    buildDisplayId: BuildDisplayId,
    filename: z.string(),
    format: PartFileFormat,
    sizeBytes: z.number().int().nonnegative(),
    status: PartStatus,
    universalStatus: UniversalStatus,
    /** null until known; NEEDS_INPUT status means the client must choose. */
    units: PartUnits.nullable(),
    designVersion: z.number().int().positive(),
    features: PartFeatures.nullable(),
    /** Geometry-only DFM (open contours, size, text). Material-specific DFM is on the quote. */
    dfm: DfmResult.nullable(),
    preview: PartPreview.nullable(),
    error: z.string().nullable(),
    rulesetVersion: z.string().nullable(),
    createdAt: IsoDateTime,
    analyzedAt: IsoDateTime.nullable(),
});
export type PartView = z.infer<typeof PartView>;

export const BuildView = z.object({
    id: BuildId,
    displayId: BuildDisplayId,
    name: z.string(),
    status: UniversalStatus,
    part: PartView.nullable(),
    /** Most recent quote for this build's current design version, if any. */
    latestQuoteId: z.string().nullable(),
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
});
export type BuildView = z.infer<typeof BuildView>;
