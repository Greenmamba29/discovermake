/**
 * Golden DXF fixtures with analytically known geometry.
 *
 * `bun tests/quote/fixtures/generate.ts` writes them to tests/quote/fixtures/dxf/*.dxf
 * (committed, so the UI / e2e can upload real files). The golden test asserts the
 * files on disk match this generator byte for byte.
 */
import { DxfWriter, rect } from './dxf-writer';

const PI = Math.PI;
const BULGE_90 = Math.tan(PI / 8);
const IN = 25.4;

export type Expected = {
    status: 'READY' | 'NEEDS_INPUT';
    units?: 'mm' | 'in';
    unitsFromFile?: boolean;
    bboxWidthMm?: number;
    bboxHeightMm?: number;
    cutLengthMm?: number;
    netAreaMm2?: number;
    pierceCount?: number;
    outerContourCount?: number;
    innerContourCount?: number;
    openContourCount?: number;
    holeCount?: number;
    smallestHoleMm?: number | null;
    minHoleToEdgeMm?: number | null;
    smallestFeatureMm?: number | null;
    bendCount?: number;
    textEntityCount?: number;
    /** Exact rule ids of the geometry-only DFM pass at analyze time. */
    geometryDfm?: string[];
};

export type Fixture = { name: string; description: string; build: () => string; expected: Expected };

