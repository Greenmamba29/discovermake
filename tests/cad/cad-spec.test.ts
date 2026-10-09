/**
 * Pins the CadSpec bounds shared with services/cad-worker/cad_worker/specs.py.
 * If you change a bound here, change it there too (and vice versa). The worker's own
 * tests (services/cad-worker/tests) cover the same cases on the Python side.
 */
import { describe, expect, it } from 'vitest';
import { CadSpec } from '@/contracts/cad';

const U = { family: 'u_channel', flange_a_mm: 30, base_mm: 60, flange_b_mm: 30, length_mm: 120, thickness_mm: 1.52, inside_bend_radius_mm: 1.52 };
const HAT = { family: 'multi_bend_bracket', flanges_mm: [20, 30, 40, 30, 20], bend_angles_deg: [90, -90, -90, 90], width_mm: 50, thickness_mm: 1.52, inside_bend_radius_mm: 1.52 };
const PLATE = {
    family: 'slotted_plate',
    width_mm: 160,
    height_mm: 80,
    thickness_mm: 3.04,
    corner_radius_mm: 4,
    holes: [{ x_mm: 20, y_mm: 20, diameter_mm: 6 }],
    slots: [{ x_mm: 80, y_mm: 55, length_mm: 40, width_mm: 8 }],
    countersinks: [{ x_mm: 60, y_mm: 20, through_diameter_mm: 3.4, head_diameter_mm: 6.5 }],
};
const ENCL = { family: 'sheet_enclosure', inner_x_mm: 180, inner_y_mm: 120, inner_z_mm: 70, thickness_mm: 1.6, inside_bend_radius_mm: 1.6, gland_diameter_mm: 12.5 };

const ok = [
    { family: 'sheet_panel', width_mm: 200, height_mm: 100, thickness_mm: 1.52, corner_radius_mm: 5, holes: [{ x_mm: 20, y_mm: 20, diameter_mm: 6 }] },
    { family: 'l_bracket', leg_a_mm: 50, leg_b_mm: 80, width_mm: 40, thickness_mm: 1.52, inside_bend_radius_mm: 1.52 },
    { family: 'enclosure', inner_x_mm: 90, inner_y_mm: 65, inner_z_mm: 40, wall_mm: 2.5 },
    { ...U, holes: [{ flange: 1, x_mm: 30, y_mm: 30, diameter_mm: 5 }] },
    HAT,
    { family: 'multi_bend_bracket', flanges_mm: [25, 40, 25], bend_angles_deg: [90, -90], width_mm: 40, thickness_mm: 1.52, inside_bend_radius_mm: 1.52 },
    PLATE,
    ENCL,
];

const bad = [
    { family: 'sheet_panel', width_mm: 5000, height_mm: 100, thickness_mm: 2 },
    { family: 'sheet_panel', width_mm: 200, height_mm: 100, thickness_mm: 30 },
    { family: 'sheet_panel', width_mm: 200, height_mm: 100, thickness_mm: 2, script: 'import os' },
    { family: 'sheet_panel', width_mm: 200, height_mm: 100, thickness_mm: 2, holes: [{ x_mm: 1, y_mm: 20, diameter_mm: 6 }] },
    { family: 'l_bracket', leg_a_mm: 50, leg_b_mm: 80, width_mm: 40, thickness_mm: 13, inside_bend_radius_mm: 2 },
    { family: 'l_bracket', leg_a_mm: 50, leg_b_mm: 80, width_mm: 40, thickness_mm: 2, inside_bend_radius_mm: 0.1 },
    { family: 'enclosure', inner_x_mm: 600, inner_y_mm: 65, inner_z_mm: 40, wall_mm: 2.5 },
    { family: 'enclosure', inner_x_mm: 90, inner_y_mm: 65, inner_z_mm: 40, wall_mm: 2.5, vent_slots: 21 },
    { family: 'turbine_blade' },
    // u_channel: flat flange below 4 x t, hole in the bend zone, missing flange
    { ...U, flange_a_mm: 7 },
    { ...U, holes: [{ flange: 1, x_mm: 30, y_mm: 4, diameter_mm: 5 }] },
    { ...U, holes: [{ flange: 3, x_mm: 30, y_mm: 10, diameter_mm: 5 }] },
    // multi-bend: flanges != bends + 1, angles other than +/-90, more than 4 bends
    { ...HAT, bend_angles_deg: [90, -90] },
    { ...HAT, bend_angles_deg: [90, -90, 45, 90] },
    { ...HAT, flanges_mm: [20, 30, 40, 30, 20, 20], bend_angles_deg: [90, -90, -90, 90, 90] },
    // slotted plate: slot off the plate, slot narrower than t, cone too deep, web below t, no features
    { ...PLATE, slots: [{ x_mm: 80, y_mm: 76, length_mm: 40, width_mm: 8 }] },
    { ...PLATE, slots: [{ x_mm: 80, y_mm: 55, length_mm: 40, width_mm: 2 }] },
    { ...PLATE, countersinks: [{ x_mm: 60, y_mm: 20, through_diameter_mm: 3.4, head_diameter_mm: 9 }] },
    { ...PLATE, holes: [{ x_mm: 60, y_mm: 27, diameter_mm: 4 }] },
    { ...PLATE, holes: [], slots: [], countersinks: [] },
    // sheet enclosure: too shallow, too short for the lid screws, gland too big, thick sheet
    { ...ENCL, inner_z_mm: 40 },
    { ...ENCL, inner_x_mm: 60 },
    { ...ENCL, inner_y_mm: 50, gland_diameter_mm: 40 },
    { ...ENCL, lid_lip_mm: 8 },
    { ...ENCL, thickness_mm: 6 },
];

describe('CadSpec', () => {
    it.each(ok)('accepts %o', (spec) => {
        const r = CadSpec.safeParse(spec);
        expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
    });
    it.each(bad)('rejects %o', (spec) => {
        expect(CadSpec.safeParse(spec).success).toBe(false);
    });
    it('applies the worker defaults', () => {
        expect(CadSpec.parse(ok[1])).toMatchObject({ k_factor: 0.44, holes_a: [], holes_b: [] });
        expect(CadSpec.parse(ENCL)).toMatchObject({ end_flange_mm: 15, lid_lip_mm: 15, floor_holes: [], k_factor: 0.44 });
        expect(CadSpec.parse({ ...ENCL, gland_diameter_mm: undefined })).toMatchObject({ gland_diameter_mm: null });
        expect(CadSpec.parse(PLATE)).toMatchObject({ slots: [{ angle_deg: 0 }], countersinks: [{ angle_deg: 90 }] });
    });
});
