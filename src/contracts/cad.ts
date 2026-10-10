/**
 * CAD worker contracts (EPIC-100-4, workflow 01 "CAD / geometry").
 *
 * `CadSpec` mirrors `services/cad-worker/cad_worker/specs.py` (pydantic). The CAD
 * agent never writes CadQuery code: it chooses a parametric family and fills its
 * bounded parameters, and the worker re-validates every bound before building.
 * Keep both files in sync; `tests/cad/cad-spec.test.ts` pins the shared bounds.
 *
 * All lengths are millimetres.
 */
import { z } from 'zod';

export const CadHole = z
    .object({
        x_mm: z.number().min(0).max(3000),
        y_mm: z.number().min(0).max(3000),
        diameter_mm: z.number().min(0.5).max(200),
    })
    .strict();
export type CadHole = z.infer<typeof CadHole>;

/** Flat laser-cut plate. Hole coordinates are from the lower-left corner. */
export const SheetPanelSpec = z
    .object({
        family: z.literal('sheet_panel'),
        width_mm: z.number().min(10).max(3000),
        height_mm: z.number().min(10).max(1500),
        thickness_mm: z.number().min(0.5).max(25),
        corner_radius_mm: z.number().min(0).max(500).default(0),
        holes: z.array(CadHole).max(200).default([]),
    })
    .strict();

/** 90-degree sheet-metal bracket. Legs are OUTSIDE dimensions; hole y = distance from that leg's free edge. */
export const LBracketSpec = z
    .object({
        family: z.literal('l_bracket'),
        leg_a_mm: z.number().min(10).max(1000),
        leg_b_mm: z.number().min(10).max(1000),
        width_mm: z.number().min(10).max(1500),
        thickness_mm: z.number().min(0.5).max(12),
        inside_bend_radius_mm: z.number().min(0.5).max(50),
        k_factor: z.number().min(0.25).max(0.5).default(0.44),
        holes_a: z.array(CadHole).max(50).default([]),
        holes_b: z.array(CadHole).max(50).default([]),
    })
    .strict();

export const CadStandoff = z
    .object({
        x_mm: z.number().min(-500).max(500),
        y_mm: z.number().min(-500).max(500),
        height_mm: z.number().min(1).max(100),
        outer_diameter_mm: z.number().min(3).max(30),
        hole_diameter_mm: z.number().min(1).max(20),
    })
    .strict();

/** Open box plus optional lip lid (3D print / CNC). `inner_*` is the usable cavity. */
export const EnclosureSpec = z
    .object({
        family: z.literal('enclosure'),
        inner_x_mm: z.number().min(10).max(500),
        inner_y_mm: z.number().min(10).max(500),
        inner_z_mm: z.number().min(10).max(500),
        wall_mm: z.number().min(1).max(10),
        corner_radius_mm: z.number().min(0).max(50).default(0),
        lid: z.boolean().default(true),
        vent_slots: z.number().int().min(0).max(20).default(0),
        standoffs: z.array(CadStandoff).max(12).default([]),
    })
    .strict();

// ---------------------------------------------------------------------------
// Stage 1 families (see specs.py for the full geometry conventions)
// ---------------------------------------------------------------------------

/** Mirrors the R1 DFM rule `bend_flange_min` (minFlangeRatio = 4): flat flange >= 4 x thickness. */
export const MIN_FLANGE_RATIO = 4;

/**
 * A hole on one flange of a bent part: `flange` = 0-based index in profile order,
 * `x_mm` across the width (along the bend lines), `y_mm` along the flange from that
 * flange's START outer face (the first flange: from its free edge).
 */
export const CadFlangeHole = z
    .object({
        flange: z.number().int().min(0).max(4),
        x_mm: z.number().min(0).max(3000),
        y_mm: z.number().min(0).max(3000),
        diameter_mm: z.number().min(0.5).max(200),
    })
    .strict();
export type CadFlangeHole = z.infer<typeof CadFlangeHole>;

/** U-channel: base + two flanges bent the same way. OUTSIDE dimensions; holes: flange 0 = A, 1 = base, 2 = B. */
export const UChannelSpec = z
    .object({
        family: z.literal('u_channel'),
        flange_a_mm: z.number().min(5).max(1000),
        base_mm: z.number().min(5).max(1500),
        flange_b_mm: z.number().min(5).max(1000),
        length_mm: z.number().min(10).max(1500),
        thickness_mm: z.number().min(0.5).max(12),
        inside_bend_radius_mm: z.number().min(0.5).max(50),
        k_factor: z.number().min(0.25).max(0.5).default(0.44),
        holes: z.array(CadFlangeHole).max(100).default([]),
    })
    .strict();

