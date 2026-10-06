/**
 * DXF -> drawing-space edges (still in the file's drawing units).
 *
 * Supported cut geometry: LINE, LWPOLYLINE / POLYLINE (incl. bulges), ARC, CIRCLE,
 * ELLIPSE (tessellated), SPLINE (de Boor evaluation, tessellated) and INSERT
 * (block references, nested, with scale/rotation/arrays).
 * - Lines on a layer whose name contains "BEND" are bend lines, not cuts.
 * - TEXT / MTEXT are counted (DFM warns; they are not cut).
 * - Annotation layers (DEFPOINTS, DIM*, NOTES, TITLE, BORDER, ...) and paper-space
 *   entities are ignored.
 */
import DxfParser from 'dxf-parser';
import type {
    IArcEntity,
    ICircleEntity,
    IDxf,
    IEllipseEntity,
    IEntity,
    IInsertEntity,
    ILineEntity,
    ILwpolylineEntity,
    IPolylineEntity,
    ISplineEntity,
} from 'dxf-parser';
import {
    IDENTITY,
    arcEdge,
    bulgeEdge,
    composeAffine,
    dist,
    lineEdge,
    transformEdge,
    trs,
    TAU,
    applyAffine,
    type Affine,
    type Edge,
    type Vec,
} from '../geometry/edges';

export type RawBendLine = { a: Vec; b: Vec; layer: string; angleDeg: number | null };

export type RawDrawing = {
    /** Header $INSUNITS (0 = unitless) or null when absent. */
    insUnits: number | null;
    cutEdges: Edge[];
    bendLines: RawBendLine[];
    textEntityCount: number;
    /** Raw entity counts by type (every entity in the ENTITIES section, supported or not). */
    entityCounts: Record<string, number>;
    /** True when splines/ellipses had to be tessellated (geometry is approximate). */
    approximated: boolean;
};

export class DxfParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'DxfParseError';
    }
}

/** Hard cap on cut edges so a pathological file cannot stall the instant quote. */
export const MAX_CUT_EDGES = 250_000;
const MAX_INSERT_DEPTH = 8;
/** Max instances one INSERT may expand to (rows x columns of a MINSERT array). */
export const MAX_INSERT_ARRAY = 10_000;
/**
 * Global work budget for the entity walk: every visited entity counts, including
 * ones that produce no cut edges (TEXT, bend lines, ignored layers, nested INSERTs),
 * so block-reference amplification cannot spin the parser.
 */
export const MAX_ENTITY_VISITS = 1_000_000;
export const MAX_BEND_LINES = 10_000;
/** Real DXF splines are degree 1–5; de Boor is O(degree²) per point, so cap it. */
export const MAX_SPLINE_DEGREE = 11;
const ELLIPSE_SEGMENTS_FULL = 360;
const SPLINE_SEGMENTS_PER_SPAN = 24;
/** Arc tessellation tolerance for non-uniformly scaled block arcs (drawing units). */
const PARSE_TOL = 0.001;

