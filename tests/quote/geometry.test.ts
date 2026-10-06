/**
 * Golden geometry suite: programmatic DXF fixtures with analytically known
 * cut length / area / holes. Features must land within 0.5 %, counts and
 * geometry-DFM rule ids must match exactly.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeDxfBytes, resolveUnits } from '@/server/quote/analyze';
import { DEFAULT_DFM_RULES, resolveRuleset, runGeometryDfm } from '@/server/quote/dfm';
import { DxfParseError, MAX_BEND_LINES, parseDxf } from '@/server/quote/dxf/parse';
import { assertDxfFilename, sniffDxf, UnsupportedFileError } from '@/server/quote/dxf/sniff';
import { arcEdge, bulgeEdge, chainSignedArea, edgeLength, lineEdge, minWidth } from '@/server/quote/geometry/edges';
import { buildContours } from '@/server/quote/geometry/contours';
import { DxfWriter, rect } from './fixtures/dxf-writer';
import { FIXTURES, fixture } from './fixtures/fixtures';
import { FIXTURE_DIR } from './fixtures/generate';

const enc = (s: string) => new TextEncoder().encode(s);
const RULESET = resolveRuleset('dfm-test', DEFAULT_DFM_RULES as unknown as Record<string, unknown>);
/** Catalog-wide size limits of the R1 seed (metals 1143 × 762, plastics/wood 1200 × 600, walnut 600 × 295). */
const CATALOG_LIMITS = [
    { widthMm: 1143, heightMm: 762 },
    { widthMm: 1200, heightMm: 600 },
    { widthMm: 900, heightMm: 600 },
    { widthMm: 600, heightMm: 295 },
];

function within(actual: number | null | undefined, expected: number, pct = 0.5) {
    expect(actual).not.toBeNull();
    const tol = Math.max(Math.abs(expected) * (pct / 100), 1e-6);
    expect(Math.abs((actual as number) - expected), `expected ${actual} ≈ ${expected} (±${pct}%)`).toBeLessThanOrEqual(tol);
}

