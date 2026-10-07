/**
 * Pins the CadSpec bounds shared with services/cad-worker/cad_worker/specs.py.
 * If you change a bound here, change it there too (and vice versa).
 */
import { describe, expect, it } from 'vitest';
import { CadSpec } from '@/contracts/cad';

const ok = [
    { family: 'sheet_panel', width_mm: 200, height_mm: 100, thickness_mm: 1.52, corner_radius_mm: 5, holes: [{ x_mm: 20, y_mm: 20, diameter_mm: 6 }] },
    { family: 'l_bracket', leg_a_mm: 50, leg_b_mm: 80, width_mm: 40, thickness_mm: 1.52, inside_bend_radius_mm: 1.52 },
    { family: 'enclosure', inner_x_mm: 90, inner_y_mm: 65, inner_z_mm: 40, wall_mm: 2.5 },
];

const bad = [
    { family: 'sheet_panel', width_mm: 5000, height_mm: 100, thickness_mm: 2 },
    { family: 'sheet_panel', width_mm: 200, height_mm: 100, thickness_mm: 30 },
    { family: 'sheet_panel', width_mm: 200, height_mm: 100, thickness_mm: 2, script: 'import os' },
    { family: 'l_bracket', leg_a_mm: 50, leg_b_mm: 80, width_mm: 40, thickness_mm: 13, inside_bend_radius_mm: 2 },
    { family: 'l_bracket', leg_a_mm: 50, leg_b_mm: 80, width_mm: 40, thickness_mm: 2, inside_bend_radius_mm: 0.1 },
    { family: 'enclosure', inner_x_mm: 600, inner_y_mm: 65, inner_z_mm: 40, wall_mm: 2.5 },
    { family: 'enclosure', inner_x_mm: 90, inner_y_mm: 65, inner_z_mm: 40, wall_mm: 2.5, vent_slots: 21 },
    { family: 'turbine_blade' },
];

describe('CadSpec', () => {
    it.each(ok)('accepts %o', (spec) => {
        expect(CadSpec.safeParse(spec).success).toBe(true);
    });
    it.each(bad)('rejects %o', (spec) => {
        expect(CadSpec.safeParse(spec).success).toBe(false);
    });
    it('applies the worker defaults', () => {
        const s = CadSpec.parse(ok[1]);
        expect(s).toMatchObject({ k_factor: 0.44, holes_a: [], holes_b: [] });
    });
});
