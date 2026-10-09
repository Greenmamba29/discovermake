/**
 * Reconstruct planner (pure): confirmed caliper readings + the buyer's choices -> a CAD family
 * and a strict CadSpec, or the list of what is still missing.
 *
 * The rule (same as the CAD agent's, stricter): every product-defining number comes from a
 * CALIPER reading the buyer confirmed. Photo estimates are never read here. The only other
 * sources, each listed in the trace:
 *   standard      a shaft standard the buyer picked (published numbers, e.g. 6 mm D-shaft)
 *   caliper_derived  arithmetic on two caliper readings (D-flat depth = shaft - across flat;
 *                 hole positions from the measured spacing)
 *   buyer_choice  counts and toggles the buyer set (grip flutes, pointer notch)
 *   design_rule   manufacturing choices with documented defaults (knob bore = height - 2 mm cap,
 *                 bend radius = thickness, fit clearance, chamfers) - never a size of the part
 * Before returning, every `caliper` number is re-checked against the confirmed readings with
 * the CAD agent's 0.5 mm trace tolerance.
 */
import { CadSpec, type CadSpecInput } from '@/contracts/cad';
import { KNOB_DEFAULT_CAP_MM, requiredDimensions, SHAFT_STANDARDS, type DimensionParam, type PlanTrace, type ReconstructOptions, type ReconstructPartType, type ReconstructPlan } from '@/contracts/reconstruct';
import { round2 } from '@/lib/reconstruct/measure';
import type { ConfirmedDim } from './dimensions';

/** Same tolerance as the CAD agent's buyer-number trace (src/server/cad/agent.ts). */
export const PLANNER_TRACE_TOLERANCE_MM = 0.5;

export type PlanInput = { partType: ReconstructPartType; options: ReconstructOptions; confirmed: Map<string, ConfirmedDim> };