describe('golden DXF fixtures', () => {
    it('ships at least 10 fixtures and the committed .dxf files match the generator', () => {
        expect(FIXTURES.length).toBeGreaterThanOrEqual(10);
        for (const f of FIXTURES) {
            const onDisk = readFileSync(path.join(FIXTURE_DIR, `${f.name}.dxf`), 'utf8');
            expect(onDisk, `${f.name}.dxf is stale: run bun tests/quote/fixtures/generate.ts`).toBe(f.build());
        }
    });

    for (const f of FIXTURES) {
        it(`${f.name}: ${f.description}`, () => {
            const bytes = readFileSync(path.join(FIXTURE_DIR, `${f.name}.dxf`));
            const a = analyzeDxfBytes(new Uint8Array(bytes));
            const e = f.expected;
            expect(a.status).toBe(e.status);
            if (a.status !== 'READY') return;
            const x = a.features;
            if (e.units) expect(x.sourceUnits).toBe(e.units);
            if (e.unitsFromFile !== undefined) expect(x.unitsFromFile).toBe(e.unitsFromFile);
            if (e.bboxWidthMm !== undefined) within(x.bboxWidthMm, e.bboxWidthMm);
            if (e.bboxHeightMm !== undefined) within(x.bboxHeightMm, e.bboxHeightMm);
            if (e.cutLengthMm !== undefined) within(x.cutLengthMm, e.cutLengthMm);
            if (e.netAreaMm2 !== undefined) within(x.netAreaMm2, e.netAreaMm2);
            if (e.pierceCount !== undefined) expect(x.pierceCount).toBe(e.pierceCount);
            if (e.outerContourCount !== undefined) expect(x.outerContourCount).toBe(e.outerContourCount);
            if (e.innerContourCount !== undefined) expect(x.innerContourCount).toBe(e.innerContourCount);
            if (e.openContourCount !== undefined) expect(x.openContourCount).toBe(e.openContourCount);
            if (e.holeCount !== undefined) expect(x.holes.length).toBe(e.holeCount);
            if (e.smallestHoleMm !== undefined) {
                if (e.smallestHoleMm === null) expect(x.smallestHoleMm).toBeNull();
                else within(x.smallestHoleMm, e.smallestHoleMm);
            }
            if (e.minHoleToEdgeMm !== undefined) {
                if (e.minHoleToEdgeMm === null) expect(x.minHoleToEdgeMm).toBeNull();
                else within(x.minHoleToEdgeMm, e.minHoleToEdgeMm);
            }
            if (e.smallestFeatureMm !== undefined) {
                if (e.smallestFeatureMm === null) expect(x.smallestFeatureMm).toBeNull();
                else within(x.smallestFeatureMm, e.smallestFeatureMm, 1); // sampled medial-axis approximation
            }
            if (e.bendCount !== undefined) expect(x.bendCount).toBe(e.bendCount);
            if (e.textEntityCount !== undefined) expect(x.textEntityCount).toBe(e.textEntityCount);
            if (e.geometryDfm) {
                const v = runGeometryDfm(x, { ruleset: RULESET, catalogLimits: CATALOG_LIMITS, openEnds: [] });
                expect(v.map((r) => r.ruleId).sort()).toEqual([...e.geometryDfm].sort());
            }
            // Preview is normalized to the bbox origin and matches the features.
            expect(a.preview.widthMm).toBeCloseTo(x.bboxWidthMm, 2);
            expect(a.preview.outer.length).toBe(x.outerContourCount);
            expect(a.preview.holes.length).toBe(x.innerContourCount);
            for (const poly of [...a.preview.outer, ...a.preview.holes]) {
                for (const [px, py] of poly) {
                    expect(px).toBeGreaterThanOrEqual(-1e-3);
                    expect(py).toBeGreaterThanOrEqual(-1e-3);
                    expect(px).toBeLessThanOrEqual(x.bboxWidthMm + 1e-3);
                    expect(py).toBeLessThanOrEqual(x.bboxHeightMm + 1e-3);
                }
            }
            if (x.outerContourCount > 0) expect(a.preview.svgPath).toMatch(/^M[\d.]+ [\d.]+ L/);
        });
    }

    it('reports hole centres and edge distances in part space', () => {
        const a = analyzeDxfBytes(enc(fixture('hole-near-edge').build()));
        if (a.status !== 'READY') throw new Error('expected READY');
        expect(a.features.holes).toEqual([{ center: [3.5, 20], diameterMm: 5, circular: true, edgeDistanceMm: 1 }]);
        const slots = analyzeDxfBytes(enc(fixture('slotted-panel').build()));
        if (slots.status !== 'READY') throw new Error('expected READY');
        expect(slots.features.holes.every((h) => !h.circular)).toBe(true);
    });

    it('records bend lines with the angle parsed from the layer name', () => {
        const a = analyzeDxfBytes(enc(fixture('bent-bracket').build()));
        if (a.status !== 'READY') throw new Error('expected READY');
        expect(a.features.bendLines).toEqual([{ from: [0, 20], to: [120, 20], lengthMm: 120, angleDeg: 90 }]);
        expect(a.preview.bendLines).toEqual([
            [
                [0, 20],
                [120, 20],
            ],
        ]);
    });

    it('locates the loose ends of open contours for the DFM highlight', () => {
        const a = analyzeDxfBytes(enc(fixture('open-contour').build()));
        if (a.status !== 'READY') throw new Error('expected READY');
        const ends = a.geometry.openEnds.map((p) => [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100]);
        expect(ends).toEqual(
            expect.arrayContaining([
                [0, 0],
                [0, 0.5],
            ]),
        );
    });
});