/** Z / hat / open profiles: OUTSIDE flange lengths (bends + 1) and 1-4 bends of +90 (up) or -90 (down). */
export const MultiBendBracketSpec = z
    .object({
        family: z.literal('multi_bend_bracket'),
        flanges_mm: z.array(z.number().min(5).max(1000)).min(2).max(5),
        bend_angles_deg: z
            .array(z.union([z.literal(90), z.literal(-90)]))
            .min(1)
            .max(4),
        width_mm: z.number().min(10).max(1500),
        thickness_mm: z.number().min(0.5).max(12),
        inside_bend_radius_mm: z.number().min(0.5).max(50),
        k_factor: z.number().min(0.25).max(0.5).default(0.44),
        holes: z.array(CadFlangeHole).max(100).default([]),
    })
    .strict();

/** Obround slot: centre from the lower-left corner, end-to-end length (> width), CCW angle. */
export const CadSlot = z
    .object({
        x_mm: z.number().min(0).max(3000),
        y_mm: z.number().min(0).max(3000),
        length_mm: z.number().positive().max(1000),
        width_mm: z.number().min(0.5).max(200),
        angle_deg: z.number().min(0).lt(180).default(0),
    })
    .strict();
export type CadSlot = z.infer<typeof CadSlot>;

/** Countersunk through-hole: the cone is in STEP/GLB, the DXF cuts the through-diameter. */
export const CadCountersink = z
    .object({
        x_mm: z.number().min(0).max(3000),
        y_mm: z.number().min(0).max(3000),
        through_diameter_mm: z.number().min(1).max(50),
        head_diameter_mm: z.number().min(2).max(80),
        angle_deg: z.union([z.literal(82), z.literal(90), z.literal(100)]).default(90),
    })
    .strict();
export type CadCountersink = z.infer<typeof CadCountersink>;

/** Flat plate with round holes, slots and countersinks; every feature keeps one thickness to edges and neighbours. */
export const SlottedPlateSpec = z
    .object({
        family: z.literal('slotted_plate'),
        width_mm: z.number().min(10).max(3000),
        height_mm: z.number().min(10).max(1500),
        thickness_mm: z.number().min(0.5).max(25),
        corner_radius_mm: z.number().min(0).max(500).default(0),
        holes: z.array(CadHole).max(200).default([]),
        slots: z.array(CadSlot).max(100).default([]),
        countersinks: z.array(CadCountersink).max(100).default([]),
    })
    .strict();

/**
 * Bent sheet-metal enclosure (body U-channel + two end caps + lid with drip lips), all flat
 * patterns the R1 network can cut and bend. `inner_*` is the cavity; fastener holes are placed
 * by the worker. `floor_holes`: x from the first end cap's inner face, y from wall A's inner face.
 */
export const SheetEnclosureSpec = z
    .object({
        family: z.literal('sheet_enclosure'),
        inner_x_mm: z.number().min(60).max(700),
        inner_y_mm: z.number().min(40).max(500),
        inner_z_mm: z.number().min(30).max(500),
        thickness_mm: z.number().min(0.8).max(3.2),
        inside_bend_radius_mm: z.number().min(0.5).max(4),
        k_factor: z.number().min(0.25).max(0.5).default(0.44),
        end_flange_mm: z.number().min(8).max(40).default(15),
        lid_lip_mm: z.number().min(8).max(60).default(15),
        floor_holes: z.array(CadHole).max(20).default([]),
        gland_diameter_mm: z.number().min(3).max(40).nullable().default(null),
    })
    .strict();

// ---------------------------------------------------------------------------
// R6 Reconstruct: printed replacement parts (mirror specs.py RoundKnob / SpacerBushing)
// ---------------------------------------------------------------------------

/** The worker refuses printed walls under this (unbuildable); the print DFM blocks under 1.2 mm. */
export const PRINT_WALL_FLOOR_MM = 0.8;
export const POINTER_NOTCH_DEPTH_MM = 0.6;

/**
 * A round control knob, printed bore-down: body Ø x height, a blind bore of `bore_depth_mm`
 * from the underside for the shaft (+ `bore_clearance_mm` fit), a D-shaft flat
 * `shaft_flat_depth_mm` deep (6 mm D-shafts: 1.5), optional grip flutes, pointer notch, chamfer.
 */
