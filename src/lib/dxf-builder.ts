/**
 * Tiny ASCII DXF writer for the bundled starter designs (Discover, onboarding). Same conventions
 * as `sample-dxf.ts`: AC1015, millimetres via `$INSUNITS = 4`, cut geometry on layer `CUT`,
 * press-brake bend lines on layer `BEND` (the analyzer treats any layer containing "BEND" as
 * bend lines, never cuts). Files go through exactly the same upload -> analyze -> quote API as
 * any customer file.
 *
 * Shapes are closed contours: polylines (with optional bulges for arcs), circles, rounded
 * rectangles and obround slots. `shapeSvgPath` draws the same shapes for card previews.
 */

export type Pt = readonly [number, number];

export type Shape =
    /** Closed polyline. `bulges[i]` is the bulge of the segment that starts at `pts[i]` (tan(θ/4); + = counter-clockwise). */
    | { kind: 'poly'; pts: readonly Pt[]; bulges?: readonly number[] }
    | { kind: 'circle'; c: Pt; r: number }
    /** Rectangle from (x, y) with optional corner radius. */
    | { kind: 'rect'; x: number; y: number; w: number; h: number; r?: number }
    /** Obround slot: centre, length between arc centres, width; horizontal unless `vertical`. */
    | { kind: 'slot'; c: Pt; length: number; width: number; vertical?: boolean };

export type BendLine = { a: Pt; b: Pt };

export type FlatPattern = { cuts: readonly Shape[]; bends?: readonly BendLine[] };

/** Bulge of a 90° counter-clockwise arc. */
const QUARTER = Math.tan(Math.PI / 8);

/** Any shape as a closed polyline with bulges (circles stay circles). */
export function toPoly(shape: Exclude<Shape, { kind: 'circle' }>): { pts: Pt[]; bulges: number[] } {
    if (shape.kind === 'poly') return { pts: [...shape.pts], bulges: shape.pts.map((_, i) => shape.bulges?.[i] ?? 0) };
    if (shape.kind === 'rect') {
        const { x, y, w, h } = shape;
        const r = Math.min(shape.r ?? 0, w / 2, h / 2);
        if (r <= 0) return { pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], bulges: [0, 0, 0, 0] };
        return {
            pts: [
                [x + r, y],
                [x + w - r, y],
                [x + w, y + r],
                [x + w, y + h - r],
                [x + w - r, y + h],
                [x + r, y + h],
                [x, y + h - r],
                [x, y + r],
            ],
            bulges: [0, QUARTER, 0, QUARTER, 0, QUARTER, 0, QUARTER],
        };
    }
    const { c, length, width } = shape;
    const r = width / 2;
    const half = length / 2;
    if (shape.vertical) {
        return {
            pts: [
                [c[0] + r, c[1] - half],
                [c[0] + r, c[1] + half],
                [c[0] - r, c[1] + half],
                [c[0] - r, c[1] - half],
            ],
            bulges: [0, 1, 0, 1],
        };
    }
    return {
        pts: [
            [c[0] - half, c[1] - r],
            [c[0] + half, c[1] - r],
            [c[0] + half, c[1] + r],
            [c[0] - half, c[1] + r],
        ],
        bulges: [0, 1, 0, 1],
    };
}

const num = (v: number) => {
    const r = Math.round(v * 1e6) / 1e6;
    return Number.isInteger(r) ? `${r}.0` : String(r);
};

/** Serialize a flat pattern to an ASCII DXF (AC1015, mm). */
export function buildDxf(pattern: FlatPattern): string {
    const g: (string | number)[] = [0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1015', 9, '$INSUNITS', 70, 4, 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES'];
    let handle = 0x100;
    const common = (layer: string, sub: string) => [5, (handle++).toString(16).toUpperCase(), 100, 'AcDbEntity', 8, layer, 100, sub];
    for (const shape of pattern.cuts) {
        if (shape.kind === 'circle') {
            g.push(0, 'CIRCLE', ...common('CUT', 'AcDbCircle'), 10, num(shape.c[0]), 20, num(shape.c[1]), 30, '0.0', 40, num(shape.r));
            continue;
        }
        const { pts, bulges } = toPoly(shape);
        g.push(0, 'LWPOLYLINE', ...common('CUT', 'AcDbPolyline'), 90, pts.length, 70, 1);
        pts.forEach(([x, y], i) => {
            g.push(10, num(x), 20, num(y));
            if (bulges[i]) g.push(42, num(bulges[i]));
        });
    }
    for (const bend of pattern.bends ?? []) {
        g.push(0, 'LINE', ...common('BEND', 'AcDbLine'), 10, num(bend.a[0]), 20, num(bend.a[1]), 30, '0.0', 11, num(bend.b[0]), 21, num(bend.b[1]), 31, '0.0');
    }
    g.push(0, 'ENDSEC', 0, 'EOF');
    return g.map(String).join('\n') + '\n';
}

/** Bounding box of the cut geometry (mm). */
export function patternBounds(pattern: FlatPattern): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const add = (x: number, y: number) => {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    };
    for (const s of pattern.cuts) {
        if (s.kind === 'circle') {
            add(s.c[0] - s.r, s.c[1] - s.r);
            add(s.c[0] + s.r, s.c[1] + s.r);
        } else {
            // Arcs here never bulge past the polyline's own extents by more than the corner radius,
            // which the outline vertices already bound for the shapes we use.
            for (const [x, y] of toPoly(s).pts) add(x, y);
        }
    }
    return { minX, minY, maxX, maxY };
}

const f = (v: number) => String(Math.round(v * 100) / 100);

/**
 * SVG path data for a shape in a y-up coordinate system: render it inside
 * `<g transform="scale(1 -1)">` (or flip the viewBox) so arcs sweep the right way.
 */
export function shapeSvgPath(shape: Shape): string {
    if (shape.kind === 'circle') {
        const [cx, cy] = shape.c;
        const r = shape.r;
        return `M${f(cx + r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 1 ${f(cx - r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 1 ${f(cx + r)} ${f(cy)}Z`;
    }
    const { pts, bulges } = toPoly(shape);
    let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const bulge = bulges[i];
        if (!bulge) {
            d += `L${f(b[0])} ${f(b[1])}`;
            continue;
        }
        const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const radius = (chord * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
        const large = Math.abs(bulge) > 1 ? 1 : 0;
        const sweep = bulge > 0 ? 1 : 0;
        d += `A${f(radius)} ${f(radius)} 0 ${large} ${sweep} ${f(b[0])} ${f(b[1])}`;
    }
    return `${d}Z`;
}