describe('units', () => {
    it('asks when mm and inch are both plausible, and honours the buyer choice', () => {
        const bytes = enc(fixture('unitless-ambiguous').build());
        const ask = analyzeDxfBytes(bytes);
        expect(ask.status).toBe('NEEDS_INPUT');
        if (ask.status === 'NEEDS_INPUT') {
            expect(ask.drawingMaxDim).toBeCloseTo(30, 6);
            expect(ask.preview.widthMm).toBeCloseTo(30, 6); // raw drawing units
        }
        const inches = analyzeDxfBytes(bytes, { units: 'in' });
        const mm = analyzeDxfBytes(bytes, { units: 'mm' });
        if (inches.status !== 'READY' || mm.status !== 'READY') throw new Error('expected READY');
        within(inches.features.bboxWidthMm, 762);
        within(inches.features.bboxHeightMm, 508);
        expect(inches.features.unitsFromFile).toBe(false);
        within(mm.features.bboxWidthMm, 30);
    });

    it('maps $INSUNITS and infers from size only when one reading is plausible', () => {
        const edges = (size: number) => [lineEdge({ x: 0, y: 0 }, { x: size, y: 0 }), lineEdge({ x: size, y: 0 }, { x: size, y: size / 2 })];
        expect(resolveUnits({ insUnits: 4, cutEdges: edges(30) })).toMatchObject({ kind: 'resolved', units: 'mm', fromFile: true });
        expect(resolveUnits({ insUnits: 1, cutEdges: edges(30) })).toMatchObject({ kind: 'resolved', units: 'in', mmPerUnit: 25.4 });
        expect(resolveUnits({ insUnits: 5, cutEdges: edges(30) })).toMatchObject({ kind: 'resolved', units: 'mm', mmPerUnit: 10 });
        expect(resolveUnits({ insUnits: 0, cutEdges: edges(200) })).toMatchObject({ kind: 'resolved', units: 'mm', inferred: true });
        expect(resolveUnits({ insUnits: null, cutEdges: edges(3) })).toMatchObject({ kind: 'resolved', units: 'in', inferred: true });
        expect(resolveUnits({ insUnits: null, cutEdges: edges(30) })).toMatchObject({ kind: 'ambiguous' });
        expect(resolveUnits({ insUnits: 4, cutEdges: edges(30) }, 'in')).toMatchObject({ units: 'in', fromFile: false });
    });
});

describe('upload validation (extension + content sniff)', () => {
    it('accepts .dxf and rejects other formats with specific messages', () => {
        expect(() => assertDxfFilename('bracket.DXF')).not.toThrow();
        expect(() => assertDxfFilename('bracket.step')).toThrow(/coming in R1\.5/);
        expect(() => assertDxfFilename('bracket.stp')).toThrow(/coming in R1\.5/);
        expect(() => assertDxfFilename('bracket.dwg')).toThrow(/DWG/);
        expect(() => assertDxfFilename('logo.svg')).toThrow(UnsupportedFileError);
        expect(() => assertDxfFilename('noext')).toThrow(/\.dxf files only/);
    });

    it('sniffs magic bytes and DXF structure', () => {
        const reject = (bytes: Uint8Array, re: RegExp) => expect(() => sniffDxf(bytes)).toThrow(re);
        reject(enc('AutoCAD Binary DXF\r\n\x1a\x00rest'), /Binary DXF/);
        reject(enc('ISO-10303-21;\nHEADER;'), /coming in R1\.5/);
        reject(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), /PDF/);
        reject(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]), /archives/);
        reject(enc('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), /SVG/);
        reject(new Uint8Array(0), /empty/);
        reject(enc('hello world'), /not a DXF/);
        reject(enc('0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF\n'), /no ENTITIES/);
        reject(enc('0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1006\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n'), /older than R12/);
        reject(enc('0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1040\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n'), /newer than R2018/);
        const ok = sniffDxf(enc(fixture('plate-inches').build()));
        expect(ok.info).toEqual({ acadVersion: 'AC1015', releaseLabel: 'R2000' });
        expect(sniffDxf(enc(fixture('r12-unitless-mm').build())).info.acadVersion).toBeNull();
        expect(sniffDxf(enc('999\nwritten by a CAM tool\n0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n')).info.acadVersion).toBeNull();
    });

    it('counts every entity type, including ones the parser skips', () => {
        const d = parseDxf(fixture('plate-holes-mm').build().replace('0\nENDSEC\n0\nEOF', '0\nHATCH\n8\n0\n0\nENDSEC\n0\nEOF'));
        expect(d.entityCounts).toEqual({ LINE: 6, CIRCLE: 4, HATCH: 1 });
    });
});

