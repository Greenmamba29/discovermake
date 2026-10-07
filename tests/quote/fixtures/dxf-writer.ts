/**
 * Minimal ASCII DXF writer for golden test fixtures.
 * Emits R2000-style group codes (handles + subclass markers) by default, or a
 * header-less R12 stream (`acadVersion: null, insUnits: null`) for legacy writers.
 */
type Pt = [number, number];

const n = (v: number) => {
    const r = Math.round(v * 1e9) / 1e9;
    return Object.is(r, -0) ? '0.0' : Number.isInteger(r) ? `${r}.0` : String(r);
};

export type DxfWriterOptions = {
    /** $ACADVER, e.g. "AC1015". null = no HEADER section (minimal R12 writer). */
    acadVersion?: string | null;
    /** $INSUNITS (1 = inch, 4 = mm, 0 = unitless). null = omitted. */
    insUnits?: number | null;
};

export class DxfWriter {
    private entities: string[] = [];
    private blocks: string[] = [];
    private handle = 0x100;
    private readonly modern: boolean;

    constructor(private readonly opts: DxfWriterOptions = {}) {
        this.modern = opts.acadVersion !== null && opts.acadVersion !== 'AC1009';
    }

    private h(): string[] {
        return this.modern ? ['5', (this.handle++).toString(16).toUpperCase()] : [];
    }

    private common(sub: string, layer: string): string[] {
        return [...this.h(), ...(this.modern ? ['100', 'AcDbEntity'] : []), '8', layer, ...(this.modern ? ['100', sub] : [])];
    }

    private push(target: string[], groups: string[]) {
        target.push(groups.join('\n'));
    }

    line(a: Pt, b: Pt, layer = '0', target = this.entities): this {
        this.push(target, ['0', 'LINE', ...this.common('AcDbLine', layer), '10', n(a[0]), '20', n(a[1]), '30', '0.0', '11', n(b[0]), '21', n(b[1]), '31', '0.0']);
        return this;
    }

    /** Polyline of [x, y, bulge?] vertices. */
    lwpolyline(vertices: [number, number, number?][], closed: boolean, layer = '0', target = this.entities): this {
        const g = ['0', 'LWPOLYLINE', ...this.common('AcDbPolyline', layer), '90', String(vertices.length), '70', closed ? '1' : '0'];
        for (const [x, y, bulge] of vertices) {
            g.push('10', n(x), '20', n(y));
            if (bulge) g.push('42', n(bulge));
        }
        this.push(target, g);
        return this;
    }

    /** Legacy R12 POLYLINE / VERTEX / SEQEND. */
    polyline(vertices: [number, number, number?][], closed: boolean, layer = '0'): this {
        const g = ['0', 'POLYLINE', ...this.common('AcDb2dPolyline', layer), '66', '1', '10', '0.0', '20', '0.0', '30', '0.0', '70', closed ? '1' : '0'];
        for (const [x, y, bulge] of vertices) {
            g.push('0', 'VERTEX', ...this.common('AcDb2dVertex', layer), '10', n(x), '20', n(y), '30', '0.0');
            if (bulge) g.push('42', n(bulge));
        }
        g.push('0', 'SEQEND', ...this.common('AcDbEntity', layer));
        this.push(this.entities, g);
        return this;
    }

    circle(c: Pt, r: number, layer = '0', target = this.entities): this {
        this.push(target, ['0', 'CIRCLE', ...this.common('AcDbCircle', layer), '10', n(c[0]), '20', n(c[1]), '30', '0.0', '40', n(r)]);
        return this;
    }

    /** Arc counter-clockwise from startDeg to endDeg. */
    arc(c: Pt, r: number, startDeg: number, endDeg: number, layer = '0'): this {
        this.push(this.entities, [
            '0',
            'ARC',
            ...this.common('AcDbCircle', layer),
            '10',
            n(c[0]),
            '20',
            n(c[1]),
            '30',
            '0.0',
            '40',
            n(r),
            ...(this.modern ? ['100', 'AcDbArc'] : []),
            '50',
            n(startDeg),
            '51',
            n(endDeg),
        ]);
        return this;
    }

