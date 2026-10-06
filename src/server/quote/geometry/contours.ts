/**
 * Contour building: clean duplicate / overlapping segments, join endpoints within
 * a tolerance (0.01 mm), walk closed and open chains, and classify closed
 * contours by containment depth (even depth = material boundary, odd = hole).
 */
import {
    bboxOfEdges,
    chainLength,
    chainSignedArea,
    cross,
    dist,
    dot,
    edgeLength,
    isFullCircle,
    pointInPolygon,
    reverseEdge,
    sub,
    tessellateChain,
    tessellateOpenChain,
    TAU,
    type BBox,
    type Edge,
    type Vec,
} from './edges';

/** Endpoint join tolerance (workflow 02: "join near-closed contours, tolerance 0.01 mm"). */
export const JOIN_TOLERANCE_MM = 0.01;

export type ClosedContour = {
    edges: Edge[];
    /** Tessellated polygon (counter-clockwise or clockwise as drawn; no repeated last point). */
    polygon: Vec[];
    signedArea: number;
    area: number;
    length: number;
    bbox: BBox;
    /** 0 = outermost material boundary, 1 = hole, 2 = island inside a hole, ... */
    depth: number;
    /** Index of the immediately containing contour, or -1. */
    parent: number;
};

export type OpenContour = {
    edges: Edge[];
    polyline: Vec[];
    length: number;
    /** The two loose ends (for the DFM highlight). */
    ends: [Vec, Vec];
};

export type ContourSet = {
    closed: ClosedContour[];
    open: OpenContour[];
    /** Segments removed as exact duplicates or merged overlaps. */
    removedDuplicates: number;
};

// ---------------------------------------------------------------------------
// Cleaning
// ---------------------------------------------------------------------------

/**
 * Remove zero-length edges, exact duplicate arcs/circles and duplicate or
 * overlapping collinear line segments (overlaps are merged into one segment).
 * Collinear segments that only touch end-to-end are kept as-is.
 */
export function cleanEdges(edges: Edge[], tol: number): { edges: Edge[]; removed: number } {
    let removed = 0;
    const lines: Edge[] = [];
    const arcs: Edge[] = [];
    for (const e of edges) {
        if (e.kind === 'arc') {
            if (e.r <= tol / 10 || (!isFullCircle(e) && Math.abs(e.sweep) * e.r <= tol / 10)) {
                removed++;
                continue;
            }
            arcs.push(e);
        } else {
            if (dist(e.a, e.b) <= tol / 10) {
                removed++;
                continue;
            }
            lines.push(e);
        }
    }

    // Arcs: drop duplicates (same circle, same endpoints in either direction, same span).
    const keptArcs: Edge[] = [];
    const arcKey = (e: Edge & { kind: 'arc' }) => `${Math.round(e.c.x / tol)}|${Math.round(e.c.y / tol)}|${Math.round(e.r / tol)}`;
    const arcBuckets = new Map<string, (Edge & { kind: 'arc' })[]>();
    for (const e of arcs as (Edge & { kind: 'arc' })[]) {
        const k = arcKey(e);
        const bucket = arcBuckets.get(k) ?? [];
        const dup = bucket.some((o) => {
            if (Math.abs(Math.abs(o.sweep) - Math.abs(e.sweep)) > 1e-6) return false;
            if (isFullCircle(o) && isFullCircle(e)) return true;
            return (dist(o.a, e.a) <= tol && dist(o.b, e.b) <= tol) || (dist(o.a, e.b) <= tol && dist(o.b, e.a) <= tol);
        });
        if (dup) {
            removed++;
            continue;
        }
        bucket.push(e);
        arcBuckets.set(k, bucket);
        keptArcs.push(e);
    }

    // Lines: group by supporting line, merge overlapping intervals.
    type Item = { s0: number; s1: number; edge: Edge };
    const groups = new Map<string, { dir: Vec; origin: Vec; items: Item[] }>();
    for (const e of lines) {
        let dx = e.b.x - e.a.x;
        let dy = e.b.y - e.a.y;
        const len = Math.hypot(dx, dy);
        dx /= len;
        dy /= len;
        if (dx < -1e-12 || (Math.abs(dx) <= 1e-12 && dy < 0)) {
            dx = -dx;
            dy = -dy;
        }
        const offset = cross({ x: dx, y: dy }, e.a);
        const angleKey = Math.round(Math.atan2(dy, dx) * 1e6);
        const key = `${angleKey}|${Math.round(offset / tol)}`;
        let g = groups.get(key);
        if (!g) {
            g = { dir: { x: dx, y: dy }, origin: { x: -dy * offset, y: dx * offset }, items: [] };
            groups.set(key, g);
        }
        const sa = dot(sub(e.a, g.origin), g.dir);
        const sb = dot(sub(e.b, g.origin), g.dir);
        g.items.push({ s0: Math.min(sa, sb), s1: Math.max(sa, sb), edge: e });
    }
    const keptLines: Edge[] = [];
    for (const g of groups.values()) {
        if (g.items.length === 1) {
            keptLines.push(g.items[0].edge);
            continue;
        }
        g.items.sort((p, q) => p.s0 - q.s0 || p.s1 - q.s1);
        let cur: Item & { merged: boolean } = { ...g.items[0], merged: false };
        const flush = () => {
            if (!cur.merged) keptLines.push(cur.edge);
            else {
                const a = { x: g.origin.x + g.dir.x * cur.s0, y: g.origin.y + g.dir.y * cur.s0 };
                const b = { x: g.origin.x + g.dir.x * cur.s1, y: g.origin.y + g.dir.y * cur.s1 };
                keptLines.push({ kind: 'line', a, b });
            }
        };
        for (let i = 1; i < g.items.length; i++) {
            const it = g.items[i];
            if (it.s0 < cur.s1 - tol) {
                // Overlap (or duplicate): merge.
                removed++;
                cur = { s0: cur.s0, s1: Math.max(cur.s1, it.s1), edge: cur.edge, merged: true };
            } else {
                flush();
                cur = { ...it, merged: false };
            }
        }
        flush();
    }
    return { edges: [...keptLines, ...keptArcs], removed };
}

