/**
 * CAD agent (workflow 01, "CAD / geometry"): approved Build Graph version -> CadSpec.
 *
 * The model only picks a parametric family and fills its parameters (structured
 * output). It never writes CadQuery. Deterministic guards then refuse to trust it:
 *   - every critical length must trace to a number the BUYER supplied (a user-sourced
 *     REQUIREMENT, or an answered UNKNOWN), within 0.5 mm. An untraceable length becomes a
 *     NEEDS_INPUT question rather than an invented dimension (workflow 01, rule 1);
 *   - holes, slots, countersinks, floor holes and the cable gland are kept only when every
 *     number that places or sizes them is buyer-supplied too (otherwise they are dropped and
 *     reported, never invented);
 *   - the result must parse as a strict `CadSpec` (the worker validates again).
 * Process choices (thickness, bend radius, wall, corner radius, end-cap flange, lid lip) may
 * come from the model or the MATERIAL node: they are manufacturing decisions, not buyer
 * dimensions, and DFM checks them later.
 */
import 'server-only';
import { generateText, NoObjectGeneratedError, NoOutputGeneratedError, Output, type LanguageModel } from 'ai';
import { z } from 'zod';
import type { BgNode, BuildGraphView } from '@/contracts/build-graph';
import { CadSpec } from '@/contracts/cad';
import { getMakeAiModel } from '@/server/make-ai/model';

const MAX_OUTPUT_TOKENS = 3072;
const TIMEOUT_MS = 30_000;

/** Lengths that define the product and must come from the buyer. */
export const CRITICAL_PARAMS = [
    'width_mm',
    'height_mm',
    'leg_a_mm',
    'leg_b_mm',
    'inner_x_mm',
    'inner_y_mm',
    'inner_z_mm',
    'flange_a_mm',
    'base_mm',
    'flange_b_mm',
    'length_mm',
] as const;
type CriticalParam = (typeof CRITICAL_PARAMS)[number];
/** Manufacturing choices the agent may make (DFM validates them). */
export const PROCESS_PARAMS = ['thickness_mm', 'inside_bend_radius_mm', 'k_factor', 'corner_radius_mm', 'wall_mm', 'vent_slots', 'lid', 'end_flange_mm', 'lid_lip_mm', 'bend_angles_deg'] as const;

const ProposalHole = z.object({ x_mm: z.number(), y_mm: z.number(), diameter_mm: z.number() });
const ProposalFlangeHole = z.object({ flange: z.number().int(), x_mm: z.number(), y_mm: z.number(), diameter_mm: z.number() });
const ProposalSlot = z.object({ x_mm: z.number(), y_mm: z.number(), length_mm: z.number(), width_mm: z.number(), angle_deg: z.number().optional() });
const ProposalCountersink = z.object({ x_mm: z.number(), y_mm: z.number(), through_diameter_mm: z.number(), head_diameter_mm: z.number(), angle_deg: z.number().optional() });

export const PROPOSAL_FAMILIES = ['sheet_panel', 'l_bracket', 'enclosure', 'u_channel', 'multi_bend_bracket', 'slotted_plate', 'sheet_enclosure', 'not_supported'] as const;

