/**
 * Pure DXF analysis: bytes -> units resolution -> mm geometry -> features + preview.
 * No database or storage access (the service layer in ./parts.ts persists results).
 */
import type { PartFeatures, PartPreview } from '../../contracts/parts';
import type { PartUnits } from '../../contracts/enums';
import { parseDxf, type RawDrawing } from './dxf/parse';
import { sniffDxf } from './dxf/sniff';
import { analyzeGeometry, type GeometryResult } from './geometry/features';
import { bboxOfEdges, transformEdge, type Edge } from './geometry/edges';

export const MM_PER_INCH = 25.4;

/** $INSUNITS codes -> (mm per drawing unit, reported unit family). 0 / missing = unitless. */
const INSUNITS: Record<number, { mmPerUnit: number; units: PartUnits }> = {
    1: { mmPerUnit: 25.4, units: 'in' },
    2: { mmPerUnit: 304.8, units: 'in' },
    4: { mmPerUnit: 1, units: 'mm' },
    5: { mmPerUnit: 10, units: 'mm' },
    6: { mmPerUnit: 1000, units: 'mm' },
    8: { mmPerUnit: 0.0000254, units: 'in' },
    9: { mmPerUnit: 0.0254, units: 'in' },
    13: { mmPerUnit: 0.001, units: 'mm' },
    14: { mmPerUnit: 100, units: 'mm' },
};

/** Plausible largest dimension of a laser-cut part, used to infer units when the header has none. */
export const PLAUSIBLE_PART_MM = { min: 5, max: 1500 } as const;

export type UnitsResolution =
    | { kind: 'resolved'; units: PartUnits; mmPerUnit: number; fromFile: boolean; inferred: boolean }
    | { kind: 'ambiguous'; drawingMaxDim: number };

/**
 * Units: an explicit buyer choice wins; then $INSUNITS; then inference when only one
 * of mm / inch gives a plausible part size; otherwise ambiguous (NEEDS_INPUT).
 */
export function resolveUnits(drawing: Pick<RawDrawing, 'insUnits' | 'cutEdges'>, requested?: PartUnits): UnitsResolution {
    if (requested) return { kind: 'resolved', units: requested, mmPerUnit: requested === 'in' ? MM_PER_INCH : 1, fromFile: false, inferred: false };
    const header = drawing.insUnits != null ? INSUNITS[drawing.insUnits] : undefined;
    if (header) return { kind: 'resolved', units: header.units, mmPerUnit: header.mmPerUnit, fromFile: true, inferred: false };
    const b = bboxOfEdges(drawing.cutEdges);
    const maxDim = Number.isFinite(b.minX) ? Math.max(b.maxX - b.minX, b.maxY - b.minY) : 0;
    const plausible = (mm: number) => mm >= PLAUSIBLE_PART_MM.min && mm <= PLAUSIBLE_PART_MM.max;
    const asMm = plausible(maxDim);
    const asIn = plausible(maxDim * MM_PER_INCH);
    if (asMm && !asIn) return { kind: 'resolved', units: 'mm', mmPerUnit: 1, fromFile: false, inferred: true };
    if (asIn && !asMm) return { kind: 'resolved', units: 'in', mmPerUnit: MM_PER_INCH, fromFile: false, inferred: true };
    if (!asMm && !asIn) return { kind: 'resolved', units: 'mm', mmPerUnit: 1, fromFile: false, inferred: true };
    return { kind: 'ambiguous', drawingMaxDim: maxDim };
}

export type DxfAnalysis =
    | {
          status: 'READY';
          units: PartUnits;
          features: PartFeatures;
          preview: PartPreview;
          geometry: GeometryResult;
          approximated: boolean;
          acadVersion: string | null;
      }
    | {
          status: 'NEEDS_INPUT';
          units: null;
          /** Preview in raw drawing units (unknown scale) so the UI can show the shape while asking. */
          preview: PartPreview;
          drawingMaxDim: number;
          acadVersion: string | null;
      };

function scaleEdges(edges: Edge[], k: number): Edge[] {
    if (k === 1) return edges;
    const m = { a: k, b: 0, c: 0, d: k, e: 0, f: 0 };
    return edges.flatMap((e) => transformEdge(e, m, 0.001));
}

/**
 * Analyze DXF bytes. Throws `UnsupportedFileError` (sniff) or `DxfParseError` (parse)
 * for files that must be rejected.
 */
export function analyzeDxfBytes(bytes: Uint8Array, opts: { units?: PartUnits } = {}): DxfAnalysis {
    const { text, info } = sniffDxf(bytes);
    const drawing = parseDxf(text);
    return analyzeDrawing(drawing, { units: opts.units, acadVersion: info.acadVersion });
}

export function analyzeDrawing(drawing: RawDrawing, opts: { units?: PartUnits; acadVersion?: string | null } = {}): DxfAnalysis {
    const resolution = resolveUnits(drawing, opts.units);
    if (resolution.kind === 'ambiguous') {
        const g = analyzeGeometry(drawing.cutEdges, drawing.bendLines);
        return { status: 'NEEDS_INPUT', units: null, preview: g.preview, drawingMaxDim: resolution.drawingMaxDim, acadVersion: opts.acadVersion ?? null };
    }
    const k = resolution.mmPerUnit;
    const edges = scaleEdges(drawing.cutEdges, k);
    const bends = drawing.bendLines.map((b) => ({ a: { x: b.a.x * k, y: b.a.y * k }, b: { x: b.b.x * k, y: b.b.y * k }, angleDeg: b.angleDeg }));
    const geometry = analyzeGeometry(edges, bends);
    const features: PartFeatures = {
        sourceUnits: resolution.units,
        unitsFromFile: resolution.fromFile,
        ...geometry.features,
        textEntityCount: drawing.textEntityCount,
        entityCounts: drawing.entityCounts,
    };
    return {
        status: 'READY',
        units: resolution.units,
        features,
        preview: geometry.preview,
        geometry,
        approximated: drawing.approximated,
        acadVersion: opts.acadVersion ?? null,
    };
}