export const FIXTURES: Fixture[] = [
    {
        name: 'plate-holes-mm',
        description: '100 × 60 mm plate drawn as LINEs (one 0.004 mm corner gap, one duplicate and one overlapping segment) with four Ø6 holes',
        build: () => {
            const w = new DxfWriter({ insUnits: 4 });
            w.line([0, 0], [100, 0]);
            w.line([100, 0], [100, 60]);
            w.line([100, 60], [0, 60]);
            w.line([0, 60], [0.004, 0]); // 0.004 mm gap at the origin corner (< 0.01 mm join tolerance)
            w.line([0, 0], [100, 0]); // exact duplicate
            w.line([30, 60], [70, 60]); // overlapping collinear segment
            for (const c of [
                [10, 10],
                [90, 10],
                [10, 50],
                [90, 50],
            ] as [number, number][])
                w.circle(c, 3);
            return w.toString();
        },
        expected: {
            status: 'READY',
            units: 'mm',
            unitsFromFile: true,
            bboxWidthMm: 100,
            bboxHeightMm: 60,
            cutLengthMm: 320 + 4 * PI * 6,
            netAreaMm2: 6000 - 4 * PI * 9,
            pierceCount: 5,
            outerContourCount: 1,
            innerContourCount: 4,
            openContourCount: 0,
            holeCount: 4,
            smallestHoleMm: 6,
            minHoleToEdgeMm: 7,
            smallestFeatureMm: 34,
            geometryDfm: [],
        },
    },
    {
        name: 'l-bracket-flat',
        description: 'L-shaped flat (80 × 80, 30 mm arms) as one closed LWPOLYLINE',
        build: () =>
            new DxfWriter({ insUnits: 4 })
                .lwpolyline(
                    [
                        [0, 0],
                        [80, 0],
                        [80, 30],
                        [30, 30],
                        [30, 80],
                        [0, 80],
                    ],
                    true,
                )
                .toString(),
        expected: {
            status: 'READY',
            units: 'mm',
            bboxWidthMm: 80,
            bboxHeightMm: 80,
            cutLengthMm: 320,
            netAreaMm2: 3900,
            pierceCount: 1,
            holeCount: 0,
            smallestHoleMm: null,
            minHoleToEdgeMm: null,
            smallestFeatureMm: 30,
            geometryDfm: [],
        },
    },
    {
        name: 'slotted-panel',
        description: '150 × 80 panel with three 28 × 8 obround slots (LWPOLYLINE bulges = semicircles)',
        build: () => {
            const w = new DxfWriter({ insUnits: 4 });
            rect(w, 0, 0, 150, 80);
            for (const cx of [40, 75, 110]) {
                w.lwpolyline(
                    [
                        [cx - 10, 36, 0],
                        [cx + 10, 36, 1],
                        [cx + 10, 44, 0],
                        [cx - 10, 44, 1],
                    ],
                    true,
                );
            }
            return w.toString();
        },
        expected: {
            status: 'READY',
            bboxWidthMm: 150,
            bboxHeightMm: 80,
            cutLengthMm: 460 + 3 * (40 + 8 * PI),
            netAreaMm2: 12000 - 3 * (160 + 16 * PI),
            pierceCount: 4,
            innerContourCount: 3,
            holeCount: 3,
            smallestHoleMm: 8,
            minHoleToEdgeMm: 26,
            smallestFeatureMm: 7,
            geometryDfm: [],
        },
    },
    {
        name: 'd-shape-arcs',
        description: '60 × 40 "D": LINEs + a 180° ARC (r 20) with a Ø10 CIRCLE hole',
        build: () =>
            new DxfWriter({ insUnits: 4 })
                .line([0, 0], [60, 0])
                .arc([60, 20], 20, -90, 90)
                .line([60, 40], [0, 40])
                .line([0, 40], [0, 0])
                .circle([30, 20], 5)
                .toString(),
        expected: {
            status: 'READY',
            bboxWidthMm: 80,
            bboxHeightMm: 40,
            cutLengthMm: 160 + 20 * PI + 10 * PI,
            netAreaMm2: 2400 + 200 * PI - 25 * PI,
            pierceCount: 2,
            holeCount: 1,
            smallestHoleMm: 10,
            minHoleToEdgeMm: 15,
            geometryDfm: [],
        },
    },
    {
        name: 'rounded-rect-bulge',
        description: '100 × 50 rectangle with r5 corners from LWPOLYLINE bulges (tan 22.5°)',
        build: () =>
            new DxfWriter({ insUnits: 4 })
                .lwpolyline(
                    [
                        [5, 0, 0],
                        [95, 0, BULGE_90],
                        [100, 5, 0],
                        [100, 45, BULGE_90],
                        [95, 50, 0],
                        [5, 50, BULGE_90],
                        [0, 45, 0],
                        [0, 5, BULGE_90],
                    ],
                    true,
                )
                .toString(),
        expected: {
            status: 'READY',
            bboxWidthMm: 100,
            bboxHeightMm: 50,
            cutLengthMm: 260 + 10 * PI,
            netAreaMm2: 5000 - 25 * (4 - PI),
            pierceCount: 1,
            holeCount: 0,
            smallestFeatureMm: 50,
            geometryDfm: [],
        },
    },
    {
        name: 'circle-disc',
        description: 'Ø80 disc with a concentric Ø20 hole (two CIRCLEs)',
        build: () => new DxfWriter({ insUnits: 4 }).circle([50, 50], 40).circle([50, 50], 10).toString(),
        expected: {
            status: 'READY',
            bboxWidthMm: 80,
            bboxHeightMm: 80,
            cutLengthMm: 2 * PI * 50,
            netAreaMm2: PI * (1600 - 100),
            pierceCount: 2,
            holeCount: 1,
            smallestHoleMm: 20,
            minHoleToEdgeMm: 30,
            smallestFeatureMm: null,
            geometryDfm: [],
        },
    },
    {
        name: 'plate-inches',
        description: '4 × 2.5 in plate, four Ø0.25 in holes 0.5 in from the edges ($INSUNITS = 1)',
        build: () => {
            const w = new DxfWriter({ insUnits: 1 });
            rect(w, 0, 0, 4, 2.5);
            for (const c of [
                [0.5, 0.5],
                [3.5, 0.5],
                [0.5, 2],
                [3.5, 2],
            ] as [number, number][])
                w.circle(c, 0.125);
            return w.toString();
        },
        expected: {
            status: 'READY',
            units: 'in',
            unitsFromFile: true,
            bboxWidthMm: 4 * IN,
            bboxHeightMm: 2.5 * IN,
            cutLengthMm: 13 * IN + 4 * PI * 0.25 * IN,
            netAreaMm2: (10 - 4 * PI * 0.015625) * IN * IN,
            pierceCount: 5,
            holeCount: 4,
            smallestHoleMm: 0.25 * IN,
            minHoleToEdgeMm: 0.375 * IN,
            geometryDfm: [],
        },
    },
    {
        name: 'unitless-ambiguous',
        description: '30 × 20 plate with no $INSUNITS: 30 mm and 30 in are both plausible -> NEEDS_INPUT',
        build: () => {
            const w = new DxfWriter({ insUnits: 0 });
            rect(w, 0, 0, 30, 20);
            w.circle([15, 10], 2);
            return w.toString();
        },
        expected: { status: 'NEEDS_INPUT' },
    },
    {
        name: 'r12-unitless-mm',
        description: 'Header-less R12 file (POLYLINE/VERTEX) 120 × 80: only mm is plausible -> inferred mm',
        build: () =>
            new DxfWriter({ acadVersion: null, insUnits: null })
                .polyline(
                    [
                        [0, 0],
                        [120, 0],
                        [120, 80],
                        [0, 80],
                    ],
                    true,
                )
                .toString(),
        expected: {
            status: 'READY',
            units: 'mm',
            unitsFromFile: false,
            bboxWidthMm: 120,
            bboxHeightMm: 80,
            cutLengthMm: 400,
            netAreaMm2: 9600,
            pierceCount: 1,
            geometryDfm: [],
        },
    },
    {
        name: 'open-contour',
        description: '80 × 40 outline with a 0.5 mm gap (four LINEs that never close)',
        build: () =>
            new DxfWriter({ insUnits: 4 })
                .line([0, 0], [80, 0])
                .line([80, 0], [80, 40])
                .line([80, 40], [0, 40])
                .line([0, 40], [0, 0.5])
                .toString(),
        expected: {
            status: 'READY',
            outerContourCount: 0,
            openContourCount: 1,
            cutLengthMm: 80 + 40 + 80 + 39.5,
            pierceCount: 1,
            geometryDfm: ['no_cut_geometry', 'open_contour'],
        },
    },
    {
        name: 'tiny-hole',
        description: '50 × 50 plate with a Ø0.8 hole (blocks on 16 ga steel, passes on 0.040" aluminum)',
        build: () => {
            const w = new DxfWriter({ insUnits: 4 });
            rect(w, 0, 0, 50, 50);
            w.circle([25, 25], 0.4);
            return w.toString();
        },
        expected: { status: 'READY', holeCount: 1, smallestHoleMm: 0.8, minHoleToEdgeMm: 24.6, geometryDfm: [] },
    },
    {
        name: 'hole-near-edge',
        description: '80 × 40 plate with a Ø5 hole 1.0 mm from the left edge',
        build: () => {
            const w = new DxfWriter({ insUnits: 4 });
            rect(w, 0, 0, 80, 40);
            w.circle([3.5, 20], 2.5);
            return w.toString();
        },
        expected: { status: 'READY', holeCount: 1, smallestHoleMm: 5, minHoleToEdgeMm: 1, geometryDfm: [] },
    },
    {
        name: 'oversize-panel',
        description: '1500 × 200 panel: larger than every catalog sheet',
        build: () => {
            const w = new DxfWriter({ insUnits: 4 });
            rect(w, 0, 0, 1500, 200);
            return w.toString();
        },
        expected: { status: 'READY', bboxWidthMm: 1500, bboxHeightMm: 200, cutLengthMm: 3400, netAreaMm2: 300000, geometryDfm: ['part_size_max'] },
    },
    {
        name: 'ellipse-spline',
        description: 'ELLIPSE outline (a 50, b 30) with a 20 × 20 square hole drawn as a degree-1 SPLINE',
        build: () =>
            new DxfWriter({ insUnits: 4 })
                .ellipse([60, 40], [50, 0], 0.6)
                .spline(
                    1,
                    [0, 0, 1, 2, 3, 4, 4],
                    [
                        [50, 30],
                        [70, 30],
                        [70, 50],
                        [50, 50],
                        [50, 30],
                    ],
                    true,
                )
                .toString(),
        expected: {
            status: 'READY',
            bboxWidthMm: 100,
            bboxHeightMm: 60,
            // Ramanujan II perimeter for a = 50, b = 30, plus the 80 mm square.
            cutLengthMm: PI * 80 * (1 + (3 * 0.0625) / (10 + Math.sqrt(4 - 3 * 0.0625))) + 80,
            netAreaMm2: PI * 50 * 30 - 400,
            pierceCount: 2,
            holeCount: 1,
            smallestHoleMm: 20,
            geometryDfm: [],
        },
    },
    {
        name: 'bent-bracket',
        description: '120 × 60 blank, one bend line (layer BEND_90) at y = 20, two Ø5 holes',
        build: () => {
            const w = new DxfWriter({ insUnits: 4 });
            rect(w, 0, 0, 120, 60);
            w.line([0, 20], [120, 20], 'BEND_90');
            w.circle([30, 45], 2.5).circle([90, 45], 2.5);
            return w.toString();
        },
        expected: { status: 'READY', cutLengthMm: 360 + 10 * PI, bendCount: 1, holeCount: 2, pierceCount: 3, geometryDfm: [] },
    },
    {
        name: 'short-flange',
        description: '120 × 60 blank with a bend line 4 mm from the edge (flange too short)',
        build: () => {
            const w = new DxfWriter({ insUnits: 4 });
            rect(w, 0, 0, 120, 60);
            w.line([0, 4], [120, 4], 'BEND');
            return w.toString();
        },
        expected: { status: 'READY', bendCount: 1, geometryDfm: [] },
    },
    {
        name: 'text-label',
        description: '60 × 30 tag with a TEXT label (warned, not cut)',
        build: () => {
            const w = new DxfWriter({ insUnits: 4 });
            rect(w, 0, 0, 60, 30);
            w.text([10, 10], 5, 'DISCOVERMAKE');
            return w.toString();
        },
        expected: { status: 'READY', textEntityCount: 1, cutLengthMm: 180, geometryDfm: ['text_entities'] },
    },
    {
        name: 'block-inserts',
        description: '100 × 50 plate with holes from a block (INSERT ×2 at scale 1, ×1 at scale 0.5)',
        build: () => {
            const w = new DxfWriter({ insUnits: 4 });
            w.block('HOLE6', [0, 0], (wr, target) => {
                wr.circle([0, 0], 3, '0', target);
            });
            rect(w, 0, 0, 100, 50);
            w.insert('HOLE6', [25, 25]).insert('HOLE6', [75, 25]).insert('HOLE6', [50, 25], { scale: 0.5 });
            return w.toString();
        },
        expected: {
            status: 'READY',
            holeCount: 3,
            smallestHoleMm: 3,
            cutLengthMm: 300 + 2 * PI * 6 + PI * 3,
            netAreaMm2: 5000 - 2 * PI * 9 - PI * 2.25,
            pierceCount: 4,
            geometryDfm: [],
        },
    },
];

export function fixture(name: string): Fixture {
    const f = FIXTURES.find((x) => x.name === name);
    if (!f) throw new Error(`Unknown fixture ${name}`);
    return f;
}