export function planReconstruction(input: PlanInput): ReconstructPlan {
    const { partType, options: o, confirmed } = input;
    const required = requiredDimensions(partType, o);
    const missing = required.filter((d) => !confirmed.has(d.param));
    if (missing.length) {
        return { status: 'needs_input', missing: missing.map((d) => d.param), questions: missing.map((d) => `Confirm the ${d.label.toLowerCase()} with a caliper or ruler reading.`) };
    }
    const trace: PlanTrace[] = [];
    const cal = (field: string, param: DimensionParam) => {
        const c = confirmed.get(param)!;
        trace.push({ field, value: c.valueMm, source: 'caliper', from: `${c.label} (${c.enteredValue} ${c.enteredUnit}, confirmed ${c.confirmedAt})` });
        return c.valueMm;
    };
    const put = <T extends number | string | boolean | null>(field: string, value: T, source: PlanTrace['source'], from: string): T => {
        trace.push({ field, value, source, from });
        return value;
    };

    let candidate: CadSpecInput;
    switch (partType) {
        case 'knob': {
            const height = cal('height_mm', 'height_mm');
            let boreType: 'd_shaft' | 'round';
            let shaft: number;
            let flat: number | null;
            if (o.shaft === 'measured') {
                boreType = put('bore_type', o.measuredBoreType, 'buyer_choice', 'Measured shaft type');
                shaft = cal('shaft_diameter_mm', 'shaft_diameter_mm');
                if (boreType === 'd_shaft') {
                    const across = confirmed.get('shaft_across_flat_mm')!;
                    flat = put('shaft_flat_depth_mm', round2(shaft - across.valueMm), 'caliper_derived', `shaft diameter ${shaft} - across the flat ${across.valueMm}`);
                } else flat = put('shaft_flat_depth_mm', null, 'buyer_choice', 'Round shaft');
            } else {
                const std = SHAFT_STANDARDS[o.shaft];
                boreType = put('bore_type', std.boreType, 'standard', std.label);
                shaft = put('shaft_diameter_mm', std.diameterMm, 'standard', std.label);
                flat = put('shaft_flat_depth_mm', std.flatDepthMm, 'standard', std.label);
            }
            const boreDepth = o.boreDepth === 'measured' ? cal('bore_depth_mm', 'bore_depth_mm') : put('bore_depth_mm', round2(height - KNOB_DEFAULT_CAP_MM), 'design_rule', `height ${height} - ${KNOB_DEFAULT_CAP_MM} mm cap above the bore`);
            candidate = {
                family: 'round_knob',
                diameter_mm: cal('diameter_mm', 'diameter_mm'),
                height_mm: height,
                bore_type: boreType,
                shaft_diameter_mm: shaft,
                shaft_flat_depth_mm: flat,
                bore_depth_mm: boreDepth,
                grip_ribs: put('grip_ribs', o.gripRibs, 'buyer_choice', 'Grip flutes counted on the old knob'),
                pointer_notch: put('pointer_notch', o.pointerNotch, 'buyer_choice', 'Pointer notch on the old knob'),
            };
            put('bore_clearance_mm', 0.15, 'design_rule', 'Printed fit clearance on the shaft (worker default)');
            put('chamfer_mm', 0.5, 'design_rule', 'Top-edge chamfer (worker default)');
            break;
        }
        case 'spacer': {
            candidate = {
                family: 'spacer_bushing',
                outer_diameter_mm: cal('outer_diameter_mm', 'outer_diameter_mm'),
                inner_diameter_mm: cal('inner_diameter_mm', 'inner_diameter_mm'),
                length_mm: cal('length_mm', 'length_mm'),
                flange_diameter_mm: o.flanged ? cal('flange_diameter_mm', 'flange_diameter_mm') : null,
                flange_thickness_mm: o.flanged ? cal('flange_thickness_mm', 'flange_thickness_mm') : null,
            };
            break;
        }
        case 'bracket': {
            const t = cal('thickness_mm', 'thickness_mm');
            if (o.bracketShape === 'flat') {
                const length = cal('width_mm', 'length_mm');
                const width = cal('height_mm', 'width_mm');
                if (o.bracketHoles) {
                    const d = cal('holes[].diameter_mm', 'hole_diameter_mm');
                    const s = confirmed.get('hole_spacing_mm')!;
                    const x1 = put('holes[0].x_mm', round2((length - s.valueMm) / 2), 'caliper_derived', `centred: (length ${length} - spacing ${s.valueMm}) / 2`);
                    const x2 = put('holes[1].x_mm', round2((length + s.valueMm) / 2), 'caliper_derived', `centred: (length ${length} + spacing ${s.valueMm}) / 2`);
                    const y = put('holes[].y_mm', round2(width / 2), 'design_rule', 'holes on the plate centre line');
                    candidate = { family: 'slotted_plate', width_mm: length, height_mm: width, thickness_mm: t, holes: [{ x_mm: x1, y_mm: y, diameter_mm: d }, { x_mm: x2, y_mm: y, diameter_mm: d }] };
                } else candidate = { family: 'sheet_panel', width_mm: length, height_mm: width, thickness_mm: t };
            } else if (o.bracketShape === 'l') {
                candidate = {
                    family: 'l_bracket',
                    leg_a_mm: cal('leg_a_mm', 'leg_a_mm'),
                    leg_b_mm: cal('leg_b_mm', 'leg_b_mm'),
                    width_mm: cal('width_mm', 'width_mm'),
                    thickness_mm: t,
                    inside_bend_radius_mm: put('inside_bend_radius_mm', t, 'design_rule', 'inside bend radius = sheet thickness'),
                };
            } else {
                candidate = {
                    family: 'multi_bend_bracket',
                    flanges_mm: [cal('flanges_mm[0]', 'leg_a_mm'), cal('flanges_mm[1]', 'web_mm'), cal('flanges_mm[2]', 'leg_b_mm')],
                    bend_angles_deg: [90, -90],
                    width_mm: cal('width_mm', 'width_mm'),
                    thickness_mm: t,
                    inside_bend_radius_mm: put('inside_bend_radius_mm', t, 'design_rule', 'inside bend radius = sheet thickness'),
                };
                put('bend_angles_deg', 'Z profile: +90 then -90', 'buyer_choice', 'Z-shaped bracket');
            }
            break;
        }
    }

    // The trace rule, re-checked: every caliper number is within 0.5 mm of a confirmed reading.
    const readings = [...confirmed.values()].map((c) => c.valueMm);
    for (const t of trace) {
        if (t.source !== 'caliper') continue;
        if (typeof t.value !== 'number' || !readings.some((r) => Math.abs(r - (t.value as number)) <= PLANNER_TRACE_TOLERANCE_MM)) {
            throw new Error(`planner bug: ${t.field} = ${String(t.value)} does not trace to a caliper reading`);
        }
    }
    const parsed = CadSpec.safeParse(candidate);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return {
            status: 'needs_input',
            missing: [],
            questions: [`These readings do not make a part we can build (${issue?.path.join('.') || 'geometry'}: ${issue?.message}). Re-check the caliper readings.`],
        };
    }
    const family = parsed.data.family;
    return { status: 'ready', family, spec: parsed.data as unknown as Record<string, unknown>, trace, printed: family === 'round_knob' || family === 'spacer_bushing' };
}
