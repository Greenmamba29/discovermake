/**
 * 2D edge primitives for the quote engine's geometry pipeline.
 *
 * Contours are chains of exact LINE and ARC edges (splines and ellipses are
 * tessellated into lines at parse time). Keeping arcs exact means cut length
 * and area are analytically correct for circles, slots and bulged polylines;
 * tessellation is only used for containment tests, web widths and previews.
 *
 * Pure module: no I/O, safe to unit test.
 */

export type Vec = { x: number; y: number };

export type LineEdge = { kind: 'line'; a: Vec; b: Vec };
/**
 * Circular arc from `a` to `b` around `c`. `start` is the angle of `a` (radians);
 * `sweep` is signed (positive = counter-clockwise), |sweep| <= 2π. A full circle
 * has |sweep| = 2π and a === b.
 */
export type ArcEdge = { kind: 'arc'; c: Vec; r: number; start: number; sweep: number; a: Vec; b: Vec };
export type Edge = LineEdge | ArcEdge;

export const TAU = Math.PI * 2;

export const vec = (x: number, y: number): Vec => ({ x, y });
export const sub = (p: Vec, q: Vec): Vec => ({ x: p.x - q.x, y: p.y - q.y });
export const add = (p: Vec, q: Vec): Vec => ({ x: p.x + q.x, y: p.y + q.y });
export const scale = (p: Vec, k: number): Vec => ({ x: p.x * k, y: p.y * k });
export const dot = (p: Vec, q: Vec) => p.x * q.x + p.y * q.y;
export const cross = (p: Vec, q: Vec) => p.x * q.y - p.y * q.x;
export const dist = (p: Vec, q: Vec) => {
    const dx = p.x - q.x;
    const dy = p.y - q.y;
    return Math.sqrt(dx * dx + dy * dy);
};
export const arcPoint = (c: Vec, r: number, angle: number): Vec => ({ x: c.x + r * Math.cos(angle), y: c.y + r * Math.sin(angle) });

export function lineEdge(a: Vec, b: Vec): LineEdge {
    return { kind: 'line', a, b };
}

export function arcEdge(c: Vec, r: number, start: number, sweep: number): ArcEdge {
    const a = arcPoint(c, r, start);
    const full = Math.abs(Math.abs(sweep) - TAU) < 1e-12;
    const b = full ? a : arcPoint(c, r, start + sweep);
    return { kind: 'arc', c, r, start, sweep, a, b };
}

export function isFullCircle(e: Edge): boolean {
    return e.kind === 'arc' && Math.abs(Math.abs(e.sweep) - TAU) < 1e-9;
}

/**
 * Arc for a polyline segment p1 -> p2 with DXF bulge `bulge` (tan(sweep/4),
 * positive = counter-clockwise). Returns a line when the bulge is ~0.
 */
export function bulgeEdge(p1: Vec, p2: Vec, bulge: number): Edge {
    const chord = dist(p1, p2);
    if (!bulge || Math.abs(bulge) < 1e-12 || chord < 1e-12) return lineEdge(p1, p2);
    const sweep = 4 * Math.atan(bulge);
    const r = chord / (2 * Math.sin(sweep / 2)); // signed
    const dir = scale(sub(p2, p1), 1 / chord);
    const beta = Math.PI / 2 - sweep / 2;
    const rot = { x: dir.x * Math.cos(beta) - dir.y * Math.sin(beta), y: dir.x * Math.sin(beta) + dir.y * Math.cos(beta) };
    const c = add(p1, scale(rot, r));
    const start = Math.atan2(p1.y - c.y, p1.x - c.x);
    return { kind: 'arc', c, r: Math.abs(r), start, sweep, a: p1, b: p2 };
}

export function edgeLength(e: Edge): number {
    return e.kind === 'line' ? dist(e.a, e.b) : Math.abs(e.sweep) * e.r;
}

export function reverseEdge(e: Edge): Edge {
    if (e.kind === 'line') return { kind: 'line', a: e.b, b: e.a };
    return { kind: 'arc', c: e.c, r: e.r, start: e.start + e.sweep, sweep: -e.sweep, a: e.b, b: e.a };
}

/** Signed area contribution of an edge in a closed chain (shoelace term + circular segment). */
export function edgeAreaTerm(e: Edge): number {
    const chord = cross(e.a, e.b) / 2;
    if (e.kind === 'line') return chord;
    return chord + ((e.r * e.r) / 2) * (e.sweep - Math.sin(e.sweep));
}

