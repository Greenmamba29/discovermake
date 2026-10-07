/**
 * CAD agent (workflow 01, "CAD / geometry"): approved Build Graph version -> CadSpec.
 *
 * The model only picks a parametric family and fills its parameters (structured
 * output). It never writes CadQuery. Deterministic guards then refuse to trust it:
 *   - every critical length must trace to a number the BUYER supplied (a user-sourced
 *     REQUIREMENT, or an answered UNKNOWN). An untraceable length becomes a
 *     NEEDS_INPUT question rather than an invented dimension (workflow 01, rule 1);
 *   - holes are kept only when their positions are buyer-supplied numbers too;
 *   - the result must parse as a strict `CadSpec` (the worker validates again).
 * Process choices (thickness, bend radius, wall, corner radius) may come from the
 * model or the MATERIAL node: they are manufacturing decisions, not buyer
 * dimensions, and DFM checks them later.
 */
import 'server-only';
import { generateText, NoObjectGeneratedError, NoOutputGeneratedError, Output, type LanguageModel } from 'ai';
import { z } from 'zod';
import type { BgNode, BuildGraphView } from '@/contracts/build-graph';
import { CadSpec } from '@/contracts/cad';
import { getMakeAiModel } from '@/server/make-ai/model';

const MAX_OUTPUT_TOKENS = 2048;
const TIMEOUT_MS = 30_000;

/** Lengths that define the product and must come from the buyer. */
export const CRITICAL_PARAMS = ['width_mm', 'height_mm', 'leg_a_mm', 'leg_b_mm', 'inner_x_mm', 'inner_y_mm', 'inner_z_mm'] as const;
/** Manufacturing choices the agent may make (DFM validates them). */
export const PROCESS_PARAMS = ['thickness_mm', 'inside_bend_radius_mm', 'k_factor', 'corner_radius_mm', 'wall_mm', 'vent_slots', 'lid'] as const;

const ProposalHole = z.object({ x_mm: z.number(), y_mm: z.number(), diameter_mm: z.number() });