/** Loose schema handed to the model (flat, provider-friendly); tightened by the guards below. */
export const CadProposal = z.object({
    family: z.enum(PROPOSAL_FAMILIES),
    width_mm: z.number().optional(),
    height_mm: z.number().optional(),
    leg_a_mm: z.number().optional(),
    leg_b_mm: z.number().optional(),
    inner_x_mm: z.number().optional(),
    inner_y_mm: z.number().optional(),
    inner_z_mm: z.number().optional(),
    flange_a_mm: z.number().optional(),
    base_mm: z.number().optional(),
    flange_b_mm: z.number().optional(),
    length_mm: z.number().optional(),
    /** multi_bend_bracket: outside length of every flange in profile order. */
    flanges_mm: z.array(z.number()).max(5).optional(),
    /** multi_bend_bracket: +90 (up) / -90 (down) per bend. */
    bend_angles_deg: z.array(z.number()).max(4).optional(),
    thickness_mm: z.number().optional(),
    inside_bend_radius_mm: z.number().optional(),
    corner_radius_mm: z.number().optional(),
    wall_mm: z.number().optional(),
    vent_slots: z.number().int().optional(),
    lid: z.boolean().optional(),
    end_flange_mm: z.number().optional(),
    lid_lip_mm: z.number().optional(),
    gland_diameter_mm: z.number().optional(),
    holes: z.array(ProposalHole).max(50).optional(),
    holes_a: z.array(ProposalHole).max(50).optional(),
    holes_b: z.array(ProposalHole).max(50).optional(),
    flange_holes: z.array(ProposalFlangeHole).max(50).optional(),
    slots: z.array(ProposalSlot).max(50).optional(),
    countersinks: z.array(ProposalCountersink).max(50).optional(),
    floor_holes: z.array(ProposalHole).max(20).optional(),
    /** For each critical length: which node key it came from. */
    dimension_sources: z.array(z.object({ param: z.string().max(40), node_key: z.string().max(100) })).max(20),
    missing_inputs: z.array(z.string().max(300)).max(10),
    rationale: z.string().max(1000),
});
export type CadProposal = z.infer<typeof CadProposal>;

export type CadAgentResult =
    | { status: 'ready'; spec: CadSpec; rationale: string; dropped: string[] }
    | { status: 'needs_input'; questions: string[]; rationale: string }
    | { status: 'not_supported'; reason: string };

export const CAD_AGENT_INSTRUCTIONS = `You are the CAD specialist inside DiscoverMake's Make AI.
Pick ONE parametric family that can make the product, or "not_supported":
- sheet_panel: a flat laser-cut plate (width, height, thickness, optional corner radius and round holes from the lower-left corner).
- slotted_plate: a flat plate with round holes, obround slots (centre x/y, end-to-end length, width, angle) and countersunk holes (x/y, through and head diameter), all from the lower-left corner.
- l_bracket: a sheet-metal bracket with one 90 degree bend (outside leg lengths leg_a/leg_b, width, thickness, inside bend radius; holes per leg measured from that leg's free edge).
- u_channel: a sheet-metal channel with two 90 degree bends the same way (outside flange_a, base, flange_b; length along the bends; flange_holes with flange 0/1/2).
- multi_bend_bracket: Z, hat and other open profiles with 1-4 bends: flanges_mm lists every flange's outside length in order, bend_angles_deg is +90 (up) or -90 (down) per bend (Z = [90,-90], hat = [90,-90,-90,90]); width along the bends.
- sheet_enclosure: a bent sheet-metal box with a lid (body, two end caps, lid) for laser cutting and bending: inner cavity x (length), y (width), z (height), sheet thickness, inside bend radius; optional floor_holes and a cable gland hole diameter.
- enclosure: an open box with an optional lid for 3D printing or CNC (inner cavity x/y/z, wall, corner radius, vent slots). Prefer sheet_enclosure for metal or outdoor boxes.
Rules:
- Use ONLY dimensions the buyer stated (nodes with source "user" or requirementSource "user", and answered questions). For every product-defining length, list in dimension_sources the node key you took it from.
- If a product-defining length is missing, leave it out and add a short question to missing_inputs. Never estimate or invent a dimension.
- You may choose thickness, bend radius, wall, corner radius, end_flange_mm and lid_lip_mm from the material and process; keep them conventional (sheet 0.8-6 mm, bend radius >= thickness, wall 2-3 mm for printing). Prefer a sheet thickness the catalog stocks for the chosen material (listed below when known).
- Only include holes, slots, countersinks, floor holes or a gland whose positions and sizes the buyer gave.
- Answer "not_supported" for anything these families cannot represent (organic shapes, curved or rolled parts, bends other than 90 degrees, assemblies with moving parts).`;

export type CadPromptHints = {
    /** Catalog sheet thicknesses per material, e.g. "Aluminum 5052-H32: 1.02, 1.6, 2.03 mm". */
    catalogThicknesses?: string[];
};

