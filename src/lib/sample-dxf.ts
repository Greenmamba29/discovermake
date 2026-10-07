/**
 * "Try a sample part": builds a real ASCII DXF (AC1015, millimetres) in the
 * browser so a first-time visitor can run the full upload -> analyze -> quote
 * pipeline without a CAD file. It goes through exactly the same API as any
 * uploaded file; nothing about the result is simulated.
 *
 * Part: 120 x 80 mm mounting plate, 4 x Ø6.5 mm corner holes, Ø30 mm centre cutout.
 */
const num = (v: number) => (Number.isInteger(v) ? `${v}.0` : String(v));

export function sampleBracketDxf(): string {
    const g: (string | number)[] = [0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1015', 9, '$INSUNITS', 70, 4, 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES'];
    let handle = 0x100;
    const common = (sub: string) => [5, (handle++).toString(16).toUpperCase(), 100, 'AcDbEntity', 8, '0', 100, sub];
    const outer: [number, number][] = [
        [0, 0],
        [120, 0],
        [120, 80],
        [0, 80],
    ];
    g.push(0, 'LWPOLYLINE', ...common('AcDbPolyline'), 90, outer.length, 70, 1);
    for (const [x, y] of outer) g.push(10, num(x), 20, num(y));
    const circle = (cx: number, cy: number, r: number) => g.push(0, 'CIRCLE', ...common('AcDbCircle'), 10, num(cx), 20, num(cy), 30, '0.0', 40, num(r));
    for (const [cx, cy] of [
        [12, 12],
        [108, 12],
        [108, 68],
        [12, 68],
    ]) {
        circle(cx, cy, 3.25);
    }
    circle(60, 40, 15);
    g.push(0, 'ENDSEC', 0, 'EOF');
    return g.map(String).join('\n') + '\n';
}

export function sampleBracketFile(): File {
    return new File([sampleBracketDxf()], 'sample-mounting-plate.dxf', { type: 'application/dxf' });
}