export const RoundKnobSpec = z
    .object({
        family: z.literal('round_knob'),
        diameter_mm: z.number().min(8).max(120),
        height_mm: z.number().min(5).max(80),
        bore_type: z.enum(['d_shaft', 'round']).default('d_shaft'),
        shaft_diameter_mm: z.number().min(2).max(25),
        shaft_flat_depth_mm: z.number().min(0.2).max(6).nullable().default(null),
        bore_depth_mm: z.number().min(2).max(78),
        bore_clearance_mm: z.number().min(0).max(0.5).default(0.15),
        grip_ribs: z.number().int().min(0).max(60).default(0),
        rib_depth_mm: z.number().min(0.3).max(3).default(0.8),
        pointer_notch: z.boolean().default(false),
        chamfer_mm: z.number().min(0).max(5).default(0.5),
    })
    .strict();

/** A plain or flanged spacer / bushing, printed flange-down. `length_mm` includes the flange. */
export const SpacerBushingSpec = z
    .object({
        family: z.literal('spacer_bushing'),
        outer_diameter_mm: z.number().min(3).max(200),
        inner_diameter_mm: z.number().min(1).max(190),
        length_mm: z.number().min(1).max(300),
        flange_diameter_mm: z.number().min(4).max(300).nullable().default(null),
        flange_thickness_mm: z.number().min(0.8).max(50).nullable().default(null),
        chamfer_mm: z.number().min(0).max(3).default(0),
    })
    .strict();

type RoundKnobShape = z.infer<typeof RoundKnobSpec>;
type SpacerBushingShape = z.infer<typeof SpacerBushingSpec>;

/** Thinnest wall of a printed part, exactly as specs.py computes it (the print DFM checks this). */
export function printedMinWallMm(spec: RoundKnobShape | SpacerBushingShape): number {
    const r3 = (n: number) => Math.round(n * 1000) / 1000;
    if (spec.family === 'round_knob') {
        const bore = spec.shaft_diameter_mm + spec.bore_clearance_mm;
        const radial = (spec.diameter_mm - bore) / 2 - (spec.grip_ribs ? spec.rib_depth_mm : 0);
        const cap = spec.height_mm - spec.bore_depth_mm - (spec.pointer_notch ? POINTER_NOTCH_DEPTH_MM : 0);
        return r3(Math.min(radial, cap));
    }
    const walls = [(spec.outer_diameter_mm - spec.inner_diameter_mm) / 2];
    if (spec.flange_thickness_mm != null) walls.push(spec.flange_thickness_mm);
    return r3(Math.min(...walls));
}

export const CAD_FAMILIES = ['sheet_panel', 'l_bracket', 'enclosure', 'u_channel', 'multi_bend_bracket', 'slotted_plate', 'sheet_enclosure', 'round_knob', 'spacer_bushing'] as const;
export const CadFamilyEnum = z.enum(CAD_FAMILIES);

const CadSpecUnion = z.discriminatedUnion('family', [SheetPanelSpec, LBracketSpec, EnclosureSpec, UChannelSpec, MultiBendBracketSpec, SlottedPlateSpec, SheetEnclosureSpec, RoundKnobSpec, SpacerBushingSpec]);
type CadSpecShape = z.infer<typeof CadSpecUnion>;

// ---------------------------------------------------------------------------
// Cross-field checks (mirror specs.py so bad specs fail before the worker round trip)
// ---------------------------------------------------------------------------

export const bendAllowance = (r: number, t: number, k: number) => (Math.PI / 2) * (r + k * t);

type Issue = { path: (string | number)[]; message: string };

