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

export const CadSpec = z.discriminatedUnion('family', [SheetPanelSpec, LBracketSpec, EnclosureSpec]);
export type CadSpec = z.infer<typeof CadSpec>;
export type CadSpecInput = z.input<typeof CadSpec>;
export type CadFamily = CadSpec['family'];

/** Families whose flat pattern the R1 instant quote engine can price directly. */
export const SHEET_FAMILIES: readonly CadFamily[] = ['sheet_panel', 'l_bracket'];

export const CadArtifactKind = z.enum(['STEP', 'DXF', 'GLB']);
export type CadArtifactKind = z.infer<typeof CadArtifactKind>;

export const CadArtifact = z.object({
    kind: CadArtifactKind,
    filename: z.string().regex(/^[a-z0-9_]+\.(step|dxf|glb)$/),
    content_type: z.string(),
    bytes: z.number().int().positive(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    content_base64: z.string(),
});
export type CadArtifact = z.infer<typeof CadArtifact>;

export const CadGenerateResponse = z.object({
    family: z.enum(['sheet_panel', 'l_bracket', 'enclosure']),
    artifacts: z.array(CadArtifact).min(1).max(5),
    metrics: z
        .object({
            bbox_mm: z.tuple([z.number(), z.number(), z.number()]),
            volume_mm3: z.number().nonnegative(),
            flat_size_mm: z.tuple([z.number(), z.number()]).optional(),
            thickness_mm: z.number().optional(),
            bend_count: z.number().int().optional(),
            part_count: z.number().int().optional(),
        })
        .passthrough(),
    processes: z.array(z.string()),
    warnings: z.array(z.string()),
    ref: z.string().nullable().optional(),
    duration_ms: z.number().int().nonnegative().optional(),
    worker_version: z.string().optional(),
});
export type CadGenerateResponse = z.infer<typeof CadGenerateResponse>;