describe('edge primitives', () => {
    it('turns bulges into exact arcs', () => {
        const semi = bulgeEdge({ x: 0, y: 0 }, { x: 10, y: 0 }, 1);
        expect(semi.kind).toBe('arc');
        expect(edgeLength(semi)).toBeCloseTo(5 * Math.PI, 9);
        if (semi.kind === 'arc') {
            expect(semi.c.x).toBeCloseTo(5, 9);
            expect(semi.c.y).toBeCloseTo(0, 9);
        }
        expect(bulgeEdge({ x: 0, y: 0 }, { x: 1, y: 0 }, 0).kind).toBe('line');
    });

    it('computes exact signed areas for chains with arcs', () => {
        expect(chainSignedArea([arcEdge({ x: 3, y: 4 }, 2, 0, Math.PI * 2)])).toBeCloseTo(Math.PI * 4, 9);
        expect(chainSignedArea([arcEdge({ x: 0, y: 0 }, 2, 0, -Math.PI * 2)])).toBeCloseTo(-Math.PI * 4, 9);
        // Upper half disc, counter-clockwise.
        const half = [arcEdge({ x: 0, y: 0 }, 1, 0, Math.PI), lineEdge({ x: -1, y: 0 }, { x: 1, y: 0 })];
        expect(chainSignedArea(half)).toBeCloseTo(Math.PI / 2, 9);
    });

    it('measures minimum width with rotating calipers', () => {
        const pts = [
            { x: 0, y: 0 },
            { x: 10, y: 10 },
            { x: 9, y: 11 },
            { x: -1, y: 1 },
        ];
        expect(minWidth(pts)).toBeCloseTo(Math.SQRT2, 6);
    });

    it('joins within 0.01 mm and leaves larger gaps open', () => {
        const square = (gap: number) => [
            lineEdge({ x: 0, y: 0 }, { x: 10, y: 0 }),
            lineEdge({ x: 10, y: 0 }, { x: 10, y: 10 }),
            lineEdge({ x: 10, y: 10 }, { x: 0, y: 10 }),
            lineEdge({ x: 0, y: 10 }, { x: 0, y: gap }),
        ];
        expect(buildContours(square(0.009), { tessellationTol: 0.01 })).toMatchObject({ closed: [expect.anything()], open: [] });
        expect(buildContours(square(0.02), { tessellationTol: 0.01 })).toMatchObject({ closed: [], open: [expect.anything()] });
    });
});

describe('performance', () => {
    it('analyzes a ~2 MB perforated panel well inside the 4 s instant-quote budget', () => {
        const w = new DxfWriter({ insUnits: 4 });
        rect(w, 0, 0, 1000, 600);
        let holes = 0;
        for (let x = 20; x < 990; x += 12) {
            for (let y = 20; y < 590; y += 12) {
                w.circle([x, y], 3);
                holes++;
            }
        }
        // Pad to ~2 MB with annotation text on an ignored layer (exercises the parser, not the geometry).
        const base = w.toString();
        const note = `0\nTEXT\n8\nNOTES\n10\n1.0\n20\n1.0\n40\n2.0\n1\n${'x'.repeat(200)}\n`;
        const pad = note.repeat(Math.ceil((2_000_000 - base.length) / note.length));
        const text = base.replace('0\nENDSEC\n0\nEOF', `${pad}0\nENDSEC\n0\nEOF`);
        expect(text.length).toBeGreaterThan(2_000_000);
        const t0 = performance.now();
        const a = analyzeDxfBytes(enc(text));
        const ms = performance.now() - t0;
        expect(a.status).toBe('READY');
        if (a.status === 'READY') expect(a.features.holes.length).toBe(holes);
        expect(ms).toBeLessThan(4000);
    });
});

