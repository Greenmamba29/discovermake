/**
 * Wall thickness of a generated part, measured on its STL (pure, no I/O).
 *
 * A Make AI model has no spec with a declared wall, so the print DFM's `minWallMm` comes from the
 * mesh: from evenly spread surface samples (area-weighted, deterministic) a ray goes straight into
 * the material (against the face normal) and the distance to where it leaves is the local
 * thickness (the "shape diameter" method). The result is a low percentile of those distances, so
 * one sliver at a sharp corner does not decide it, but any real thin wall does.
 */

export type Triangle = { a: Vec; b: Vec; c: Vec; n: Vec; area: number };
type Vec = [number, number, number];

const sub = (p: Vec, q: Vec): Vec => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const cross = (p: Vec, q: Vec): Vec => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
const dot = (p: Vec, q: Vec) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];

/** Binary or ASCII STL -> triangles with unit normals from the winding (the stored normal is ignored). */
export function parseStl(bytes: Uint8Array): Triangle[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = bytes.byteLength >= 84 ? view.getUint32(80, true) : 0;
    const vertices: Vec[] = [];
    if (bytes.byteLength >= 84 && 84 + count * 50 === bytes.byteLength) {
        for (let i = 0; i < count; i++) {
            const o = 84 + i * 50 + 12;
            for (let v = 0; v < 3; v++) vertices.push([view.getFloat32(o + v * 12, true), view.getFloat32(o + v * 12 + 4, true), view.getFloat32(o + v * 12 + 8, true)]);
        }
    } else {
        const text = new TextDecoder().decode(bytes);
        const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
        for (let m = re.exec(text); m; m = re.exec(text)) vertices.push([Number(m[1]), Number(m[2]), Number(m[3])]);
    }
    const tris: Triangle[] = [];
    for (let i = 0; i + 2 < vertices.length; i += 3) {
        const [a, b, c] = [vertices[i]!, vertices[i + 1]!, vertices[i + 2]!];
        const nRaw = cross(sub(b, a), sub(c, a));
        const len = Math.hypot(...nRaw);
        if (!(len > 1e-12)) continue;
        tris.push({ a, b, c, n: [nRaw[0] / len, nRaw[1] / len, nRaw[2] / len], area: len / 2 });
    }
    return tris;
}

// ---- a small BVH over the triangles ----
type Node = { min: Vec; max: Vec; left?: Node; right?: Node; items?: number[] };

function bounds(tris: Triangle[], idx: number[]): { min: Vec; max: Vec } {
    const min: Vec = [Infinity, Infinity, Infinity];
    const max: Vec = [-Infinity, -Infinity, -Infinity];
    for (const i of idx) {
        const t = tris[i]!;
        for (const p of [t.a, t.b, t.c]) for (let k = 0; k < 3; k++) {
            if (p[k]! < min[k]!) min[k] = p[k]!;
            if (p[k]! > max[k]!) max[k] = p[k]!;
        }
    }
    return { min, max };
}

function build(tris: Triangle[], idx: number[], centroids: Vec[], depth = 0): Node {
    const { min, max } = bounds(tris, idx);
    if (idx.length <= 8 || depth > 40) return { min, max, items: idx };
    const ext = sub(max, min);
    const axis = ext[0] >= ext[1] && ext[0] >= ext[2] ? 0 : ext[1] >= ext[2] ? 1 : 2;
    const sorted = [...idx].sort((p, q) => centroids[p]![axis]! - centroids[q]![axis]!);
    const mid = sorted.length >> 1;
    return { min, max, left: build(tris, sorted.slice(0, mid), centroids, depth + 1), right: build(tris, sorted.slice(mid), centroids, depth + 1) };
}

function hitsBox(o: Vec, inv: Vec, min: Vec, max: Vec, tMax: number): boolean {
    let t0 = 0;
    let t1 = tMax;
    for (let k = 0; k < 3; k++) {
        let a = (min[k]! - o[k]!) * inv[k]!;
        let b = (max[k]! - o[k]!) * inv[k]!;
        if (a > b) [a, b] = [b, a];
        if (a > t0) t0 = a;
        if (b < t1) t1 = b;
        if (t0 > t1) return false;
    }
    return true;
}