/** Signed area of a closed chain of edges (positive = counter-clockwise). */
export function chainSignedArea(edges: Edge[]): number {
    let s = 0;
    for (const e of edges) s += edgeAreaTerm(e);
    return s;
}

export function chainLength(edges: Edge[]): number {
    let s = 0;
    for (const e of edges) s += edgeLength(e);
    return s;
}

/** Number of segments to tessellate an arc so the chord deviation stays below `tol`. */
export function arcSegments(r: number, sweep: number, tol: number): number {
    const abs = Math.abs(sweep);
    if (r <= tol) return Math.max(4, Math.ceil(abs / (Math.PI / 4)));
    const step = Math.min(2 * Math.acos(1 - tol / r), Math.PI / 18);
    const n = Math.ceil(abs / step);
    const minimum = Math.ceil((abs / TAU) * 16);
    return Math.min(720, Math.max(minimum, n, 1));
}

/** Points along an edge from `a` up to (excluding) `b`. */
export function tessellateEdge(e: Edge, tol: number): Vec[] {
    if (e.kind === 'line') return [e.a];
    const n = arcSegments(e.r, e.sweep, tol);
    const pts: Vec[] = [e.a];
    for (let i = 1; i < n; i++) pts.push(arcPoint(e.c, e.r, e.start + (e.sweep * i) / n));
    return pts;
}

/** Closed polygon (no repeated last point) for a closed chain. */
export function tessellateChain(edges: Edge[], tol: number): Vec[] {
    const pts: Vec[] = [];
    for (const e of edges) for (const p of tessellateEdge(e, tol)) pts.push(p);
    return pts;
}

/** Open polyline (includes the final endpoint) for an open chain. */
export function tessellateOpenChain(edges: Edge[], tol: number): Vec[] {
    const pts = tessellateChain(edges, tol);
    if (edges.length) pts.push(edges[edges.length - 1].b);
    return pts;
}

function normAngle(a: number): number {
    const r = a % TAU;
    return r < 0 ? r + TAU : r;
}

/** True when `angle` lies on the arc's sweep. */
export function angleOnArc(e: ArcEdge, angle: number): boolean {
    if (isFullCircle(e)) return true;
    const lo = e.sweep >= 0 ? e.start : e.start + e.sweep;
    const span = Math.abs(e.sweep);
    return normAngle(angle - lo) <= span + 1e-12;
}

export type BBox = { minX: number; minY: number; maxX: number; maxY: number };

export function emptyBBox(): BBox {
    return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export function extendBBox(b: BBox, p: Vec): void {
    if (p.x < b.minX) b.minX = p.x;
    if (p.y < b.minY) b.minY = p.y;
    if (p.x > b.maxX) b.maxX = p.x;
    if (p.y > b.maxY) b.maxY = p.y;
}

/** Exact bounding box of an edge (arcs include their axis extremes). */
export function extendBBoxEdge(b: BBox, e: Edge): void {
    extendBBox(b, e.a);
    extendBBox(b, e.b);
    if (e.kind === 'arc') {
        for (let k = 0; k < 4; k++) {
            const ang = (k * Math.PI) / 2;
            if (angleOnArc(e, ang)) extendBBox(b, arcPoint(e.c, e.r, ang));
        }
    }
}

export function bboxOfEdges(edges: Edge[]): BBox {
    const b = emptyBBox();
    for (const e of edges) extendBBoxEdge(b, e);
    return b;
}

/** Closest point on segment ab to p: distance and parameter t in [0,1]. */
export function pointSegment(p: Vec, a: Vec, b: Vec): { d: number; t: number } {
    const { d2, t } = pointSegment2(p, a, b);
    return { d: Math.sqrt(d2), t };
}

/** Squared distance variant of `pointSegment` (hot loops). */
export function pointSegment2(p: Vec, a: Vec, b: Vec): { d2: number; t: number } {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    let t = len2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2 : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const dx = p.x - (a.x + abx * t);
    const dy = p.y - (a.y + aby * t);
    return { d2: dx * dx + dy * dy, t };
}

/** Exact distance from a point to an edge. */
export function pointEdgeDistance(p: Vec, e: Edge): number {
    if (e.kind === 'line') return pointSegment(p, e.a, e.b).d;
    const ang = Math.atan2(p.y - e.c.y, p.x - e.c.x);
    if (angleOnArc(e, ang)) return Math.abs(dist(p, e.c) - e.r);
    return Math.min(dist(p, e.a), dist(p, e.b));
}

/** Even-odd point-in-polygon test (polygon given without repeated last point). */
export function pointInPolygon(p: Vec, poly: Vec[]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i];
        const b = poly[j];
        if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
}

