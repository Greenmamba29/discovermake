/**
 * Feature extraction + preview from normalized (mm) geometry.
 *
 * Coordinates in the outputs (hole centres, DFM locations, preview polygons)
 * are in part space: millimetres with the origin at the bottom-left of the
 * bounding box, matching `PartPreview`.
 */
import type { BendLine, HoleFeature, PartPreview } from '../../../contracts/parts';
import { buildContours, circleOf, JOIN_TOLERANCE_MM, type ClosedContour, type ContourSet } from './contours';
import {
    bboxOfEdges,
    dist,
    emptyBBox,
    extendBBoxEdge,
    minWidth,
    pointEdgeDistance,
    pointInPolygon,
    pointSegment2,
    tessellateChain,
    transformEdge,
    type BBox,
    type Edge,
    type Vec,
} from './edges';

export type BendLineInput = { a: Vec; b: Vec; angleDeg: number | null };

/** Geometry-derived features (the unit + entity bookkeeping fields are added by the analyzer). */
export type GeometryFeatures = {
    bboxWidthMm: number;
    bboxHeightMm: number;
    outerContourCount: number;
    innerContourCount: number;
    openContourCount: number;
    cutLengthMm: number;
    pierceCount: number;
    netAreaMm2: number;
    grossAreaMm2: number;
    /** Narrowest web/tab of material, excluding hole-to-edge distances (reported separately). */
    smallestFeatureMm: number | null;
    smallestHoleMm: number | null;
    minHoleToEdgeMm: number | null;
    holes: HoleFeature[];
    bendLines: BendLine[];
    bendCount: number;
};

export type GeometryResult = {
    features: GeometryFeatures;
    preview: PartPreview;
    /** Loose ends of open contours (part space) for the DFM highlight. */
    openEnds: Vec[];
    /** Where the narrowest web was measured (part space), if any. */
    smallestFeatureAt: Vec | null;
    /** Distinct closed-contour count removed as duplicates/overlaps during cleaning. */
    removedDuplicates: number;
    contours: ContourSet;
};

const round = (n: number, digits = 4) => {
    const k = 10 ** digits;
    return Math.round(n * k) / k;
};

function tessellationTolerance(b: BBox): number {
    const diag = Math.hypot(b.maxX - b.minX, b.maxY - b.minY);
    return Math.min(0.05, Math.max(0.005, diag / 20000));
}

// ---------------------------------------------------------------------------
// Web widths (approximate medial-axis): sampled boundary points vs. segments.
// ---------------------------------------------------------------------------

type Seg = { a: Vec; b: Vec; contour: number; len: number };
type Sample = { p: Vec; contour: number; tangents: Vec[] };

class SegmentGrid {
    private cells = new Map<number, number[]>();
    private readonly cols: number;
    constructor(
        readonly segs: Seg[],
        private readonly bbox: BBox,
        private readonly cell: number,
    ) {
        this.cols = Math.max(1, Math.ceil((bbox.maxX - bbox.minX) / cell) + 1);
        segs.forEach((s, i) => {
            const x0 = this.cx(Math.min(s.a.x, s.b.x));
            const x1 = this.cx(Math.max(s.a.x, s.b.x));
            const y0 = this.cy(Math.min(s.a.y, s.b.y));
            const y1 = this.cy(Math.max(s.a.y, s.b.y));
            for (let x = x0; x <= x1; x++) {
                for (let y = y0; y <= y1; y++) {
                    const k = y * this.cols + x;
                    const list = this.cells.get(k);
                    if (list) list.push(i);
                    else this.cells.set(k, [i]);
                }
            }
        });
    }
    private cx(x: number) {
        return Math.max(0, Math.floor((x - this.bbox.minX) / this.cell));
    }
    private cy(y: number) {
        return Math.max(0, Math.floor((y - this.bbox.minY) / this.cell));
    }
    /** Segment indices whose cells intersect the square of half-size r around p (may repeat). */
    query(p: Vec, r: number, visit: (i: number) => void): void {
        const x0 = this.cx(p.x - r);
        const x1 = this.cx(p.x + r);
        const y0 = this.cy(p.y - r);
        const y1 = this.cy(p.y + r);
        for (let x = x0; x <= x1; x++) {
            for (let y = y0; y <= y1; y++) {
                const list = this.cells.get(y * this.cols + x);
                if (list) for (const i of list) visit(i);
            }
        }
    }
}

const PERPENDICULAR_COS = Math.cos((75 * Math.PI) / 180);