/** Loose schema handed to the model (flat, provider-friendly); tightened by the guards below. */
export const CadProposal = z.object({
    family: z.enum(['sheet_panel', 'l_bracket', 'enclosure', 'not_supported']),
    width_mm: z.number().optional(),
    height_mm: z.number().optional(),
    leg_a_mm: z.number().optional(),
    leg_b_mm: z.number().optional(),
    inner_x_mm: z.number().optional(),
    inner_y_mm: z.number().optional(),
    inner_z_mm: z.number().optional(),
    thickness_mm: z.number().optional(),
    inside_bend_radius_mm: z.number().optional(),
    corner_radius_mm: z.number().optional(),
    wall_mm: z.number().optional(),
    vent_slots: z.number().int().optional(),
    lid: z.boolean().optional(),
    holes: z.array(ProposalHole).max(50).optional(),
    holes_a: z.array(ProposalHole).max(50).optional(),
    holes_b: z.array(ProposalHole).max(50).optional(),
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
- l_bracket: a sheet-metal bracket with one 90 degree bend (outside leg lengths leg_a/leg_b, width, thickness, inside bend radius; holes per leg measured from that leg's free edge).
- enclosure: an open box with an optional lid for 3D printing or CNC (inner cavity x/y/z, wall, corner radius, vent slots).
Rules:
- Use ONLY dimensions the buyer stated (nodes with source "user"). For every product-defining length, list in dimension_sources the node key you took it from.
- If a product-defining length is missing, leave it out and add a short question to missing_inputs. Never estimate or invent a dimension.
- You may choose thickness, bend radius, wall and corner radius from the material and process; keep them conventional (sheet 0.8-6 mm, bend radius >= thickness, wall 2-3 mm for printing).
- Only include holes whose positions the buyer gave.
- Answer "not_supported" for anything these families cannot represent (organic shapes, multi-bend parts, assemblies with moving parts).`;

export function buildCadPrompt(view: BuildGraphView): string {
    const relevant = view.nodes.filter((n) => ['BUILD', 'REQUIREMENT', 'UNKNOWN', 'PART', 'ASSEMBLY', 'MATERIAL', 'PROCESS', 'FINISH'].includes(n.type));
    const lines = relevant.map((n) => `- [${n.key}] ${n.type} (source: ${n.source}) ${n.label} ${JSON.stringify(n.data)}`);
    return `Build ${view.build.displayId} "${view.build.name}", design version ${view.version.version}.\nNodes:\n${lines.join('\n')}`;
}

/** Numbers (in mm) the buyer actually supplied: user-sourced requirements and answered unknowns. */
export function buyerNumbers(nodes: BgNode[]): Map<string, number[]> {
    const out = new Map<string, number[]>();
    for (const n of nodes) {
        const answered = n.type === 'UNKNOWN' && n.data.status === 'answered';
        if (!(n.source === 'user' || answered)) continue;
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

const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.5, b * 0.005);

/** Applies the guards to a model proposal. Pure: unit-tested without a model. */
export function guardProposal(p: CadProposal, view: BuildGraphView): CadAgentResult {
    if (p.family === 'not_supported') return { status: 'not_supported', reason: p.rationale || 'This product needs a CAD family DiscoverMake does not generate yet.' };
    const supplied = buyerNumbers(view.nodes);
    const allSupplied = [...supplied.values()].flat();
    const questions = [...p.missing_inputs];
    const dropped: string[] = [];

    const required: Record<typeof p.family, (typeof CRITICAL_PARAMS)[number][]> = {
        sheet_panel: ['width_mm', 'height_mm'],
        l_bracket: ['leg_a_mm', 'leg_b_mm', 'width_mm'],
        enclosure: ['inner_x_mm', 'inner_y_mm', 'inner_z_mm'],
    };
    for (const param of required[p.family]) {
        const value = p[param];
        if (value === undefined) {
            if (!questions.some((q) => q.toLowerCase().includes(param.replace('_mm', '').replace('_', ' ')))) questions.push(`What ${param.replace(/_mm$/, '').replace(/_/g, ' ')} (in mm) do you need?`);
            continue;
        }
        const claimed = p.dimension_sources.find((s) => s.param === param);
        const fromClaimed = claimed ? (supplied.get(claimed.node_key) ?? []).some((n) => near(value, n)) : false;
        if (!fromClaimed && !allSupplied.some((n) => near(value, n))) {
            questions.push(`Please confirm the ${param.replace(/_mm$/, '').replace(/_/g, ' ')}: we will not guess it (Make AI suggested ${value} mm).`);
        }
    }
    if (questions.length) return { status: 'needs_input', questions: [...new Set(questions)].slice(0, 10), rationale: p.rationale };

    const keepHoles = (holes: z.infer<typeof ProposalHole>[] | undefined, label: string) =>
        (holes ?? []).filter((h) => {
            const ok = [h.x_mm, h.y_mm, h.diameter_mm].every((v) => allSupplied.some((n) => near(v, n)));
            if (!ok) dropped.push(`${label} at (${h.x_mm}, ${h.y_mm}) d=${h.diameter_mm}: position not given by the buyer`);
            return ok;
        });

    const candidate =
        p.family === 'sheet_panel'
            ? { family: p.family, width_mm: p.width_mm, height_mm: p.height_mm, thickness_mm: p.thickness_mm, corner_radius_mm: p.corner_radius_mm ?? 0, holes: keepHoles(p.holes, 'hole') }
            : p.family === 'l_bracket'
              ? {
                    family: p.family,
                    leg_a_mm: p.leg_a_mm,
                    leg_b_mm: p.leg_b_mm,
                    width_mm: p.width_mm,
                    thickness_mm: p.thickness_mm,
                    inside_bend_radius_mm: p.inside_bend_radius_mm ?? p.thickness_mm,
                    holes_a: keepHoles(p.holes_a, 'leg A hole'),
                    holes_b: keepHoles(p.holes_b, 'leg B hole'),
                }
              : {
                    family: p.family,
                    inner_x_mm: p.inner_x_mm,
                    inner_y_mm: p.inner_y_mm,
                    inner_z_mm: p.inner_z_mm,
                    wall_mm: p.wall_mm ?? 2.5,
                    corner_radius_mm: p.corner_radius_mm ?? 0,
                    lid: p.lid ?? true,
                    vent_slots: p.vent_slots ?? 0,
                };
    const parsed = CadSpec.safeParse(candidate);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return { status: 'needs_input', questions: [`Make AI's ${String(issue?.path.join('.') || 'geometry')} is outside what we can make (${issue?.message}). Please adjust the size.`], rationale: p.rationale };
    }
    return { status: 'ready', spec: parsed.data, rationale: p.rationale, dropped };
}

export async function proposeCadSpec(view: BuildGraphView, opts: { model?: LanguageModel; abortSignal?: AbortSignal } = {}): Promise<CadAgentResult> {
    const model = opts.model ?? getMakeAiModel();
    let raw: unknown;
    try {
        const result = await generateText({
            model,
            instructions: CAD_AGENT_INSTRUCTIONS,
            prompt: buildCadPrompt(view),
            output: Output.object({ schema: CadProposal, name: 'CadProposal', description: 'A parametric CAD family choice with buyer-sourced dimensions.' }),
            temperature: 0.1,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            maxRetries: 1,
            timeout: TIMEOUT_MS,
            abortSignal: opts.abortSignal,
        });
        raw = result.output;
    } catch (err) {
        if (NoObjectGeneratedError.isInstance(err) || NoOutputGeneratedError.isInstance(err)) {
            return { status: 'not_supported', reason: 'Make AI could not produce a CAD plan for this build.' };
        }
        throw err;
    }
    const checked = CadProposal.safeParse(raw);
    if (!checked.success) return { status: 'not_supported', reason: 'Make AI could not produce a CAD plan for this build.' };
    return guardProposal(checked.data, view);
}
