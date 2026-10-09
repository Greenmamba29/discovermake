/**
 * R6 printed families: the TS mirror of specs.py RoundKnob / SpacerBushing (bounds, defaults,
 * cross-field checks, min wall) and the committed goldens parse as worker responses.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CadGenerateResponse, CadSpec, isPrintedSpec, printedMinWallMm, PRINTED_FAMILIES } from '@/contracts/cad';

const dir = (name: string) => path.join(process.cwd(), 'tests', 'fixtures', 'cad', name);
const manifestOf = (name: string) => JSON.parse(readFileSync(path.join(dir(name), 'manifest.json'), 'utf8'));
const KNOB = manifestOf('reconstruct-knob').spec;
const SPACER = manifestOf('reconstruct-spacer').spec;

describe('printed CadSpec families', () => {
    it('accepts the goldens and applies the worker defaults', () => {
        expect(PRINTED_FAMILIES).toEqual(['round_knob', 'spacer_bushing']);
        const knob = CadSpec.parse({ family: 'round_knob', diameter_mm: 38.1, height_mm: 22, shaft_diameter_mm: 6, shaft_flat_depth_mm: 1.5, bore_depth_mm: 20 });
        expect(knob).toMatchObject({ bore_type: 'd_shaft', bore_clearance_mm: 0.15, grip_ribs: 0, rib_depth_mm: 0.8, pointer_notch: false, chamfer_mm: 0.5 });
        expect(isPrintedSpec(knob)).toBe(true);
        expect(CadSpec.parse(KNOB)).toMatchObject({ family: 'round_knob', grip_ribs: 12 });
        expect(CadSpec.parse(SPACER)).toMatchObject({ family: 'spacer_bushing', flange_diameter_mm: 18 });
        expect(CadSpec.parse({ family: 'spacer_bushing', outer_diameter_mm: 10, inner_diameter_mm: 5, length_mm: 20 })).toMatchObject({ flange_diameter_mm: null, flange_thickness_mm: null, chamfer_mm: 0 });
    });

    it.each([
        { ...KNOB, diameter_mm: 7 },
        { ...KNOB, shaft_flat_depth_mm: null },
        { ...KNOB, bore_type: 'round', shaft_flat_depth_mm: 1.5 },
        { ...KNOB, shaft_flat_depth_mm: 3 },
        { ...KNOB, bore_depth_mm: 21.5 },
        { ...KNOB, diameter_mm: 8.5, grip_ribs: 8 },
        { ...KNOB, grip_ribs: 60 },
        { ...KNOB, chamfer_mm: 6.5 },
        { ...KNOB, script: 'import os' },
        { ...SPACER, inner_diameter_mm: 11 },
        { ...SPACER, flange_thickness_mm: null },
        { ...SPACER, flange_diameter_mm: 11 },
        { ...SPACER, flange_thickness_mm: 10 },
        { family: 'spacer_bushing', outer_diameter_mm: 10, inner_diameter_mm: 5, length_mm: 20, chamfer_mm: 2 },
    ])('rejects %o (same cases as the worker)', (spec) => {
        expect(CadSpec.safeParse(spec).success).toBe(false);
    });

    it('computes the thinnest wall exactly like the worker', () => {
        for (const name of ['reconstruct-knob', 'reconstruct-spacer']) {
            const m = manifestOf(name);
            const spec = CadSpec.parse(m.spec);
            if (!isPrintedSpec(spec)) throw new Error('printed');
            expect(printedMinWallMm(spec)).toBeCloseTo(m.metrics.min_wall_mm, 6);
        }
    });

    it('the recorded worker responses parse, with STL artifacts and manifest metrics', () => {
        for (const name of ['reconstruct-knob', 'reconstruct-spacer']) {
            const response = JSON.parse(readFileSync(path.join(dir(name), 'response.json'), 'utf8'));
            const parsed = CadGenerateResponse.parse({ ...response, artifacts: response.artifacts.map((a: object) => ({ ...a, content_base64: '' })) });
            expect(parsed.artifacts.map((a) => a.kind)).toEqual(['STEP', 'STL', 'GLB', 'BOM', 'CSV', 'SVG', 'MANIFEST']);
            expect(parsed.metrics.surface_area_mm2).toBeGreaterThan(0);
            expect(manifestOf(name).metrics).toMatchObject({ bbox_mm: parsed.metrics.bbox_mm, volume_mm3: parsed.metrics.volume_mm3, surface_area_mm2: parsed.metrics.surface_area_mm2 });
        }
    });
});