const IGNORED_LAYERS = /^(defpoints|dims?|dimensions?|annotations?|notes?|title(block)?|border|frame|construction|center(lines?)?)$/i;
const BEND_LAYER = /bend/i;
const MIRROR_X: Affine = { a: -1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function isIdentity(m: Affine): boolean {
    return m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0;
}

/** Count entities per type straight from the group-code stream (includes types dxf-parser skips). */
export function countEntities(text: string): Record<string, number> {
    const counts: Record<string, number> = {};
    const lines = text.split(/\r?\n/);
    let inEntities = false;
    for (let i = 0; i + 1 < lines.length; i += 2) {
        const code = lines[i].trim();
        if (code !== '0' && code !== '2') continue;
        const value = lines[i + 1].trim();
        if (code === '2' && !inEntities && value === 'ENTITIES') {
            inEntities = true;
            continue;
        }
        if (code !== '0') continue;
        if (inEntities) {
            if (value === 'ENDSEC') break;
            if (value === 'VERTEX' || value === 'SEQEND') continue;
            counts[value] = (counts[value] ?? 0) + 1;
        }
    }
    return counts;
}

function readInsUnits(dxf: IDxf, text: string): number | null {
    const v = dxf.header?.['$INSUNITS'];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    const m = /\$INSUNITS\s*\r?\n\s*70\s*\r?\n\s*(-?\d+)/.exec(text.slice(0, 200_000));
    return m ? Number(m[1]) : null;
}

export function parseBendAngle(layer: string): number | null {
    const m = /(-?\d+(?:\.\d+)?)/.exec(layer);
    if (!m) return null;
    const n = Math.abs(Number(m[1]));
    return n > 0 && n <= 180 ? n : null;
}

/** Evaluate a non-rational B-spline with de Boor's algorithm. */
function deBoor(degree: number, knots: number[], ctrl: Vec[], u: number): Vec {
    const n = ctrl.length;
    let k = degree;
    while (k < n - 1 && u >= knots[k + 1]) k++;
    const d: Vec[] = [];
    for (let j = 0; j <= degree; j++) d.push({ ...ctrl[j + k - degree] });
    for (let r = 1; r <= degree; r++) {
        for (let j = degree; j >= r; j--) {
            const i = j + k - degree;
            const denom = knots[i + degree + 1 - r] - knots[i];
            const alpha = denom === 0 ? 0 : (u - knots[i]) / denom;
            d[j] = { x: (1 - alpha) * d[j - 1].x + alpha * d[j].x, y: (1 - alpha) * d[j - 1].y + alpha * d[j].y };
        }
    }
    return d[degree];
}

function polylineEdges(points: Vec[], closed: boolean): Edge[] {
    const out: Edge[] = [];
    for (let i = 0; i + 1 < points.length; i++) out.push(lineEdge(points[i], points[i + 1]));
    if (closed && points.length > 2 && dist(points[0], points[points.length - 1]) > 1e-12) out.push(lineEdge(points[points.length - 1], points[0]));
    return out;
}

function tooComplex(): DxfParseError {
    return new DxfParseError(`This file has more than ${MAX_CUT_EDGES.toLocaleString('en-US')} cut segments, which is too complex for an instant quote. Simplify splines or contact support.`);
}

function splineEdges(e: ISplineEntity, budget: number): { edges: Edge[]; approximated: boolean } {
    const ctrl = (e.controlPoints ?? []).map((p) => ({ x: p.x, y: p.y }));
    const knots = e.knotValues ?? [];
    const degree = e.degreeOfSplineCurve ?? 3;
    const closed = Boolean(e.closed || e.periodic);
    // Degrees beyond MAX_SPLINE_DEGREE fall back to the fit points / control polygon below (linear work).
    if (ctrl.length >= 2 && degree >= 1 && degree <= MAX_SPLINE_DEGREE && knots.length === ctrl.length + degree + 1) {
        const lo = knots[degree];
        const hi = knots[ctrl.length];
        const spans: number[] = [];
        for (let i = degree; i < ctrl.length; i++) if (knots[i + 1] > knots[i]) spans.push(i);
        // Refuse before evaluating when the tessellation alone would blow the edge cap.
        if (spans.length * (degree === 1 ? 1 : SPLINE_SEGMENTS_PER_SPAN) > budget) throw tooComplex();
        const pts: Vec[] = [];
        for (const s of spans) {
            const a = knots[s];
            const b = knots[s + 1];
            const segs = degree === 1 ? 1 : SPLINE_SEGMENTS_PER_SPAN;
            for (let j = 0; j < segs; j++) pts.push(deBoor(degree, knots, ctrl, a + ((b - a) * j) / segs));
        }
        pts.push(deBoor(degree, knots, ctrl, hi - (hi - lo) * 1e-12));
        // Clamp the final point exactly onto the last control point for clamped splines.
        if (knots[ctrl.length + degree] === hi) pts[pts.length - 1] = ctrl[ctrl.length - 1];
        return { edges: polylineEdges(pts, closed), approximated: degree > 1 };
    }
    const fit = (e.fitPoints ?? []).map((p) => ({ x: p.x, y: p.y }));
    if (fit.length >= 2) return { edges: polylineEdges(fit, closed), approximated: true };
    if (ctrl.length >= 2) return { edges: polylineEdges(ctrl, closed), approximated: true };
    return { edges: [], approximated: false };
}

function ellipseEdges(e: IEllipseEntity): Edge[] {
    const c = { x: e.center.x, y: e.center.y };
    const major = { x: e.majorAxisEndPoint.x, y: e.majorAxisEndPoint.y };
    const ratio = e.axisRatio ?? 1;
    const minor = { x: -major.y * ratio, y: major.x * ratio };
    let t0 = e.startAngle ?? 0;
    let t1 = e.endAngle ?? TAU;
    if (t1 <= t0) t1 += TAU;
    const span = Math.min(t1 - t0, TAU);
    const full = Math.abs(span - TAU) < 1e-9;
    if (full) t0 = 0;
    const n = Math.max(8, Math.ceil((ELLIPSE_SEGMENTS_FULL * span) / TAU));
    const pts: Vec[] = [];
    for (let i = 0; i <= n; i++) {
        if (full && i === n) break;
        const t = t0 + (span * i) / n;
        pts.push({ x: c.x + major.x * Math.cos(t) + minor.x * Math.sin(t), y: c.y + major.y * Math.cos(t) + minor.y * Math.sin(t) });
    }
    return polylineEdges(pts, full);
}

function vertexEdges(vertices: { x: number; y: number; bulge?: number }[], closed: boolean): Edge[] {
    const pts = vertices.filter((v) => Number.isFinite(v.x) && Number.isFinite(v.y));
    const out: Edge[] = [];
    const count = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < count; i++) {
        const p = pts[i];
        const q = pts[(i + 1) % pts.length];
        if (dist(p, q) < 1e-12) continue;
        out.push(bulgeEdge({ x: p.x, y: p.y }, { x: q.x, y: q.y }, p.bulge ?? 0));
    }
    return out;
}