function inMaterial(p: Vec, closed: ClosedContour[]): boolean {
    let count = 0;
    for (const c of closed) {
        const b = c.bbox;
        if (p.x < b.minX || p.x > b.maxX || p.y < b.minY || p.y > b.maxY) continue;
        if (pointInPolygon(p, c.polygon)) count++;
    }
    return count % 2 === 1;
}

/**
 * Narrowest material web between two boundary points facing each other, where
 * both boundaries are on the same side of the material (outer–outer, hole–hole,
 * self). Hole-to-edge distances are excluded here (see `minHoleToEdgeMm`).
 * Accepts a pair only when the measuring segment is perpendicular to the boundary
 * at both ends (rejects corners) and its midpoint lies in material.
 */
function smallestWeb(closed: ClosedContour[], bbox: BBox, circular: boolean[]): { width: number; at: Vec } | null {
    if (!closed.length) return null;
    const segs: Seg[] = [];
    const samples: Sample[] = [];
    let totalLen = 0;
    closed.forEach((c, ci) => {
        const pts = c.polygon;
        for (let k = 0; k < pts.length; k++) {
            const a = pts[k];
            const b = pts[(k + 1) % pts.length];
            const len = dist(a, b);
            if (len < 1e-9) continue;
            segs.push({ a, b, contour: ci, len });
            totalLen += len;
        }
    });
    if (!segs.length) return null;
    const maxSamples = 3000;
    const spacing = Math.max(totalLen / maxSamples, 0.1);
    // Very dense outlines (exploded splines): sample every k-th vertex to bound the work.
    const sampleable = segs.reduce((n, s) => n + (circular[s.contour] ? 0 : 1), 0);
    const stride = Math.max(1, Math.ceil(sampleable / 20000));
    for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        // Circle-to-circle webs are measured exactly (circleHoleWebs); circles stay as targets only.
        if (circular[s.contour] || i % stride !== 0) continue;
        const t = { x: (s.b.x - s.a.x) / s.len, y: (s.b.y - s.a.y) / s.len };
        const prev = segs[i - 1];
        const tangents = [t];
        if (prev && prev.contour === s.contour) tangents.push({ x: (prev.b.x - prev.a.x) / prev.len, y: (prev.b.y - prev.a.y) / prev.len });
        samples.push({ p: s.a, contour: s.contour, tangents });
        const n = Math.floor(s.len / spacing);
        for (let j = 1; j < n; j++) {
            const f = j / n;
            samples.push({ p: { x: s.a.x + (s.b.x - s.a.x) * f, y: s.a.y + (s.b.y - s.a.y) * f }, contour: s.contour, tangents: [t] });
        }
    }
    const diag = Math.hypot(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY);
    // No web can be wider than the part's smaller bounding-box side.
    const bound = Math.min(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY) * 1.001 + 1e-6;
    if (!samples.length) return null;
    const grid = segs.length > 400 ? new SegmentGrid(segs, bbox, Math.max(diag / 256, Math.sqrt(((bbox.maxX - bbox.minX) * (bbox.maxY - bbox.minY)) / segs.length), 0.25)) : null;
    const all = (_p: Vec, _r: number, visit: (i: number) => void) => {
        for (let i = 0; i < segs.length; i++) visit(i);
    };
    const query = grid ? grid.query.bind(grid) : all;
    let best = bound;
    let at: Vec | null = null;
    const parity = closed.map((c) => c.depth % 2);
    const seen = new Int32Array(segs.length).fill(-1);

    samples.forEach((s, si) => {
        query(s.p, best, (i) => {
            if (seen[i] === si) return;
            seen[i] = si;
            const seg = segs[i];
            if (parity[seg.contour] !== parity[s.contour]) return;
            const { d2, t } = pointSegment2(s.p, seg.a, seg.b);
            if (d2 >= best * best || d2 < 1e-12) return;
            const d = Math.sqrt(d2);
            if (t <= 1e-6 || t >= 1 - 1e-6) return; // foot must be interior (perpendicular at q)
            const q = { x: seg.a.x + (seg.b.x - seg.a.x) * t, y: seg.a.y + (seg.b.y - seg.a.y) * t };
            const v = { x: (q.x - s.p.x) / d, y: (q.y - s.p.y) / d };
            if (!s.tangents.some((tg) => Math.abs(tg.x * v.x + tg.y * v.y) <= PERPENDICULAR_COS)) return;
            const mid = { x: (s.p.x + q.x) / 2, y: (s.p.y + q.y) / 2 };
            if (!inMaterial(mid, closed)) return;
            best = d;
            at = mid;
        });
    });
    return at ? { width: best, at } : null;
}

// ---------------------------------------------------------------------------
// Holes
// ---------------------------------------------------------------------------