/** 2D affine transform [a b c d e f]: x' = a x + c y + e, y' = b x + d y + f. */
export type Affine = { a: number; b: number; c: number; d: number; e: number; f: number };

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function applyAffine(m: Affine, p: Vec): Vec {
    return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

/** m1 ∘ m2 (apply m2 first). */
export function composeAffine(m1: Affine, m2: Affine): Affine {
    return {
        a: m1.a * m2.a + m1.c * m2.b,
        b: m1.b * m2.a + m1.d * m2.b,
        c: m1.a * m2.c + m1.c * m2.d,
        d: m1.b * m2.c + m1.d * m2.d,
        e: m1.a * m2.e + m1.c * m2.f + m1.e,
        f: m1.b * m2.e + m1.d * m2.f + m1.f,
    };
}

/** Translate · rotate(rad) · scale(sx, sy). */
export function trs(tx: number, ty: number, rotation: number, sx: number, sy: number): Affine {
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    return { a: cos * sx, b: sin * sx, c: -sin * sy, d: cos * sy, e: tx, f: ty };
}

/**
 * Transform an edge. Similarity transforms keep arcs exact (mirroring flips the
 * sweep); non-uniform scales tessellate the arc into lines.
 */
export function transformEdge(e: Edge, m: Affine, tol: number): Edge[] {
    if (e.kind === 'line') return [lineEdge(applyAffine(m, e.a), applyAffine(m, e.b))];
    const det = m.a * m.d - m.b * m.c;
    const sx = Math.hypot(m.a, m.b);
    const sy = Math.hypot(m.c, m.d);
    const orthogonal = Math.abs(m.a * m.c + m.b * m.d) < 1e-9 * Math.max(1, sx * sy);
    if (orthogonal && Math.abs(sx - sy) < 1e-9 * Math.max(1, sx)) {
        const c = applyAffine(m, e.c);
        const a = applyAffine(m, e.a);
        const start = Math.atan2(a.y - c.y, a.x - c.x);
        const sweep = det < 0 ? -e.sweep : e.sweep;
        const full = isFullCircle(e);
        return [{ kind: 'arc', c, r: e.r * sx, start, sweep, a, b: full ? a : applyAffine(m, e.b) }];
    }
    const pts = tessellateEdge(e, tol / Math.max(sx, sy, 1e-9));
    pts.push(e.b);
    const out: Edge[] = [];
    for (let i = 0; i + 1 < pts.length; i++) out.push(lineEdge(applyAffine(m, pts[i]), applyAffine(m, pts[i + 1])));
    return out;
}

/** Convex hull (Andrew's monotone chain), counter-clockwise. */
export function convexHull(points: Vec[]): Vec[] {
    const pts = [...points].sort((p, q) => p.x - q.x || p.y - q.y);
    if (pts.length < 3) return pts;
    const lower: Vec[] = [];
    for (const p of pts) {
        while (lower.length >= 2 && cross(sub(lower[lower.length - 1], lower[lower.length - 2]), sub(p, lower[lower.length - 2])) <= 0) lower.pop();
        lower.push(p);
    }
    const upper: Vec[] = [];
    for (let i = pts.length - 1; i >= 0; i--) {
        const p = pts[i];
        while (upper.length >= 2 && cross(sub(upper[upper.length - 1], upper[upper.length - 2]), sub(p, upper[upper.length - 2])) <= 0) upper.pop();
        upper.push(p);
    }
    upper.pop();
    lower.pop();
    return lower.concat(upper);
}

/** Minimum width of a point set (rotating calipers over the convex hull). */
export function minWidth(points: Vec[]): number {
    const hull = convexHull(points);
    if (hull.length < 3) return 0;
    let best = Infinity;
    for (let i = 0; i < hull.length; i++) {
        const a = hull[i];
        const b = hull[(i + 1) % hull.length];
        const len = dist(a, b);
        if (len < 1e-12) continue;
        let maxD = 0;
        for (const p of hull) {
            const d = Math.abs(cross(sub(b, a), sub(p, a))) / len;
            if (d > maxD) maxD = d;
        }
        if (maxD < best) best = maxD;
    }
    return Number.isFinite(best) ? best : 0;
}