// ---------------------------------------------------------------------------
// Joining
// ---------------------------------------------------------------------------

class NodeIndex {
    private cells = new Map<string, number[]>();
    readonly nodes: Vec[] = [];
    constructor(private readonly tol: number) {}

    private key(ix: number, iy: number) {
        return `${ix}|${iy}`;
    }

    find(p: Vec): number {
        const ix = Math.floor(p.x / this.tol);
        const iy = Math.floor(p.y / this.tol);
        let best = -1;
        let bestD = Infinity;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const ids = this.cells.get(this.key(ix + dx, iy + dy));
                if (!ids) continue;
                for (const id of ids) {
                    const d = dist(this.nodes[id], p);
                    if (d <= this.tol && d < bestD) {
                        best = id;
                        bestD = d;
                    }
                }
            }
        }
        if (best >= 0) return best;
        const id = this.nodes.length;
        this.nodes.push(p);
        const k = this.key(ix, iy);
        const list = this.cells.get(k) ?? [];
        list.push(id);
        this.cells.set(k, list);
        return id;
    }
}

type GraphEdge = { edge: Edge; n0: number; n1: number };

/** Join edges into chains. Endpoints within `tol` are treated as coincident. */
export function joinEdges(edges: Edge[], tol: number): { closed: Edge[][]; open: Edge[][] } {
    const index = new NodeIndex(tol);
    const closed: Edge[][] = [];
    const graph: GraphEdge[] = [];
    for (const e of edges) {
        if (isFullCircle(e)) {
            closed.push([e]);
            continue;
        }
        const n0 = index.find(e.a);
        const n1 = index.find(e.b);
        if (n0 === n1 && edgeLength(e) <= tol * 2) continue; // collapsed sliver
        graph.push({ edge: e, n0, n1 });
    }
    const adjacency: number[][] = index.nodes.map(() => []);
    graph.forEach((g, i) => {
        adjacency[g.n0].push(i);
        adjacency[g.n1].push(i);
    });
    const used = new Uint8Array(graph.length);

    const nextFrom = (node: number): { idx: number; forward: boolean } | null => {
        for (const idx of adjacency[node]) {
            if (used[idx]) continue;
            const g = graph[idx];
            return { idx, forward: g.n0 === node };
        }
        return null;
    };

    const open: Edge[][] = [];
    for (let i = 0; i < graph.length; i++) {
        if (used[i]) continue;
        used[i] = 1;
        const first = graph[i];
        const chain: Edge[] = [first.edge];
        const startNode = first.n0;
        let cur = first.n1;
        let isClosed = cur === startNode;
        while (!isClosed) {
            const nx = nextFrom(cur);
            if (!nx) break;
            used[nx.idx] = 1;
            const g = graph[nx.idx];
            chain.push(nx.forward ? g.edge : reverseEdge(g.edge));
            cur = nx.forward ? g.n1 : g.n0;
            if (cur === startNode) isClosed = true;
        }
        if (isClosed) {
            closed.push(chain);
            continue;
        }
        // Open: extend backwards from the start node.
        let head = startNode;
        for (;;) {
            const nx = nextFrom(head);
            if (!nx) break;
            used[nx.idx] = 1;
            const g = graph[nx.idx];
            // Edge leaving `head`; prepend it reversed so the chain stays continuous.
            chain.unshift(nx.forward ? reverseEdge(g.edge) : g.edge);
            head = nx.forward ? g.n1 : g.n0;
        }
        open.push(chain);
    }
    return { closed, open };
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function bboxInside(inner: BBox, outer: BBox, tol: number): boolean {
    return inner.minX >= outer.minX - tol && inner.minY >= outer.minY - tol && inner.maxX <= outer.maxX + tol && inner.maxY <= outer.maxY + tol;
}

/** Build the contour set from cleaned edges (all in mm). */
export function buildContours(rawEdges: Edge[], opts: { tol?: number; tessellationTol: number }): ContourSet {
    const tol = opts.tol ?? JOIN_TOLERANCE_MM;
    const { edges, removed } = cleanEdges(rawEdges, tol);
    const chains = joinEdges(edges, tol);

    const closed: ClosedContour[] = chains.closed
        .map((chain) => {
            const signedArea = chainSignedArea(chain);
            return {
                edges: chain,
                polygon: tessellateChain(chain, opts.tessellationTol),
                signedArea,
                area: Math.abs(signedArea),
                length: chainLength(chain),
                bbox: bboxOfEdges(chain),
                depth: 0,
                parent: -1,
            };
        })
        .filter((c) => c.area > tol * tol && c.polygon.length >= 2);

    // Containment: sort by area descending so parents come first.
    const order = closed.map((_, i) => i).sort((a, b) => closed[b].area - closed[a].area);
    for (let oi = 0; oi < order.length; oi++) {
        const i = order[oi];
        const c = closed[i];
        const probe = c.polygon[0];
        let bestParent = -1;
        let bestArea = Infinity;
        let depth = 0;
        for (let oj = 0; oj < oi; oj++) {
            const j = order[oj];
            const p = closed[j];
            if (p.area <= c.area) continue;
            if (!bboxInside(c.bbox, p.bbox, tol)) continue;
            if (!pointInPolygon(probe, p.polygon)) continue;
            depth++;
            if (p.area < bestArea) {
                bestArea = p.area;
                bestParent = j;
            }
        }
        c.depth = depth;
        c.parent = bestParent;
    }

    const open: OpenContour[] = chains.open.map((chain) => ({
        edges: chain,
        polyline: tessellateOpenChain(chain, opts.tessellationTol),
        length: chainLength(chain),
        ends: [chain[0].a, chain[chain.length - 1].b],
    }));
    return { closed, open, removedDuplicates: removed };
}

/** True when a closed contour is a circle made of arcs sharing one centre and radius. */
export function circleOf(contour: ClosedContour, tol: number): { center: Vec; r: number } | null {
    const first = contour.edges[0];
    if (first.kind !== 'arc') return null;
    let total = 0;
    for (const e of contour.edges) {
        if (e.kind !== 'arc') return null;
        if (dist(e.c, first.c) > tol || Math.abs(e.r - first.r) > tol) return null;
        total += Math.abs(e.sweep);
    }
    if (Math.abs(total - TAU) > 1e-6) return null;
    return { center: first.c, r: first.r };
}