/** Mirrors `check_bent_profile`: flange vs setback, minimum flange, hole on the flat with one thickness to bends and edges. */
export function checkBentProfile(flanges: number[], angles: number[], width: number, t: number, r: number, k: number, holes: CadFlangeHole[], label = 'flanges_mm'): Issue[] {
    const issues: Issue[] = [];
    if (flanges.length !== angles.length + 1) return [{ path: [label], message: `need exactly one more flange than bends (${angles.length} bends)` }];
    const setback = r + t;
    const ba = bendAllowance(r, t, k);
    const flats: number[] = [];
    flanges.forEach((length, i) => {
        const bends = (i > 0 ? 1 : 0) + (i < flanges.length - 1 ? 1 : 0);
        const flat = length - bends * setback;
        const have = bends === 1 ? flat + ba / 2 : flat + ba;
        if (flat <= 0) issues.push({ path: [label, i], message: `${length} mm is shorter than its bend setback` });
        else if (have < MIN_FLANGE_RATIO * t - 1e-9) issues.push({ path: [label, i], message: `${length} mm is too short: the press brake needs a ${(MIN_FLANGE_RATIO * t).toFixed(2)} mm flat flange` });
        flats.push(flat);
    });
    if (issues.length) return issues;
    holes.forEach((h, j) => {
        if (h.flange >= flanges.length) {
            issues.push({ path: ['holes', j, 'flange'], message: `flange ${h.flange} does not exist` });
            return;
        }
        const lo = h.flange === 0 ? 0 : setback;
        const hi = lo + flats[h.flange]!;
        const rad = h.diameter_mm / 2;
        if (h.y_mm - rad < lo + t - 1e-9 || h.y_mm + rad > hi - t + 1e-9) issues.push({ path: ['holes', j, 'y_mm'], message: `must sit on the flat of flange ${h.flange} with one thickness to bends and edges` });
        if (h.x_mm - rad < t - 1e-9 || h.x_mm + rad > width - t + 1e-9) issues.push({ path: ['holes', j, 'x_mm'], message: `must keep ${t} mm from the side edges` });
    });
    return issues;
}

const insetRoundedRect = (p: [number, number], w: number, h: number, r: number) => {
    const qx = Math.abs(p[0] - w / 2) - (w / 2 - r);
    const qy = Math.abs(p[1] - h / 2) - (h / 2 - r);
    return -(Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r);
};

const pointSegment = (p: [number, number], a: [number, number], b: [number, number]) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const den = dx * dx + dy * dy;
    const u = den === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / den));
    return Math.hypot(p[0] - (a[0] + u * dx), p[1] - (a[1] + u * dy));
};

const segmentDistance = (a1: [number, number], b1: [number, number], a2: [number, number], b2: [number, number]) => {
    const side = (p: [number, number], q: [number, number], s: [number, number]) => (s[1] - p[1]) * (q[0] - p[0]) - (q[1] - p[1]) * (s[0] - p[0]);
    const distinct = (p: [number, number], q: [number, number]) => p[0] !== q[0] || p[1] !== q[1];
    if (distinct(a1, b1) && distinct(a2, b2)) {
        const d1 = side(a2, b2, a1) > 0;
        const d2 = side(a2, b2, b1) > 0;
        const d3 = side(a1, b1, a2) > 0;
        const d4 = side(a1, b1, b2) > 0;
        if (d1 !== d2 && d3 !== d4) return 0;
    }
    return Math.min(pointSegment(a1, a2, b2), pointSegment(b1, a2, b2), pointSegment(a2, a1, b1), pointSegment(b2, a1, b1));
};

export const countersinkDepth = (c: Pick<CadCountersink, 'through_diameter_mm' | 'head_diameter_mm' | 'angle_deg'>) =>
    (c.head_diameter_mm - c.through_diameter_mm) / 2 / Math.tan(((c.angle_deg ?? 90) * Math.PI) / 360);

export const slotEnds = (s: Pick<CadSlot, 'x_mm' | 'y_mm' | 'length_mm' | 'width_mm' | 'angle_deg'>): [[number, number], [number, number]] => {
    const half = (s.length_mm - s.width_mm) / 2;
    const a = ((s.angle_deg ?? 0) * Math.PI) / 180;
    const dx = Math.cos(a) * half;
    const dy = Math.sin(a) * half;
    return [
        [s.x_mm - dx, s.y_mm - dy],
        [s.x_mm + dx, s.y_mm + dy],
    ];
};

export const lidGapMm = (r: number) => Math.max(2, r + 0.2);

function holeInside(h: CadHole, w: number, hgt: number): boolean {
    const r = h.diameter_mm / 2;
    return h.x_mm - r > 0 && h.x_mm + r < w && h.y_mm - r > 0 && h.y_mm + r < hgt;
}

