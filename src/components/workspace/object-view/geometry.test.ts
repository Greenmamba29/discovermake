/**
 * Object View pure helpers: unit conversion, bounding-box text, two-point distance, the
 * glTF -> CAD axis map, GLB unit inference and camera fit.
 */
import { describe, expect, it } from 'vitest';
import {
    convertLength,
    dimensionRows,
    dimensionSummary,
    distance3,
    fitCameraDistance,
    formatBbox,
    formatLength,
    gltfSizeToCad,
    inferScaleToMm,
    MM_PER_INCH,
} from './geometry';

describe('units', () => {
    it('converts millimetres to inches exactly', () => {
        expect(convertLength(25.4, 'in')).toBe(1);
        expect(convertLength(120, 'mm')).toBe(120);
        expect(MM_PER_INCH).toBe(25.4);
    });

    it('formats lengths to 0.1 mm and 0.001 in', () => {
        expect(formatLength(120, 'mm')).toBe('120.0 mm');
        expect(formatLength(80.06, 'mm')).toBe('80.1 mm');
        expect(formatLength(120, 'in')).toBe('4.724 in');
        expect(formatLength(Number.NaN, 'mm')).toBe('—');
    });
});

describe('bounding box text', () => {
    it('formats X × Y × Z in either unit', () => {
        expect(formatBbox([80, 40, 50], 'mm')).toBe('80.0 × 40.0 × 50.0 mm');
        expect(formatBbox([25.4, 50.8, 12.7], 'in')).toBe('1.000 × 2.000 × 0.500 in');
    });

    it('labels CAD axes as width, depth and height', () => {
        const rows = dimensionRows([80, 40, 50], 'mm');
        expect(rows.map((r) => `${r.axis} ${r.label} ${r.text}`)).toEqual(['X Width 80.0 mm', 'Y Depth 40.0 mm', 'Z Height 50.0 mm']);
        expect(dimensionSummary([80, 40, 50], 'in')).toBe('Overall size 3.150 in wide (X), 1.575 in deep (Y), 1.969 in tall (Z).');
    });
});

describe('measuring', () => {
    it('measures the straight-line distance between two points', () => {
        expect(distance3([0, 0, 0], [3, 4, 0])).toBe(5);
        expect(distance3([1, 2, 3], [1, 2, 3])).toBe(0);
        expect(distance3([0, 0, 0], [10, 10, 10])).toBeCloseTo(17.3205, 4);
    });

    it('maps glTF (Y-up) sizes to CAD (Z-up) sizes', () => {
        // glTF: x 80, y(up) 50, z 40  ->  CAD: X 80, Y 40, Z 50
        expect(gltfSizeToCad([80, 50, 40])).toEqual([80, 40, 50]);
    });
});

describe('GLB scale', () => {
    it('defaults to metres (glTF) when nothing else is known', () => {
        expect(inferScaleToMm(0.08, null)).toBe(1000);
        expect(inferScaleToMm(0, 80)).toBe(1000);
    });

    it('matches the CAD bounding box: metres, millimetres or inches', () => {
        expect(inferScaleToMm(0.08, 80)).toBe(1000);
        expect(inferScaleToMm(80, 80)).toBe(1);
        expect(inferScaleToMm(80 / 25.4, 80)).toBe(25.4);
        expect(inferScaleToMm(8, 80)).toBe(10);
    });
});

describe('camera fit', () => {
    it('backs off further for bigger parts and narrower lenses', () => {
        const small = fitCameraDistance([10, 10, 10], 35);
        const big = fitCameraDistance([100, 100, 100], 35);
        expect(big).toBeCloseTo(small * 10, 6);
        expect(fitCameraDistance([100, 100, 100], 20)).toBeGreaterThan(big);
        // A tall, narrow viewport uses the horizontal field of view.
        expect(fitCameraDistance([100, 100, 100], 35, 0.5)).toBeGreaterThan(big);
    });
});