function chainDistance(from: ClosedContour, to: ClosedContour, tol: number): number {
    let best = Infinity;
    const fromPts = from.polygon;
    for (const p of fromPts) for (const e of to.edges) best = Math.min(best, pointEdgeDistance(p, e));
    const toPts = tessellateChain(to.edges, tol);
    for (const p of toPts) for (const e of from.edges) best = Math.min(best, pointEdgeDistance(p, e));
    return best;
}

function holeFeatures(closed: ClosedContour[], tol: number): HoleFeature[] {
    const holes: HoleFeature[] = [];
    closed.forEach((c) => {
        if (c.depth % 2 !== 1) return;
        const parent = c.parent >= 0 ? closed[c.parent] : null;
        const circle = circleOf(c, JOIN_TOLERANCE_MM);
        if (circle) {
            let edgeD = Infinity;
            if (parent) for (const e of parent.edges) edgeD = Math.min(edgeD, pointEdgeDistance(circle.center, e) - circle.r);
            holes.push({
                center: [round(circle.center.x), round(circle.center.y)],
                diameterMm: round(circle.r * 2),
                circular: true,
                edgeDistanceMm: round(Math.max(0, Number.isFinite(edgeD) ? edgeD : 0)),
            });
            return;
        }
        const width = minWidth(c.polygon);
        const edgeD = parent ? chainDistance(c, parent, tol) : 0;
        holes.push({
            center: [round((c.bbox.minX + c.bbox.maxX) / 2), round((c.bbox.minY + c.bbox.maxY) / 2)],
            diameterMm: round(Math.max(width, 1e-4)),
            circular: false,
            edgeDistanceMm: round(Math.max(0, edgeD)),
        });
    });
    return holes;
}