/** Every cross-field rule of specs.py (messages are short; the worker's are authoritative). */
export function cadSpecIssues(s: CadSpecShape): Issue[] {
    const issues: Issue[] = [];
    switch (s.family) {
        case 'sheet_panel':
            if (s.corner_radius_mm * 2 >= Math.min(s.width_mm, s.height_mm)) issues.push({ path: ['corner_radius_mm'], message: 'must be less than half the shorter side' });
            s.holes.forEach((h, i) => {
                if (!holeInside(h, s.width_mm, s.height_mm)) issues.push({ path: ['holes', i], message: 'is not fully inside the part' });
            });
            break;
        case 'l_bracket': {
            const setback = s.inside_bend_radius_mm + s.thickness_mm;
            for (const [name, leg, holes] of [
                ['holes_a', s.leg_a_mm, s.holes_a],
                ['holes_b', s.leg_b_mm, s.holes_b],
            ] as const) {
                const flat = leg - setback;
                if (flat < 2 * s.thickness_mm) issues.push({ path: [name], message: 'leg is too short for this thickness and bend radius' });
                holes.forEach((h, i) => {
                    if (!holeInside(h, s.width_mm, flat)) issues.push({ path: [name, i], message: 'is not fully inside the leg' });
                });
            }
            break;
        }
        case 'enclosure':
            if (s.corner_radius_mm && s.corner_radius_mm >= Math.min(s.inner_x_mm, s.inner_y_mm) / 2 + s.wall_mm) issues.push({ path: ['corner_radius_mm'], message: 'too large for the footprint' });
            s.standoffs.forEach((o, i) => {
                if (o.hole_diameter_mm >= o.outer_diameter_mm) issues.push({ path: ['standoffs', i], message: 'hole must be smaller than the boss' });
                if (o.height_mm >= s.inner_z_mm) issues.push({ path: ['standoffs', i], message: 'taller than the cavity' });
                const r = o.outer_diameter_mm / 2;
                if (Math.abs(o.x_mm) + r > s.inner_x_mm / 2 || Math.abs(o.y_mm) + r > s.inner_y_mm / 2) issues.push({ path: ['standoffs', i], message: 'outside the cavity' });
            });
            if (s.vent_slots && (s.vent_slots * 6 > s.inner_y_mm || s.inner_z_mm < 15)) issues.push({ path: ['vent_slots'], message: 'too many vent slots for this enclosure' });
            break;
        case 'u_channel':
            issues.push(...checkBentProfile([s.flange_a_mm, s.base_mm, s.flange_b_mm], [90, 90], s.length_mm, s.thickness_mm, s.inside_bend_radius_mm, s.k_factor, s.holes));
            break;
        case 'multi_bend_bracket':
            issues.push(...checkBentProfile(s.flanges_mm, s.bend_angles_deg, s.width_mm, s.thickness_mm, s.inside_bend_radius_mm, s.k_factor, s.holes));
            break;
        case 'slotted_plate': {
            const { width_mm: w, height_mm: h, thickness_mm: t, corner_radius_mm: cr } = s;
            if (cr * 2 >= Math.min(w, h)) issues.push({ path: ['corner_radius_mm'], message: 'must be less than half the shorter side' });
            if (!s.holes.length && !s.slots.length && !s.countersinks.length) issues.push({ path: ['holes'], message: 'a slotted_plate needs at least one hole, slot or countersink' });
            const features: { path: (string | number)[]; a: [number, number]; b: [number, number]; r: number }[] = [];
            s.holes.forEach((o, i) => features.push({ path: ['holes', i], a: [o.x_mm, o.y_mm], b: [o.x_mm, o.y_mm], r: o.diameter_mm / 2 }));
            s.slots.forEach((o, i) => {
                if (o.length_mm <= o.width_mm) issues.push({ path: ['slots', i], message: 'length_mm must be greater than width_mm' });
                if (o.width_mm < t - 1e-9) issues.push({ path: ['slots', i], message: 'narrower than the sheet thickness' });
                const [a, b] = slotEnds(o);
                features.push({ path: ['slots', i], a, b, r: o.width_mm / 2 });
            });
            s.countersinks.forEach((o, i) => {
                if (o.head_diameter_mm <= o.through_diameter_mm) issues.push({ path: ['countersinks', i], message: 'head_diameter_mm must exceed through_diameter_mm' });
                else if (countersinkDepth(o) > 0.75 * t + 1e-9) issues.push({ path: ['countersinks', i], message: 'cone too deep for this plate (max 75% of thickness)' });
                features.push({ path: ['countersinks', i], a: [o.x_mm, o.y_mm], b: [o.x_mm, o.y_mm], r: o.head_diameter_mm / 2 });
            });
            for (const f of features) {
                if ([f.a, f.b].some((p) => insetRoundedRect(p, w, h, cr) < f.r + t - 1e-9)) issues.push({ path: f.path, message: `must keep ${t} mm from the plate edge` });
            }
            for (let i = 0; i < features.length; i++) {
                for (let j = i + 1; j < features.length; j++) {
                    const p = features[i]!;
                    const q = features[j]!;
                    if (segmentDistance(p.a, p.b, q.a, q.b) - p.r - q.r < t - 1e-9) issues.push({ path: q.path, message: `closer than one thickness to ${p.path.join('.')}` });
                }
            }
            break;
        }
        case 'sheet_enclosure': {
            const t = s.thickness_mm;
            const r = s.inside_bend_radius_mm;
            for (const [name, length] of [
                ['end_flange_mm', s.end_flange_mm],
                ['lid_lip_mm', s.lid_lip_mm],
            ] as const) {
                const profile = checkBentProfile([length, 100, length], [90, 90], 1000, t, r, s.k_factor, [], name);
                if (profile.length) issues.push(...profile);
                else if (length - (r + t) < 2 * t + 3.4) issues.push({ path: [name], message: 'leaves no room for a fastener hole' });
            }
            const lipY = (s.lid_lip_mm - (r + t)) / 2;
            if (s.lid_lip_mm - t - lidGapMm(r) - lipY - 1.7 < t - 1e-9) issues.push({ path: ['lid_lip_mm'], message: 'too short to screw the lid to the walls' });
            if (s.inner_z_mm < s.lid_lip_mm + 2 * s.end_flange_mm) issues.push({ path: ['inner_z_mm'], message: 'too small for the lid lip and the end-cap rivets' });
            if ((s.inner_x_mm + 2 * t) / 4 - 2 < s.end_flange_mm + t) issues.push({ path: ['inner_x_mm'], message: 'too short to keep the lid screws clear of the end caps' });
            if (s.inner_y_mm - 2 * (r + t) < 4 * t) issues.push({ path: ['inner_y_mm'], message: 'too narrow for this sheet and bend radius' });
            s.floor_holes.forEach((o, i) => {
                const rad = o.diameter_mm / 2;
                if (o.y_mm - rad < r + t - 1e-9 || o.y_mm + rad > s.inner_y_mm - r - t + 1e-9) issues.push({ path: ['floor_holes', i], message: 'must keep one thickness from the side-wall bends' });
                if (o.x_mm - rad < t - 1e-9 || o.x_mm + rad > s.inner_x_mm - t + 1e-9) issues.push({ path: ['floor_holes', i], message: 'must keep one thickness from the end caps' });
            });
            if (s.gland_diameter_mm != null && s.gland_diameter_mm + 4 * t > Math.min(s.inner_y_mm - 2 * (r + t), s.inner_z_mm - r)) issues.push({ path: ['gland_diameter_mm'], message: 'does not fit the end cap' });
            break;
        }
        case 'round_knob': {
            if (s.bore_type === 'd_shaft') {
                if (s.shaft_flat_depth_mm == null) issues.push({ path: ['shaft_flat_depth_mm'], message: 'a d_shaft bore needs shaft_flat_depth_mm' });
                else if (s.shaft_flat_depth_mm >= s.shaft_diameter_mm / 2) issues.push({ path: ['shaft_flat_depth_mm'], message: 'must be less than the shaft radius' });
            } else if (s.shaft_flat_depth_mm != null) issues.push({ path: ['shaft_flat_depth_mm'], message: 'is only for a d_shaft bore' });
            if (s.bore_depth_mm > s.height_mm - PRINT_WALL_FLOOR_MM) issues.push({ path: ['bore_depth_mm'], message: `must leave at least ${PRINT_WALL_FLOOR_MM} mm of cap above the bore` });
            if (printedMinWallMm(s) < PRINT_WALL_FLOOR_MM - 1e-9) issues.push({ path: ['diameter_mm'], message: `the wall around the bore is under ${PRINT_WALL_FLOOR_MM} mm` });
            if (s.chamfer_mm && s.chamfer_mm >= Math.min(s.height_mm / 3, s.diameter_mm / 6)) issues.push({ path: ['chamfer_mm'], message: 'too large for this knob' });
            if (s.grip_ribs && (Math.PI * s.diameter_mm) / s.grip_ribs < 2 * s.rib_depth_mm + 1) issues.push({ path: ['grip_ribs'], message: 'too many grip ribs for this diameter' });
            if (s.pointer_notch && s.height_mm - s.bore_depth_mm < POINTER_NOTCH_DEPTH_MM + PRINT_WALL_FLOOR_MM) issues.push({ path: ['pointer_notch'], message: 'needs a thicker cap above the bore' });
            break;
        }
        case 'spacer_bushing': {
            if ((s.flange_diameter_mm == null) !== (s.flange_thickness_mm == null)) issues.push({ path: ['flange_diameter_mm'], message: 'a flange needs both flange_diameter_mm and flange_thickness_mm' });
            if (s.flange_diameter_mm != null && s.flange_diameter_mm <= s.outer_diameter_mm) issues.push({ path: ['flange_diameter_mm'], message: 'must be larger than outer_diameter_mm' });
            if (s.flange_thickness_mm != null && s.flange_thickness_mm >= s.length_mm) issues.push({ path: ['flange_thickness_mm'], message: 'must be less than length_mm' });
            const wall = printedMinWallMm(s);
            if (wall < PRINT_WALL_FLOOR_MM - 1e-9) issues.push({ path: ['inner_diameter_mm'], message: `the tube wall is under ${PRINT_WALL_FLOOR_MM} mm` });
            else if (s.chamfer_mm && s.chamfer_mm >= wall / 2) issues.push({ path: ['chamfer_mm'], message: 'must be less than half the wall' });
            break;
        }
    }
    return issues;
}