export function buildCadPrompt(view: BuildGraphView, hints: CadPromptHints = {}): string {
    const relevant = view.nodes.filter((n) => ['BUILD', 'REQUIREMENT', 'UNKNOWN', 'PART', 'ASSEMBLY', 'MATERIAL', 'PROCESS', 'FINISH'].includes(n.type));
    const lines = relevant.map((n) => `- [${n.key}] ${n.type} (source: ${n.source}) ${n.label} ${JSON.stringify(n.data)}`);
    const catalog = hints.catalogThicknesses?.length ? `\nCatalog sheet thicknesses:\n${hints.catalogThicknesses.map((t) => `- ${t}`).join('\n')}` : '';
    return `Build ${view.build.displayId} "${view.build.name}", design version ${view.version.version}.\nNodes:\n${lines.join('\n')}${catalog}`;
}

/** Numbers (in mm) the buyer actually supplied: user-sourced or buyer-stated requirements and answered unknowns. */
export function buyerNumbers(nodes: BgNode[]): Map<string, number[]> {
    const out = new Map<string, number[]>();
    for (const n of nodes) {
        const answered = n.type === 'UNKNOWN' && n.data.status === 'answered';
        // Make AI records what the buyer actually stated as `requirementSource: 'user'` on its REQUIREMENT nodes.
        const stated = n.source === 'user' || (n.type === 'REQUIREMENT' && n.data.requirementSource === 'user');
        if (!(stated || answered)) continue;
        const text = answered ? String(n.data.value ?? n.data.answer ?? '') : typeof n.data.text === 'string' ? n.data.text : n.label;
        const nums = extractMm(text);
        if (nums.length) out.set(n.key, nums);
    }
    return out;
}