/** Möller-Trumbore; returns the distance along d, or Infinity. */
function hitTri(o: Vec, d: Vec, t: Triangle): number {
    const e1 = sub(t.b, t.a);
    const e2 = sub(t.c, t.a);
    const p = cross(d, e2);
    const det = dot(e1, p);
    if (Math.abs(det) < 1e-12) return Infinity;
    const inv = 1 / det;
    const s = sub(o, t.a);
    const u = dot(s, p) * inv;
    if (u < 0 || u > 1) return Infinity;
    const q = cross(s, e1);
    const v = dot(d, q) * inv;
    if (v < 0 || u + v > 1) return Infinity;
    const dist = dot(e2, q) * inv;
    return dist > 1e-6 ? dist : Infinity;
}

function nearest(root: Node, tris: Triangle[], o: Vec, d: Vec, skip: number): number {
    const inv: Vec = [1 / (d[0] || 1e-30), 1 / (d[1] || 1e-30), 1 / (d[2] || 1e-30)];
    let best = Infinity;
    const stack: Node[] = [root];
    while (stack.length) {
        const node = stack.pop()!;
        if (!hitsBox(o, inv, node.min, node.max, best)) continue;
        if (node.items) {
            for (const i of node.items) {
                if (i === skip) continue;
                const t = hitTri(o, d, tris[i]!);
                if (t < best) best = t;
            }
        } else {
            stack.push(node.left!, node.right!);
        }
    }
    return best;
}

export type WallMeasurement = { minWallMm: number; samples: number };

/**
 * Thinnest wall (mm) of a closed mesh. `percentile` (default 2) of the per-sample thicknesses;
 * null for an empty or open mesh where no ray finds the far side.
 */
export function measureMinWall(tris: Triangle[], opts: { samples?: number; percentile?: number } = {}): WallMeasurement | null {
    if (tris.length < 4) return null;
    const samples = Math.min(opts.samples ?? 1500, tris.length * 4);
    const centroids: Vec[] = tris.map((t) => [(t.a[0] + t.b[0] + t.c[0]) / 3, (t.a[1] + t.b[1] + t.c[1]) / 3, (t.a[2] + t.b[2] + t.c[2]) / 3]);
    const root = build(tris, tris.map((_, i) => i), centroids);
    const total = tris.reduce((s, t) => s + t.area, 0);
    const step = total / samples;
    const out: number[] = [];
    let acc = step / 2;
    let cum = 0;
    for (let i = 0; i < tris.length && out.length < samples; i++) {
        const t = tris[i]!;
        cum += t.area;
        // One ray per `step` of surface area that falls inside this triangle (at least the big faces).
        let k = 0;
        while (acc <= cum && out.length < samples) {
            // Spread multiple samples on one triangle with barycentric offsets around the centroid.
            const w = k === 0 ? [1 / 3, 1 / 3, 1 / 3] : [[0.6, 0.2, 0.2], [0.2, 0.6, 0.2], [0.2, 0.2, 0.6]][(k - 1) % 3]!;
            const o: Vec = [0, 1, 2].map((j) => w[0]! * t.a[j]! + w[1]! * t.b[j]! + w[2]! * t.c[j]!) as Vec;
            const d: Vec = [-t.n[0], -t.n[1], -t.n[2]];
            const dist = nearest(root, tris, o, d, i);
            if (Number.isFinite(dist)) out.push(dist);
            acc += step;
            k++;
        }
    }
    if (out.length < Math.min(20, samples / 2)) return null;
    out.sort((p, q) => p - q);
    const pct = Math.min(Math.max(opts.percentile ?? 2, 0), 50);
    const value = out[Math.min(out.length - 1, Math.floor((pct / 100) * out.length))]!;
    return { minWallMm: Math.round(value * 100) / 100, samples: out.length };
}