export const CadSpec = CadSpecUnion.superRefine((spec, ctx) => {
    for (const issue of cadSpecIssues(spec)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: issue.path, message: issue.message });
});
export type CadSpec = z.infer<typeof CadSpec>;
export type CadSpecInput = z.input<typeof CadSpec>;
export type CadFamily = CadSpec['family'];

/** Families whose flat patterns the R1 instant quote engine can price directly. */
export const SHEET_FAMILIES: readonly CadFamily[] = ['sheet_panel', 'l_bracket', 'u_channel', 'multi_bend_bracket', 'slotted_plate', 'sheet_enclosure'];

/** R6 printed families: an STL for the print farm, priced by the print quote engine (src/server/quote/printing). */
export const PRINTED_FAMILIES: readonly CadFamily[] = ['round_knob', 'spacer_bushing'];
export type PrintedCadSpec = Extract<CadSpec, { family: 'round_knob' | 'spacer_bushing' }>;
export const isPrintedSpec = (spec: CadSpec): spec is PrintedCadSpec => PRINTED_FAMILIES.includes(spec.family);

/** Geometry (STEP / DXF / GLB, STL for printed parts) plus the documents every result carries (BOM JSON + CSV, SVG drawing, manifest). */
export const CadArtifactKind = z.enum(['STEP', 'DXF', 'GLB', 'STL', 'BOM', 'CSV', 'SVG', 'MANIFEST']);
export type CadArtifactKind = z.infer<typeof CadArtifactKind>;