/** Pulls lengths out of free text, converting inches to mm. "8 x 6 in" -> [203.2, 152.4]. */
export function extractMm(text: string): number[] {
    const out: number[] = [];
    const re = /(\d+(?:\.\d+)?)(?:\s*(?:x|×|by)\s*(\d+(?:\.\d+)?))?(?:\s*(?:x|×|by)\s*(\d+(?:\.\d+)?))?\s*(mm|millimet(?:er|re)s?|cm|in(?:ch(?:es)?)?|"|')?/gi;
    for (const m of text.matchAll(re)) {
        const unit = (m[4] ?? 'mm').toLowerCase();
        const factor = unit === 'cm' ? 10 : unit.startsWith('in') || unit === '"' ? 25.4 : unit === "'" ? 304.8 : 1;
        for (const g of [m[1], m[2], m[3]]) if (g !== undefined) out.push(Math.round(Number(g) * factor * 1000) / 1000);
    }
    return out;
}

/**
 * A proposed length "traces" to a buyer number only when it is within 0.5 mm of it. That
 * absorbs rounding of converted units (8 in = 203.2 mm -> 203) and nothing more: no relative
 * tolerance, so a 1000 mm part cannot drift by 5 mm and still count as buyer-supplied.
 */
export const TRACE_TOLERANCE_MM = 0.5;
const near = (a: number, b: number) => Math.abs(a - b) <= TRACE_TOLERANCE_MM;

/** Product-defining lengths per family (each must trace to a buyer number). */
export const REQUIRED_PARAMS: Record<Exclude<CadProposal['family'], 'not_supported'>, CriticalParam[]> = {
    sheet_panel: ['width_mm', 'height_mm'],
    slotted_plate: ['width_mm', 'height_mm'],
    l_bracket: ['leg_a_mm', 'leg_b_mm', 'width_mm'],
    u_channel: ['flange_a_mm', 'base_mm', 'flange_b_mm', 'length_mm'],
    multi_bend_bracket: ['width_mm'],
    enclosure: ['inner_x_mm', 'inner_y_mm', 'inner_z_mm'],
    sheet_enclosure: ['inner_x_mm', 'inner_y_mm', 'inner_z_mm'],
};

const human = (param: string) => param.replace(/_mm$/, '').replace(/_/g, ' ');

/** Applies the guards to a model proposal. Pure: unit-tested without a model. */
export function guardProposal(p: CadProposal, view: BuildGraphView): CadAgentResult {
    if (p.family === 'not_supported') return { status: 'not_supported', reason: p.rationale || 'This product needs a CAD family DiscoverMake does not generate yet.' };
    const supplied = buyerNumbers(view.nodes);
    const allSupplied = [...supplied.values()].flat();
    const traces = (v: number) => allSupplied.some((n) => near(v, n));
    const questions = [...p.missing_inputs];
    const dropped: string[] = [];

    const checkLength = (param: string, value: number | undefined) => {
        if (value === undefined) {
            if (!questions.some((q) => q.toLowerCase().includes(human(param)))) questions.push(`What ${human(param)} (in mm) do you need?`);
            return;
        }
        const claimed = p.dimension_sources.find((s) => s.param === param);
        const fromClaimed = claimed ? (supplied.get(claimed.node_key) ?? []).some((n) => near(value, n)) : false;
        if (!fromClaimed && !traces(value)) questions.push(`Please confirm the ${human(param)}: we will not guess it (Make AI suggested ${value} mm).`);
    };
    for (const param of REQUIRED_PARAMS[p.family]) checkLength(param, p[param]);
    if (p.family === 'multi_bend_bracket') {
        const flanges = p.flanges_mm ?? [];
        if (flanges.length < 2) questions.push('What is the outside length of each flange (in mm), in order along the profile?');
        flanges.forEach((v, i) => checkLength(`flange ${i + 1}`, v));
        if (flanges.length >= 2 && (p.bend_angles_deg ?? []).length !== flanges.length - 1) questions.push('Which way does each bend go (up or down)?');
    }
    if (questions.length) return { status: 'needs_input', questions: [...new Set(questions)].slice(0, 10), rationale: p.rationale };

    /** Keeps a feature only when every listed number traces to the buyer. */
    const keep = <T extends Record<string, unknown>>(items: T[] | undefined, label: string, fields: (keyof T)[], describe: (f: T) => string): T[] =>
        (items ?? []).filter((f) => {
            const ok = fields.every((k) => typeof f[k] !== 'number' || traces(f[k] as number));
            if (!ok) dropped.push(`${label} ${describe(f)}: not given by the buyer`);
            return ok;
        });
    const at = (h: { x_mm: number; y_mm: number }) => `at (${h.x_mm}, ${h.y_mm})`;
    const holeFields = ['x_mm', 'y_mm', 'diameter_mm'] as const;
    const keepHoles = (holes: z.infer<typeof ProposalHole>[] | undefined, label: string) => keep(holes, label, [...holeFields], (h) => `${at(h)} d=${h.diameter_mm}`);
    const flangeHoles = () => keep(p.flange_holes, 'flange hole', [...holeFields], (h) => `on flange ${h.flange} ${at(h)} d=${h.diameter_mm}`);

    let candidate: Record<string, unknown>;
    switch (p.family) {
        case 'sheet_panel':
            candidate = { family: p.family, width_mm: p.width_mm, height_mm: p.height_mm, thickness_mm: p.thickness_mm, corner_radius_mm: p.corner_radius_mm ?? 0, holes: keepHoles(p.holes, 'hole') };
            break;
        case 'slotted_plate':
            candidate = {
                family: p.family,
                width_mm: p.width_mm,
                height_mm: p.height_mm,
                thickness_mm: p.thickness_mm,
                corner_radius_mm: p.corner_radius_mm ?? 0,
                holes: keepHoles(p.holes, 'hole'),
                // Angles are orientation choices, not lengths: they do not need to trace.
                slots: keep(p.slots, 'slot', ['x_mm', 'y_mm', 'length_mm', 'width_mm'], (s) => `${at(s)} ${s.length_mm} x ${s.width_mm}`).map((s) => ({ ...s, angle_deg: s.angle_deg ?? 0 })),
                countersinks: keep(p.countersinks, 'countersink', ['x_mm', 'y_mm', 'through_diameter_mm', 'head_diameter_mm'], (c) => `${at(c)} d=${c.through_diameter_mm}/${c.head_diameter_mm}`).map((c) => ({
                    ...c,
                    angle_deg: c.angle_deg ?? 90,
                })),
            };
            break;
        case 'l_bracket':
            candidate = {
                family: p.family,
                leg_a_mm: p.leg_a_mm,
                leg_b_mm: p.leg_b_mm,
                width_mm: p.width_mm,
                thickness_mm: p.thickness_mm,
                inside_bend_radius_mm: p.inside_bend_radius_mm ?? p.thickness_mm,
                holes_a: keepHoles(p.holes_a, 'leg A hole'),
                holes_b: keepHoles(p.holes_b, 'leg B hole'),
            };
            break;
        case 'u_channel':
            candidate = {
                family: p.family,
                flange_a_mm: p.flange_a_mm,
                base_mm: p.base_mm,
                flange_b_mm: p.flange_b_mm,
                length_mm: p.length_mm,
                thickness_mm: p.thickness_mm,
                inside_bend_radius_mm: p.inside_bend_radius_mm ?? p.thickness_mm,
                holes: flangeHoles(),
            };
            break;
        case 'multi_bend_bracket':
            candidate = {
                family: p.family,
                flanges_mm: p.flanges_mm,
                bend_angles_deg: p.bend_angles_deg,
                width_mm: p.width_mm,
                thickness_mm: p.thickness_mm,
                inside_bend_radius_mm: p.inside_bend_radius_mm ?? p.thickness_mm,
                holes: flangeHoles(),
            };
            break;
        case 'enclosure':
            candidate = {
                family: p.family,
                inner_x_mm: p.inner_x_mm,
                inner_y_mm: p.inner_y_mm,
                inner_z_mm: p.inner_z_mm,
                wall_mm: p.wall_mm ?? 2.5,
                corner_radius_mm: p.corner_radius_mm ?? 0,
                lid: p.lid ?? true,
                vent_slots: p.vent_slots ?? 0,
            };
            break;
        case 'sheet_enclosure': {
            let gland: number | null = p.gland_diameter_mm ?? null;
            if (gland !== null && !traces(gland)) {
                dropped.push(`cable gland hole d=${gland}: size not given by the buyer`);
                gland = null;
            }
            candidate = {
                family: p.family,
                inner_x_mm: p.inner_x_mm,
                inner_y_mm: p.inner_y_mm,
                inner_z_mm: p.inner_z_mm,
                thickness_mm: p.thickness_mm,
                inside_bend_radius_mm: p.inside_bend_radius_mm ?? p.thickness_mm,
                ...(p.end_flange_mm !== undefined ? { end_flange_mm: p.end_flange_mm } : {}),
                ...(p.lid_lip_mm !== undefined ? { lid_lip_mm: p.lid_lip_mm } : {}),
                floor_holes: keepHoles(p.floor_holes, 'floor hole'),
                gland_diameter_mm: gland,
            };
            break;
        }
    }
    const parsed = CadSpec.safeParse(candidate);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return { status: 'needs_input', questions: [`Make AI's ${String(issue?.path.join('.') || 'geometry')} is outside what we can make (${issue?.message}). Please adjust the size.`], rationale: p.rationale };
    }
    return { status: 'ready', spec: parsed.data, rationale: p.rationale, dropped };
}