/** Exact web between sibling circular holes: |c1 - c2| - r1 - r2. */
function circleHoleWebs(closed: ClosedContour[]): { width: number; at: Vec } | null {
    const circles = closed
        .map((c) => (c.depth % 2 === 1 ? { c, circle: circleOf(c, JOIN_TOLERANCE_MM) } : null))
        .filter((x): x is { c: ClosedContour; circle: { center: Vec; r: number } } => Boolean(x?.circle));
    if (circles.length < 2 || circles.length > 4000) return null;
    let best = Infinity;
    let at: Vec | null = null;
    const sorted = [...circles].sort((p, q) => p.circle.center.x - q.circle.center.x);
    const maxR = Math.max(...sorted.map((s) => s.circle.r));
    for (let i = 0; i < sorted.length; i++) {
        const A = sorted[i].circle;
        for (let j = i + 1; j < sorted.length; j++) {
            const B = sorted[j].circle;
            if (B.center.x - A.center.x - A.r - maxR > best) break;
            if (sorted[i].c.parent !== sorted[j].c.parent) continue;
            const d = dist(A.center, B.center) - A.r - B.r;
            if (d > 1e-6 && d < best) {
                best = d;
                const u = { x: (B.center.x - A.center.x) / dist(A.center, B.center), y: (B.center.y - A.center.y) / dist(A.center, B.center) };
                at = { x: A.center.x + u.x * (A.r + d / 2), y: A.center.y + u.y * (A.r + d / 2) };
            }
        }
    }
    return at ? { width: best, at } : null;
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

const MAX_PREVIEW_POINTS = 40_000;

function fmt(n: number): string {
    const r = Math.round(n * 1000) / 1000;
    return Object.is(r, -0) ? '0' : String(r);
}

export function buildPreview(contours: ContourSet, bendLines: BendLineInput[], width: number, height: number, tol: number): PartPreview {
    let previewTol = Math.max(tol, Math.hypot(width, height) / 4000);
    let polys: { pts: Vec[]; hole: boolean }[] = [];
    for (let attempt = 0; attempt < 6; attempt++) {
        polys = contours.closed.map((c) => ({ pts: tessellateChain(c.edges, previewTol), hole: c.depth % 2 === 1 }));
        const total = polys.reduce((n, p) => n + p.pts.length, 0);
        if (total <= MAX_PREVIEW_POINTS) break;
        previewTol *= 3;
    }
    const toPoint = (p: Vec): [number, number] => [Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000];
    const outer = polys.filter((p) => !p.hole).map((p) => p.pts.map(toPoint));
    const holes = polys.filter((p) => p.hole).map((p) => p.pts.map(toPoint));
    // SVG: y axis points down, so flip around the bbox height. viewBox = "0 0 width height".
    const svgPath = polys
        .map((p) => p.pts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${fmt(pt.x)} ${fmt(height - pt.y)}`).join(' ') + ' Z')
        .join(' ');
    return {
        outer,
        holes,
        bendLines: bendLines.map((b) => [toPoint(b.a), toPoint(b.b)] as [[number, number], [number, number]]),
        widthMm: round(width, 3),
        heightMm: round(height, 3),
        svgPath,
    };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Analyze cut edges + bend lines that are already in millimetres. */
export function analyzeGeometry(edgesMm: Edge[], bendLinesMm: BendLineInput[]): GeometryResult {
    const raw = emptyBBox();
    for (const e of edgesMm) extendBBoxEdge(raw, e);
    if (!Number.isFinite(raw.minX)) {
        const empty: GeometryFeatures = {
            bboxWidthMm: 0,
            bboxHeightMm: 0,
            outerContourCount: 0,
            innerContourCount: 0,
            openContourCount: 0,
            cutLengthMm: 0,
            pierceCount: 0,
            netAreaMm2: 0,
            grossAreaMm2: 0,
            smallestFeatureMm: null,
            smallestHoleMm: null,
            minHoleToEdgeMm: null,
            holes: [],
            bendLines: [],
            bendCount: 0,
        };
        const contours: ContourSet = { closed: [], open: [], removedDuplicates: 0 };
        return { features: empty, preview: buildPreview(contours, [], 0, 0, 0.01), openEnds: [], smallestFeatureAt: null, removedDuplicates: 0, contours };
    }
    // Normalize: origin at the bottom-left of the bounding box.
    const shift = { a: 1, b: 0, c: 0, d: 1, e: -raw.minX, f: -raw.minY };
    const edges = edgesMm.flatMap((e) => transformEdge(e, shift, 0.01));
    const bends = bendLinesMm.map((b) => ({ a: { x: b.a.x - raw.minX, y: b.a.y - raw.minY }, b: { x: b.b.x - raw.minX, y: b.b.y - raw.minY }, angleDeg: b.angleDeg }));

    const tol = tessellationTolerance(bboxOfEdges(edges));
    const contours = buildContours(edges, { tessellationTol: tol });

    const bbox = emptyBBox();
    for (const c of contours.closed) for (const e of c.edges) extendBBoxEdge(bbox, e);
    for (const o of contours.open) for (const e of o.edges) extendBBoxEdge(bbox, e);
    const width = Number.isFinite(bbox.minX) ? bbox.maxX - bbox.minX : 0;
    const height = Number.isFinite(bbox.minY) ? bbox.maxY - bbox.minY : 0;

    let netArea = 0;
    let outerCount = 0;
    let innerCount = 0;
    for (const c of contours.closed) {
        if (c.depth % 2 === 0) {
            netArea += c.area;
            outerCount++;
        } else {
            netArea -= c.area;
            innerCount++;
        }
    }
    const cutLength = contours.closed.reduce((s, c) => s + c.length, 0) + contours.open.reduce((s, o) => s + o.length, 0);
    const holes = holeFeatures(contours.closed, tol);

    const circular = contours.closed.map((c) => circleOf(c, JOIN_TOLERANCE_MM) !== null);
    const webs = [smallestWeb(contours.closed, Number.isFinite(bbox.minX) ? bbox : raw, circular), circleHoleWebs(contours.closed)].filter(
        (w): w is { width: number; at: Vec } => Boolean(w),
    );
    const web = webs.length ? webs.reduce((p, q) => (q.width < p.width ? q : p)) : null;

    const bendLines: BendLine[] = bends
        .map((b) => ({ from: [round(b.a.x), round(b.a.y)] as [number, number], to: [round(b.b.x), round(b.b.y)] as [number, number], lengthMm: round(dist(b.a, b.b)), angleDeg: b.angleDeg }))
        .filter((b) => b.lengthMm > 0);

    const features: GeometryFeatures = {
        bboxWidthMm: round(width),
        bboxHeightMm: round(height),
        outerContourCount: outerCount,
        innerContourCount: innerCount,
        openContourCount: contours.open.length,
        cutLengthMm: round(cutLength),
        pierceCount: contours.closed.length + contours.open.length,
        netAreaMm2: round(Math.max(0, netArea)),
        grossAreaMm2: round(width * height),
        smallestFeatureMm: web ? round(web.width) : null,
        smallestHoleMm: holes.length ? Math.min(...holes.map((h) => h.diameterMm)) : null,
        minHoleToEdgeMm: holes.length ? Math.min(...holes.map((h) => h.edgeDistanceMm)) : null,
        holes,
        bendLines,
        bendCount: bendLines.length,
    };
    return {
        features,
        preview: buildPreview(contours, bends, width, height, tol),
        openEnds: contours.open.flatMap((o) => o.ends),
        smallestFeatureAt: web?.at ?? null,
        removedDuplicates: contours.removedDuplicates,
        contours,
    };
}
