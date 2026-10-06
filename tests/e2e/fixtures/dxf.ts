/**
 * E2E DXF fixture generator: a real ASCII DXF (AC1009 / R12 entities, millimetres via
 * $INSUNITS=4) that goes through the production parser, DFM and pricing unchanged.
 *
 * Part: 150 x 90 mm cover plate with 8 mm corner radii (LINE + ARC outline),
 * 6 x Ø5.5 mm mounting holes and one Ø22 mm cable pass-through.
 */
export const COVER_PLATE = { widthMm: 150, heightMm: 90, cornerRadiusMm: 8, holeDiameterMm: 5.5, holeCount: 6, passThroughDiameterMm: 22 } as const;

const fmt = (v: number) => (Number.isInteger(v) ? `${v}.0` : v.toFixed(4));

export function coverPlateDxf(): string {
    const { widthMm: w, heightMm: h, cornerRadiusMm: r, holeDiameterMm: d, passThroughDiameterMm: p } = COVER_PLATE;
    const out: (string | number)[] = [0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1009', 9, '$INSUNITS', 70, 4, 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES'];
    const line = (x1: number, y1: number, x2: number, y2: number) => out.push(0, 'LINE', 8, 'CUT', 10, fmt(x1), 20, fmt(y1), 30, '0.0', 11, fmt(x2), 21, fmt(y2), 31, '0.0');
    const arc = (cx: number, cy: number, radius: number, a0: number, a1: number) =>
        out.push(0, 'ARC', 8, 'CUT', 10, fmt(cx), 20, fmt(cy), 30, '0.0', 40, fmt(radius), 50, fmt(a0), 51, fmt(a1));
    const circle = (cx: number, cy: number, radius: number) => out.push(0, 'CIRCLE', 8, 'CUT', 10, fmt(cx), 20, fmt(cy), 30, '0.0', 40, fmt(radius));

    // Outline: four straight edges joined by four 90° corner arcs (counter-clockwise).
    line(r, 0, w - r, 0);
    arc(w - r, r, r, 270, 360);
    line(w, r, w, h - r);
    arc(w - r, h - r, r, 0, 90);
    line(w - r, h, r, h);
    arc(r, h - r, r, 90, 180);
    line(0, h - r, 0, r);
    arc(r, r, r, 180, 270);

    for (const [cx, cy] of [
        [12, 12],
        [75, 12],
        [138, 12],
        [12, 78],
        [75, 78],
        [138, 78],
    ]) {
        circle(cx, cy, d / 2);
    }
    circle(75, 45, p / 2);
    out.push(0, 'ENDSEC', 0, 'EOF');
    return out.map(String).join('\n') + '\n';
}