    ellipse(c: Pt, majorEnd: Pt, ratio: number, start = 0, end = Math.PI * 2, layer = '0'): this {
        this.push(this.entities, [
            '0',
            'ELLIPSE',
            ...this.common('AcDbEllipse', layer),
            '10',
            n(c[0]),
            '20',
            n(c[1]),
            '30',
            '0.0',
            '11',
            n(majorEnd[0]),
            '21',
            n(majorEnd[1]),
            '31',
            '0.0',
            '40',
            n(ratio),
            '41',
            n(start),
            '42',
            n(end),
        ]);
        return this;
    }

    spline(degree: number, knots: number[], control: Pt[], closed = false, layer = '0'): this {
        const g = ['0', 'SPLINE', ...this.common('AcDbSpline', layer), '70', String(closed ? 1 | 8 : 8), '71', String(degree), '72', String(knots.length), '73', String(control.length), '74', '0'];
        for (const k of knots) g.push('40', n(k));
        for (const p of control) g.push('10', n(p[0]), '20', n(p[1]), '30', '0.0');
        this.push(this.entities, g);
        return this;
    }

    text(at: Pt, height: number, value: string, layer = '0'): this {
        this.push(this.entities, ['0', 'TEXT', ...this.common('AcDbText', layer), '10', n(at[0]), '20', n(at[1]), '30', '0.0', '40', n(height), '1', value]);
        return this;
    }

    /** Define a block; `draw` receives a target array for its entities. */
    block(name: string, base: Pt, draw: (w: DxfWriter, target: string[]) => void): this {
        const body: string[] = [];
        draw(this, body);
        this.push(this.blocks, [
            '0',
            'BLOCK',
            ...this.h(),
            ...(this.modern ? ['100', 'AcDbEntity'] : []),
            '8',
            '0',
            ...(this.modern ? ['100', 'AcDbBlockBegin'] : []),
            '2',
            name,
            '70',
            '0',
            '10',
            n(base[0]),
            '20',
            n(base[1]),
            '30',
            '0.0',
            '3',
            name,
        ]);
        this.blocks.push(...body);
        this.push(this.blocks, ['0', 'ENDBLK', ...this.h(), ...(this.modern ? ['100', 'AcDbEntity', '8', '0', '100', 'AcDbBlockEnd'] : ['8', '0'])]);
        return this;
    }

    insert(name: string, at: Pt, opts: { scale?: number; rotationDeg?: number } = {}, layer = '0'): this {
        const s = opts.scale ?? 1;
        this.push(this.entities, [
            '0',
            'INSERT',
            ...this.common('AcDbBlockReference', layer),
            '2',
            name,
            '10',
            n(at[0]),
            '20',
            n(at[1]),
            '30',
            '0.0',
            '41',
            n(s),
            '42',
            n(s),
            '43',
            n(s),
            '50',
            n(opts.rotationDeg ?? 0),
        ]);
        return this;
    }

    toString(): string {
        const out: string[] = [];
        if (this.opts.acadVersion !== null || (this.opts.insUnits !== null && this.opts.insUnits !== undefined)) {
            const header = ['0', 'SECTION', '2', 'HEADER'];
            if (this.opts.acadVersion !== null) header.push('9', '$ACADVER', '1', this.opts.acadVersion ?? 'AC1015');
            if (this.opts.insUnits !== null && this.opts.insUnits !== undefined) header.push('9', '$INSUNITS', '70', String(this.opts.insUnits));
            header.push('0', 'ENDSEC');
            out.push(header.join('\n'));
        }
        if (this.blocks.length) out.push(['0', 'SECTION', '2', 'BLOCKS'].join('\n'), ...this.blocks, ['0', 'ENDSEC'].join('\n'));
        out.push(['0', 'SECTION', '2', 'ENTITIES'].join('\n'), ...this.entities, ['0', 'ENDSEC', '0', 'EOF'].join('\n'));
        return out.join('\n') + '\n';
    }
}

/** Closed rectangle as an LWPOLYLINE. */
export function rect(w: DxfWriter, x0: number, y0: number, width: number, height: number, layer = '0'): DxfWriter {
    return w.lwpolyline(
        [
            [x0, y0],
            [x0 + width, y0],
            [x0 + width, y0 + height],
            [x0, y0 + height],
        ],
        true,
        layer,
    );
}