type Collector = RawDrawing & { edgeCount: number; visits: number };

function ocs(entityZ: number | undefined, m: Affine): Affine {
    return entityZ !== undefined && entityZ < 0 ? composeAffine(m, MIRROR_X) : m;
}

function emitEdges(out: Collector, edges: Edge[], m: Affine): void {
    for (const e of edges) {
        const list = isIdentity(m) ? [e] : transformEdge(e, m, PARSE_TOL);
        for (const t of list) {
            out.cutEdges.push(t);
            out.edgeCount++;
        }
    }
    if (out.edgeCount > MAX_CUT_EDGES) throw tooComplex();
}

function tooManyEntities(): DxfParseError {
    return new DxfParseError('This file expands to too many entities (block arrays or nested blocks) for an instant quote. Explode or simplify the drawing, or contact support.');
}

function pushBendLine(out: Collector, line: RawBendLine): void {
    if (out.bendLines.length >= MAX_BEND_LINES) {
        throw new DxfParseError(`This file has more than ${MAX_BEND_LINES.toLocaleString('en-US')} bend lines, which is too complex for an instant quote.`);
    }
    out.bendLines.push(line);
}

function walk(out: Collector, dxf: IDxf, entities: IEntity[], m: Affine, depth: number, inheritedLayer: string | null): void {
    for (const ent of entities) {
        if (++out.visits > MAX_ENTITY_VISITS) throw tooManyEntities();
        if (ent.inPaperSpace || ent.visible === false) continue;
        const layer = ent.layer && ent.layer !== '0' ? ent.layer : (inheritedLayer ?? ent.layer ?? '0');
        if (IGNORED_LAYERS.test(layer)) continue;
        const bendLayer = BEND_LAYER.test(layer);
        switch (ent.type) {
            case 'LINE': {
                const l = ent as ILineEntity;
                if (!l.vertices || l.vertices.length < 2) break;
                const a = { x: l.vertices[0].x, y: l.vertices[0].y };
                const b = { x: l.vertices[1].x, y: l.vertices[1].y };
                if (bendLayer) {
                    pushBendLine(out, { a: applyAffine(m, a), b: applyAffine(m, b), layer, angleDeg: parseBendAngle(layer) });
                } else {
                    emitEdges(out, [lineEdge(a, b)], m);
                }
                break;
            }
            case 'LWPOLYLINE': {
                const p = ent as ILwpolylineEntity;
                const verts = (p.vertices ?? []).map((v) => ({ x: v.x, y: v.y, bulge: v.bulge }));
                const mm = ocs(p.extrusionDirectionZ, m);
                if (bendLayer) {
                    for (let i = 0; i + 1 < verts.length; i++) {
                        pushBendLine(out, { a: applyAffine(mm, verts[i]), b: applyAffine(mm, verts[i + 1]), layer, angleDeg: parseBendAngle(layer) });
                    }
                    break;
                }
                emitEdges(out, vertexEdges(verts, Boolean(p.shape)), mm);
                break;
            }
            case 'POLYLINE': {
                const p = ent as IPolylineEntity;
                if (p.is3dPolygonMesh || p.isPolyfaceMesh) break;
                const verts = (p.vertices ?? []).filter((v) => !v.splineControlPoint).map((v) => ({ x: v.x, y: v.y, bulge: v.bulge }));
                const mm = ocs(p.extrusionDirection?.z, m);
                if (bendLayer) {
                    for (let i = 0; i + 1 < verts.length; i++) {
                        pushBendLine(out, { a: applyAffine(mm, verts[i]), b: applyAffine(mm, verts[i + 1]), layer, angleDeg: parseBendAngle(layer) });
                    }
                    break;
                }
                emitEdges(out, vertexEdges(verts, Boolean(p.shape)), mm);
                break;
            }
            case 'ARC': {
                const a = ent as IArcEntity;
                if (!a.center || !(a.radius > 0) || bendLayer) break;
                let sweep = ((a.endAngle ?? 0) - (a.startAngle ?? 0)) % TAU;
                if (sweep <= 1e-12) sweep += TAU;
                emitEdges(out, [arcEdge({ x: a.center.x, y: a.center.y }, a.radius, a.startAngle ?? 0, sweep)], ocs(a.extrusionDirectionZ, m));
                break;
            }
            case 'CIRCLE': {
                const c = ent as ICircleEntity;
                if (!c.center || !(c.radius > 0) || bendLayer) break;
                emitEdges(out, [arcEdge({ x: c.center.x, y: c.center.y }, c.radius, 0, TAU)], m);
                break;
            }
            case 'ELLIPSE': {
                const e = ent as IEllipseEntity;
                if (!e.center || !e.majorAxisEndPoint || bendLayer) break;
                out.approximated = true;
                emitEdges(out, ellipseEdges(e), m);
                break;
            }
            case 'SPLINE': {
                if (bendLayer) break;
                const s = splineEdges(ent as ISplineEntity, MAX_CUT_EDGES - out.edgeCount);
                if (s.approximated) out.approximated = true;
                emitEdges(out, s.edges, m);
                break;
            }
            case 'TEXT':
            case 'MTEXT':
                out.textEntityCount++;
                break;
            case 'INSERT': {
                const ins = ent as IInsertEntity;
                const block = dxf.blocks?.[ins.name];
                if (!block || !block.entities?.length || depth >= MAX_INSERT_DEPTH) break;
                const base = block.position ?? { x: 0, y: 0, z: 0 };
                const sx = ins.xScale ?? 1;
                const sy = ins.yScale ?? 1;
                const rot = ((ins.rotation ?? 0) * Math.PI) / 180;
                const cols = Math.max(1, Math.floor(ins.columnCount ?? 1));
                const rows = Math.max(1, Math.floor(ins.rowCount ?? 1));
                if (!Number.isFinite(cols * rows) || cols * rows > MAX_INSERT_ARRAY) throw tooManyEntities();
                const pos = ins.position ?? { x: 0, y: 0, z: 0 };
                for (let r = 0; r < rows; r++) {
                    for (let c = 0; c < cols; c++) {
                        const ox = c * (ins.columnSpacing ?? 0);
                        const oy = r * (ins.rowSpacing ?? 0);
                        const offset = { x: ox * Math.cos(rot) - oy * Math.sin(rot), y: ox * Math.sin(rot) + oy * Math.cos(rot) };
                        let local = trs(pos.x + offset.x, pos.y + offset.y, rot, sx, sy);
                        local = composeAffine(local, { a: 1, b: 0, c: 0, d: 1, e: -base.x, f: -base.y });
                        local = ocs(ins.extrusionDirection?.z, local);
                        walk(out, dxf, block.entities, composeAffine(m, local), depth + 1, layer);
                    }
                }
                break;
            }
            default:
                break;
        }
    }
}

/** Parse DXF text into drawing-space edges. Throws DxfParseError on unreadable files. */
export function parseDxf(text: string): RawDrawing {
    let dxf: IDxf | null;
    try {
        dxf = new DxfParser().parseSync(text);
    } catch (err) {
        throw new DxfParseError(`The DXF could not be read (${err instanceof Error ? err.message : String(err)}). Re-export it as ASCII DXF R12–R2018.`);
    }
    if (!dxf) throw new DxfParseError('The DXF could not be read. Re-export it as ASCII DXF R12–R2018.');
    const out: Collector = {
        insUnits: readInsUnits(dxf, text),
        cutEdges: [],
        bendLines: [],
        textEntityCount: 0,
        entityCounts: countEntities(text),
        approximated: false,
        edgeCount: 0,
        visits: 0,
    };
    walk(out, dxf, dxf.entities ?? [], IDENTITY, 0, null);
    const { edgeCount: _edgeCount, visits: _visits, ...drawing } = out;
    void _edgeCount;
    void _visits;
    return drawing;
}