describe('pathological files are refused quickly (CPU / memory DoS)', () => {
    const withInsertArray = (text: string, cols: number, rows: number) => text.replace(/(0\nINSERT\n(?:(?!0\n)[^\n]*\n[^\n]*\n)*?2\nB1\n)/, `$170\n${cols}\n71\n${rows}\n`);

    it('caps INSERT arrays whose block yields no cut edges (TEXT only)', () => {
        const w = new DxfWriter({ insUnits: 4 });
        w.block('B1', [0, 0], (ww, target) => {
            ww.circle([0, 0], 1, '0', target);
        });
        w.insert('B1', [0, 0]);
        // Swap the block content for a TEXT entity (no cut edges -> never hits MAX_CUT_EDGES).
        const text = withInsertArray(w.toString(), 100_000, 100_000).replace(/0\nCIRCLE\n(?:(?!0\n)[^\n]*\n[^\n]*\n)*/, '0\nTEXT\n8\n0\n10\n0.0\n20\n0.0\n40\n1.0\n1\nX\n');
        expect(text).toContain('70\n100000\n71\n100000');
        const t0 = performance.now();
        expect(() => parseDxf(text)).toThrow(DxfParseError);
        expect(performance.now() - t0).toBeLessThan(1000);
    });

    it('caps bend-line growth and refuses oversized INSERT arrays', () => {
        const w = new DxfWriter({ insUnits: 4 });
        w.block('B1', [0, 0], (ww, target) => {
            ww.line([0, 0], [10, 0], 'BEND_90', target);
        });
        w.insert('B1', [0, 0]);
        const src = w.toString();
        // 50 x 50 = 2500 bend lines per INSERT; repeat the INSERT until past MAX_BEND_LINES.
        const one = withInsertArray(src, 50, 50);
        const ins = /0\nINSERT\n[\s\S]*?(?=0\nENDSEC)/.exec(one.slice(one.indexOf('ENTITIES')))![0];
        const many = one.replace(ins, ins.repeat(Math.ceil(MAX_BEND_LINES / 2500) + 1));
        const t0 = performance.now();
        expect(() => parseDxf(many)).toThrow(/bend lines/);
        expect(() => parseDxf(withInsertArray(src, 101, 100))).toThrow(/too many entities/);
        expect(performance.now() - t0).toBeLessThan(1000);
    });

    it('does not run O(degree²) de Boor on a huge declared spline degree', () => {
        const degree = 20_000;
        const knots = Array.from({ length: degree + 3 }, (_, i) => (i <= degree ? 0 : 1));
        const w = new DxfWriter({ insUnits: 4 });
        rect(w, 0, 0, 100, 100);
        w.spline(degree, knots, [
            [10, 10],
            [90, 90],
        ]);
        const t0 = performance.now();
        const drawing = parseDxf(w.toString());
        expect(performance.now() - t0).toBeLessThan(1000);
        expect(drawing.approximated).toBe(true); // fell back to the control polygon
    });

    it('refuses deeply nested closed contours instead of stalling the containment pass', () => {
        const w = new DxfWriter({ insUnits: 4 });
        for (let i = 1; i <= 5000; i++) w.circle([0, 0], i * 0.5);
        const t0 = performance.now();
        expect(() => analyzeDxfBytes(enc(w.toString()))).toThrow(DxfParseError);
        expect(performance.now() - t0).toBeLessThan(3000);
    });

    it('refuses stacks of overlapping arcs instead of running a quadratic duplicate scan', () => {
        const arcs = Array.from({ length: 50_000 }, (_, i) => arcEdge({ x: 0, y: 0 }, 50, i * 1e-4, 0.5));
        const t0 = performance.now();
        expect(() => buildContours(arcs, { tessellationTol: 0.01 })).toThrow(DxfParseError);
        expect(performance.now() - t0).toBeLessThan(2000);
    });
});
