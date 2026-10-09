/**
 * The Reconstruct planner proposes a family + spec ONLY from confirmed caliper readings, and
 * the graph helpers make only caliper readings buyer-stated (the CAD agent's rule).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CadSpec } from '@/contracts/cad';
import { ReconstructOptions, requiredDimensions, type ReconstructOptionsInput, type ReconstructPartType } from '@/contracts/reconstruct';
import { buyerNumbers } from '@/server/cad/agent';
import { caliperNode, confirmedDims, dimensionViews, estimateNode, type ConfirmedDim } from '@/server/reconstruct/dimensions';
import { planReconstruction, PLANNER_TRACE_TOLERANCE_MM } from '@/server/reconstruct/planner';
import { sameSpec } from '../support/cad-golden-worker';

const AT = '2026-10-09T12:00:00.000Z';
const reading = (param: string, valueMm: number, label = param): ConfirmedDim => ({ param, label, valueMm, enteredValue: valueMm, enteredUnit: 'mm', confirmedAt: AT, photoEstimateMm: null });
const plan = (partType: ReconstructPartType, options: ReconstructOptionsInput, readings: ConfirmedDim[]) =>
    planReconstruction({ partType, options: ReconstructOptions.parse(options), confirmed: new Map(readings.map((r) => [r.param, r])) });
const golden = (name: string) => JSON.parse(readFileSync(path.join(process.cwd(), 'tests', 'fixtures', 'cad', name, 'manifest.json'), 'utf8')).spec;

describe('planner', () => {
    it('needs every critical dimension, by family and choices', () => {
        expect(requiredDimensions('knob').map((d) => d.param)).toEqual(['diameter_mm', 'height_mm']);
        expect(requiredDimensions('knob', { shaft: 'measured' }).map((d) => d.param)).toEqual(['diameter_mm', 'height_mm', 'shaft_diameter_mm', 'shaft_across_flat_mm']);
        expect(requiredDimensions('knob', { shaft: 'measured', measuredBoreType: 'round', boreDepth: 'measured' }).map((d) => d.param)).toEqual(['diameter_mm', 'height_mm', 'shaft_diameter_mm', 'bore_depth_mm']);
        expect(requiredDimensions('spacer', { flanged: true })).toHaveLength(5);
        expect(requiredDimensions('bracket', { bracketShape: 'flat', bracketHoles: true }).map((d) => d.param)).toContain('hole_spacing_mm');
        const p = plan('knob', {}, [reading('diameter_mm', 38.1)]);
        expect(p).toEqual({ status: 'needs_input', missing: ['height_mm'], questions: [expect.stringContaining('height')] });
    });

    it('turns two caliper readings and a shaft standard into exactly the golden knob spec', () => {
        const p = plan('knob', { shaft: '6mm-d', gripRibs: 12, pointerNotch: true }, [reading('diameter_mm', 38.1), reading('height_mm', 22)]);
        expect(p.status).toBe('ready');
        if (p.status !== 'ready') return;
        expect(p.family).toBe('round_knob');
        expect(p.printed).toBe(true);
        expect(sameSpec(p.spec, golden('reconstruct-knob'))).toBe(true);
        const by = Object.fromEntries(p.trace.map((t) => [t.field, t]));
        expect(by.diameter_mm).toMatchObject({ source: 'caliper', value: 38.1 });
        expect(by.height_mm).toMatchObject({ source: 'caliper', value: 22 });
        expect(by.shaft_diameter_mm).toMatchObject({ source: 'standard', value: 6 });
        expect(by.bore_depth_mm).toMatchObject({ source: 'design_rule', value: 20 });
        expect(by.grip_ribs).toMatchObject({ source: 'buyer_choice', value: 12 });
    });

    it('never reads photo estimates: only the caliper value reaches the spec', () => {
        const withEstimate = { ...reading('diameter_mm', 38.1), photoEstimateMm: 44.4 };
        const p = plan('knob', {}, [withEstimate, reading('height_mm', 22)]);
        if (p.status !== 'ready') throw new Error('expected ready');
        expect(p.spec.diameter_mm).toBe(38.1);
        expect(JSON.stringify(p.spec)).not.toContain('44.4');
        for (const t of p.trace.filter((x) => x.source === 'caliper')) {
            expect([38.1, 22].some((r) => Math.abs(r - (t.value as number)) <= PLANNER_TRACE_TOLERANCE_MM)).toBe(true);
        }
    });

    it('derives a measured D-flat from two caliper readings and maps spacers and brackets', () => {
        const knob = plan('knob', { shaft: 'measured' }, [reading('diameter_mm', 30), reading('height_mm', 16), reading('shaft_diameter_mm', 6.02), reading('shaft_across_flat_mm', 4.48)]);
        if (knob.status !== 'ready') throw new Error('expected ready');
        expect(knob.spec).toMatchObject({ shaft_diameter_mm: 6.02, shaft_flat_depth_mm: 1.54, bore_type: 'd_shaft' });
        expect(knob.trace.find((t) => t.field === 'shaft_flat_depth_mm')?.source).toBe('caliper_derived');

        const spacer = plan('spacer', { flanged: true }, [reading('outer_diameter_mm', 12), reading('inner_diameter_mm', 6.5), reading('length_mm', 10), reading('flange_diameter_mm', 18), reading('flange_thickness_mm', 2)]);
        if (spacer.status !== 'ready') throw new Error('expected ready');
        expect(sameSpec(spacer.spec, golden('reconstruct-spacer'))).toBe(true);

        const l = plan('bracket', { bracketShape: 'l' }, [reading('leg_a_mm', 50), reading('leg_b_mm', 80), reading('width_mm', 40), reading('thickness_mm', 1.52)]);
        expect(l).toMatchObject({ status: 'ready', family: 'l_bracket', printed: false, spec: { leg_a_mm: 50, inside_bend_radius_mm: 1.52 } });
        const z = plan('bracket', { bracketShape: 'z' }, [reading('leg_a_mm', 25), reading('web_mm', 40), reading('leg_b_mm', 25), reading('width_mm', 40), reading('thickness_mm', 1.52)]);
        expect(z).toMatchObject({ status: 'ready', family: 'multi_bend_bracket', spec: { flanges_mm: [25, 40, 25], bend_angles_deg: [90, -90] } });
        const flat = plan('bracket', { bracketShape: 'flat', bracketHoles: true }, [reading('length_mm', 160), reading('width_mm', 80), reading('thickness_mm', 3.04), reading('hole_diameter_mm', 6), reading('hole_spacing_mm', 120)]);
        expect(flat).toMatchObject({ status: 'ready', family: 'slotted_plate', spec: { holes: [{ x_mm: 20, y_mm: 40, diameter_mm: 6 }, { x_mm: 140, y_mm: 40, diameter_mm: 6 }] } });
        for (const p of [knob, spacer, l, z, flat]) if (p.status === 'ready') expect(CadSpec.safeParse(p.spec).success).toBe(true);
    });

    it('asks again instead of building readings that make no part', () => {
        const p = plan('knob', { shaft: '6mm-d' }, [reading('diameter_mm', 7.5), reading('height_mm', 22)]);
        expect(p.status).toBe('needs_input');
        if (p.status === 'needs_input') expect(p.questions[0]).toMatch(/Re-check the caliper readings/);
    });
});

describe('graph nodes', () => {
    it('makes caliper readings buyer-stated and photo estimates not', () => {
        const cal = caliperNode(reading('diameter_mm', 38.1, 'Outer diameter'), { mm: 37.2, uncertaintyMm: 0.4 });
        const est = estimateNode('height_mm', 'Height', { mm: 23.9, uncertaintyMm: 0.3 });
        const nodes = [cal, est].map((n, i) => ({ ...n, id: `bgn_${i}`, buildId: 'bld_x', designVersion: 2 }));
        expect(cal).toMatchObject({ source: 'user', data: { requirementSource: 'user', source: 'caliper', valueMm: 38.1, photoEstimateMm: 37.2, deltaPct: 2.4 } });
        expect(est).toMatchObject({ source: 'system', data: { source: 'photo_estimate', confirmedAt: null } });
        // The CAD agent's buyer-number rule sees the caliper value and never the estimate.
        expect([...buyerNumbers(nodes).values()].flat()).toEqual([38.1]);
        expect([...confirmedDims(nodes).keys()]).toEqual(['diameter_mm']);
    });

    it('builds the confirmation table with deltas and the >10% warning', () => {
        const rows = dimensionViews('knob', ReconstructOptions.parse({}), new Map([['diameter_mm', reading('diameter_mm', 38.1, 'Outer diameter')]]), new Map([
            ['diameter_mm', { mm: 42.5, uncertaintyMm: 0.5 }],
            ['height_mm', { mm: 21.7, uncertaintyMm: 0.3 }],
        ]));
        expect(rows[0]).toMatchObject({ param: 'diameter_mm', caliperMm: 38.1, estimateMm: 42.5, source: 'caliper', deltaPct: 11.5, deltaWarning: true });
        expect(rows[1]).toMatchObject({ param: 'height_mm', caliperMm: null, confirmedAt: null, estimateMm: 21.7, source: 'photo_estimate', deltaWarning: false });
    });
});
