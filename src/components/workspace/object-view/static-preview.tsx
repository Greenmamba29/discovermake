/**
 * No-WebGL fallbacks for the Object View: a dimensioned isometric box drawn from the CAD
 * bounding box (pure SVG, no three.js) and a WebGL probe that never touches jsdom's canvas.
 */
import { formatLength, type LengthUnit, type Vec3 } from './geometry';

/** True when the browser can create a WebGL context. False in jsdom and locked-down browsers. */
export function webglAvailable(): boolean {
    if (typeof window === 'undefined' || typeof document === 'undefined') return false;
    if (typeof (window as { WebGLRenderingContext?: unknown }).WebGLRenderingContext === 'undefined') return false;
    try {
        const c = document.createElement('canvas');
        return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
    } catch {
        return false;
    }
}

const COS30 = Math.cos(Math.PI / 6);
const SIN30 = 0.5;

/** Isometric drawing of the bounding box with X/Y/Z labels. */
export function IsoBoxPreview({ bbox, unit, label, className }: { bbox: Vec3; unit: LengthUnit; label: string; className?: string }) {
    const [x, y, z] = bbox;
    const max = Math.max(x, y, z, 1);
    const [sx, sy, sz] = [x / max, y / max, z / max].map((v) => Math.max(v, 0.04)) as [number, number, number];
    const p = (px: number, py: number, pz: number): [number, number] => [(px - py) * COS30, (px + py) * SIN30 - pz];
    const corners = {
        a: p(0, 0, 0),
        b: p(sx, 0, 0),
        c: p(sx, sy, 0),
        d: p(0, sy, 0),
        e: p(0, 0, sz),
        f: p(sx, 0, sz),
        g: p(sx, sy, sz),
        h: p(0, sy, sz),
    };
    const pts = Object.values(corners);
    const minX = Math.min(...pts.map((q) => q[0]));
    const maxX = Math.max(...pts.map((q) => q[0]));
    const minY = Math.min(...pts.map((q) => q[1]));
    const maxY = Math.max(...pts.map((q) => q[1]));
    const pad = 0.35;
    const vb = `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`;
    const poly = (...qs: [number, number][]) => qs.map((q) => q.join(',')).join(' ');
    const mid = (a: [number, number], b: [number, number], dx = 0, dy = 0): [number, number] => [(a[0] + b[0]) / 2 + dx, (a[1] + b[1]) / 2 + dy];
    const { a, b, c, d, e, f, g, h } = corners;
    const fs = 0.09;
    return (
        <svg viewBox={vb} className={className} role="img" aria-label={label} preserveAspectRatio="xMidYMid meet" data-testid="object-static-preview">
            <polygon points={poly(e, f, g, h)} fill="#3a403e" stroke="#a9afab" strokeWidth={0.012} />
            <polygon points={poly(a, b, f, e)} fill="#2b302f" stroke="#a9afab" strokeWidth={0.012} />
            <polygon points={poly(b, c, g, f)} fill="#232726" stroke="#a9afab" strokeWidth={0.012} />
            <line x1={a[0]} y1={a[1]} x2={d[0]} y2={d[1]} stroke="#5fe08a" strokeWidth={0.01} strokeDasharray="0.04 0.03" />
            <line x1={d[0]} y1={d[1]} x2={c[0]} y2={c[1]} stroke="#5fe08a" strokeWidth={0.01} strokeDasharray="0.04 0.03" />
            <line x1={d[0]} y1={d[1]} x2={h[0]} y2={h[1]} stroke="#5fe08a" strokeWidth={0.01} strokeDasharray="0.04 0.03" />
            <text x={mid(a, b, -0.05, 0.16)[0]} y={mid(a, b, -0.05, 0.16)[1]} fontSize={fs} fill="#eceeeb" textAnchor="middle" fontFamily="monospace">
                X {formatLength(x, unit)}
            </text>
            <text x={mid(b, c, 0.08, 0.14)[0]} y={mid(b, c, 0.08, 0.14)[1]} fontSize={fs} fill="#eceeeb" textAnchor="start" fontFamily="monospace">
                Y {formatLength(y, unit)}
            </text>
            <text x={mid(c, g, 0.08)[0]} y={mid(c, g, 0.08)[1]} fontSize={fs} fill="#eceeeb" textAnchor="start" fontFamily="monospace">
                Z {formatLength(z, unit)}
            </text>
        </svg>
    );
}
