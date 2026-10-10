/** Wall thickness measured on an STL: synthetic boxes and the golden cadgen part. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { measureMinWall, parseStl } from '@/server/text-to-cad/mesh';

type V = [number, number, number];

/** Binary STL of axis-aligned boxes (outward winding). */
function boxesStl(boxes: { min: V; max: V }[]): Uint8Array {
    const tris: V[][] = [];
    for (const { min: [x0, y0, z0], max: [x1, y1, z1] } of boxes) {
        const p = (x: number, y: number, z: number): V => [x, y, z];
        const quads: V[][] = [
            [p(x0, y0, z0), p(x0, y1, z0), p(x1, y1, z0), p(x1, y0, z0)], // bottom (-z)
            [p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1)], // top (+z)
            [p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1), p(x0, y0, z1)], // -y
            [p(x0, y1, z0), p(x0, y1, z1), p(x1, y1, z1), p(x1, y1, z0)], // +y
            [p(x0, y0, z0), p(x0, y0, z1), p(x0, y1, z1), p(x0, y1, z0)], // -x
            [p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1), p(x1, y0, z1)], // +x
        ];
        for (const [a, b, c, d] of quads) tris.push([a!, b!, c!], [a!, c!, d!]);
    }
    const buf = Buffer.alloc(84 + tris.length * 50);
    buf.writeUInt32LE(tris.length, 80);
    tris.forEach((t, i) => t.forEach((v, j) => v.forEach((c, k) => buf.writeFloatLE(c, 84 + i * 50 + 12 + j * 12 + k * 4))));
    return new Uint8Array(buf);
}

describe('measureMinWall', () => {
    it('finds the thickness of a plate', () => {
        const tris = parseStl(boxesStl([{ min: [0, 0, 0], max: [40, 30, 2] }]));
        expect(tris).toHaveLength(12);
        expect(measureMinWall(tris)!.minWallMm).toBeCloseTo(2, 2);
    });

    it('a thin fin on a thick block decides the minimum', () => {
        const stl = boxesStl([
            { min: [0, 0, 0], max: [40, 40, 10] },
            { min: [18, 0, 10.0001], max: [19.2, 40, 30] },
        ]);
        expect(measureMinWall(parseStl(stl))!.minWallMm).toBeLessThanOrEqual(1.25);
    });

    it('returns null for nothing to measure', () => {
        expect(measureMinWall([])).toBeNull();
        expect(parseStl(new Uint8Array(10))).toEqual([]);
    });

    it('measures the golden cadgen cable holder (4 mm floor under the slots)', () => {
        const stl = new Uint8Array(readFileSync(path.join(process.cwd(), 'tests', 'fixtures', 'text-to-cad', 'model.stl')));
        const m = measureMinWall(parseStl(stl))!;
        expect(m.samples).toBeGreaterThan(500);
        expect(m.minWallMm).toBeGreaterThan(3.9);
        expect(m.minWallMm).toBeLessThan(4.6);
    });
});