export const CadArtifact = z.object({
    kind: CadArtifactKind,
    filename: z.string().regex(/^[a-z0-9_]+\.(step|dxf|glb|stl|json|csv|svg)$/),
    content_type: z.string(),
    bytes: z.number().int().positive(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    content_base64: z.string(),
});
export type CadArtifact = z.infer<typeof CadArtifact>;

/** One flat pattern of a multi-panel result (sheet_enclosure). */
export const CadPanelMetric = z.object({
    name: z.string(),
    label: z.string(),
    filename: z.string(),
    quantity: z.number().int().positive(),
    flat_size_mm: z.tuple([z.number(), z.number()]),
    bend_count: z.number().int().nonnegative(),
    hole_count: z.number().int().nonnegative(),
});
export type CadPanelMetric = z.infer<typeof CadPanelMetric>;

export const CadGenerateResponse = z.object({
    family: CadFamilyEnum,
    artifacts: z.array(CadArtifact).min(1).max(16),
    metrics: z
        .object({
            bbox_mm: z.tuple([z.number(), z.number(), z.number()]),
            volume_mm3: z.number().nonnegative(),
            flat_size_mm: z.tuple([z.number(), z.number()]).optional(),
            thickness_mm: z.number().optional(),
            bend_count: z.number().int().optional(),
            part_count: z.number().int().optional(),
            panels: z.array(CadPanelMetric).optional(),
            countersink_count: z.number().int().optional(),
            /** All families (manifest `metrics`): the print quote engine prices from it. */
            surface_area_mm2: z.number().nonnegative().optional(),
            /** Printed families: thinnest wall (print DFM) and the widest bridge (overhang note). */
            min_wall_mm: z.number().nonnegative().optional(),
            bridge_span_mm: z.number().nonnegative().optional(),
        })
        .passthrough(),
    processes: z.array(z.string()),
    warnings: z.array(z.string()),
    ref: z.string().nullable().optional(),
    duration_ms: z.number().int().nonnegative().optional(),
    worker_version: z.string().optional(),
});
export type CadGenerateResponse = z.infer<typeof CadGenerateResponse>;

// ---------------------------------------------------------------------------
// Build-level CAD (POST/GET /api/builds/:buildId/cad)
// ---------------------------------------------------------------------------

/** Optional explicit spec (buyer-entered dimensions). Without it, the CAD agent proposes one from the approved version. */
export const BuildCadRequest = z.object({ spec: CadSpec.optional() });
export type BuildCadRequest = z.input<typeof BuildCadRequest>;

export const BuildCadArtifactView = z.object({
    kind: CadArtifactKind,
    filename: z.string(),
    bytes: z.number().int().positive(),
    sha256: z.string(),
    /** Signed, expiring GET URL. */
    url: z.string().url(),
    expiresAt: z.string(),
});
export type BuildCadArtifactView = z.infer<typeof BuildCadArtifactView>;

/** A flat pattern attached to the build as an instantly quotable part. */
export const BuildCadPart = z.object({
    partId: z.string(),
    filename: z.string(),
    label: z.string(),
    /** Pieces per finished build (an enclosure needs two plain end caps, ...). */
    quantity: z.number().int().positive(),
    status: z.string().nullable(),
});
export type BuildCadPart = z.infer<typeof BuildCadPart>;

/**
 * Preliminary estimate from the R1 quote engine (workflow 01 artifacts 8-10): every panel is
 * quoted (BINDING when the engine can price it) for each catalog material that has the sheet
 * thickness; the range spans those materials. Purchased hardware is listed in the BOM, not priced.
 */
export const BuildCadEstimateOption = z.object({
    materialSlug: z.string(),
    materialName: z.string(),
    thicknessOptionId: z.string(),
    /** Total for `quantity` finished builds (every panel x its pieces per build). */
    totalCents: z.number().int().nonnegative(),
    unitCents: z.number().int().nonnegative(),
    makeabilityScore: z.number().int().min(0).max(100),
    leadTimeDays: z.number().int().positive(),
    shipDate: z.string(),
    allBinding: z.boolean(),
    quoteIds: z.array(z.string()),
    recommended: z.boolean(),
});
export type BuildCadEstimateOption = z.infer<typeof BuildCadEstimateOption>;

export const BuildCadEstimate = z.object({
    quantity: z.number().int().positive(),
    quantitySource: z.enum(['buyer', 'default']),
    currency: z.string(),
    /** Makeability of the recommended (else cheapest) option: the lowest panel score. */
    makeabilityScore: z.number().int().min(0).max(100),
    priceRange: z.object({ lowCents: z.number().int().nonnegative(), highCents: z.number().int().nonnegative() }),
    productionDays: z.object({ min: z.number().int().positive(), max: z.number().int().positive() }),
    trustLevel: z.enum(['BINDING', 'ESTIMATE']),
    options: z.array(BuildCadEstimateOption),
    notes: z.array(z.string()),
});
export type BuildCadEstimate = z.infer<typeof BuildCadEstimate>;

export const BuildCadGenerated = z.object({
    status: z.literal('generated'),
    /** The new DRAFT design version that carries the geometry. */
    version: z.number().int().positive(),
    family: CadGenerateResponse.shape.family,
    spec: CadSpec,
    metrics: CadGenerateResponse.shape.metrics,
    processes: z.array(z.string()),
    warnings: z.array(z.string()),
    /** Holes or other details the agent proposed but the buyer never specified (dropped, not invented). */
    dropped: z.array(z.string()),
    artifacts: z.array(BuildCadArtifactView),
    /** First flat-pattern part (kept for single-panel callers); see `parts` for every panel. */
    partId: z.string().nullable(),
    partStatus: z.string().nullable(),
    parts: z.array(BuildCadPart).optional(),
    /** true when every flat pattern can go straight to the instant quote on /parts/:partId. */
    quotable: z.boolean(),
    /** Preliminary BINDING-engine estimate (sheet families), null when no catalog material fits. */
    estimate: BuildCadEstimate.nullable().optional(),
});
export type BuildCadGenerated = z.infer<typeof BuildCadGenerated>;

export const BuildCadResponse = z.discriminatedUnion('status', [
    BuildCadGenerated,
    /** Dimensions are missing or untraceable: they were added as NEEDS_INPUT questions in a new version. */
    z.object({ status: z.literal('needs_input'), version: z.number().int().positive(), questions: z.array(z.string()) }),
    /** No supported parametric family fits: route the build to sourcing instead. */
    z.object({ status: z.literal('not_supported'), reason: z.string() }),
]);
export type BuildCadResponse = z.infer<typeof BuildCadResponse>;