export type ProposeCadOptions = { model?: LanguageModel; abortSignal?: AbortSignal; hints?: CadPromptHints };

/** Raw structured proposal from the model (null when it produced none). Exposed for the CAD evals. */
export async function requestCadProposal(view: BuildGraphView, opts: ProposeCadOptions = {}): Promise<CadProposal | null> {
    const model = opts.model ?? getMakeAiModel();
    let raw: unknown;
    try {
        const result = await generateText({
            model,
            instructions: CAD_AGENT_INSTRUCTIONS,
            prompt: buildCadPrompt(view, opts.hints),
            output: Output.object({ schema: CadProposal, name: 'CadProposal', description: 'A parametric CAD family choice with buyer-sourced dimensions.' }),
            temperature: 0.1,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            maxRetries: 1,
            timeout: TIMEOUT_MS,
            abortSignal: opts.abortSignal,
        });
        raw = result.output;
    } catch (err) {
        if (NoObjectGeneratedError.isInstance(err) || NoOutputGeneratedError.isInstance(err)) return null;
        throw err;
    }
    const checked = CadProposal.safeParse(raw);
    return checked.success ? checked.data : null;
}

export async function proposeCadSpec(view: BuildGraphView, opts: ProposeCadOptions = {}): Promise<CadAgentResult> {
    const proposal = await requestCadProposal(view, opts);
    if (!proposal) return { status: 'not_supported', reason: 'Make AI could not produce a CAD plan for this build.' };
    return guardProposal(proposal, view);
}
