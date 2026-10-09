/**
 * CAD agent evals (backlog 100-4): score proposals on "compiles + passes DFM + traceable",
 * never on text quality (workflow 01, "Model choice").
 *
 * One case = a buyer request as it reaches the CAD agent (see ./cases.json). For each case and
 * each provider:
 *   proposal  offline: the recorded structured output; live: `requestCadProposal` on the model
 *   guard     `guardProposal` (buyer numbers within 0.5 mm; untraced features dropped)
 *   compile   the CAD worker: the live one when configured, else its recorded output for the
 *             expected spec (./golden, written by `python -m cad_worker.golden`)
 *   DFM       every flat pattern through the R1 analyzer + quote engine (BINDING, no blocking
 *             violation) in the case's catalog material; printed parts are "n/a"
 *   trace     every product-defining length and every kept feature number traces to the buyer
 * A case passes when the outcome matches `expected` (status, family, dropped count) and, for a
 * generated spec, it compiles, passes DFM and is traceable.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { LanguageModel } from 'ai';
import type { BgNode, BuildGraphView } from '@/contracts/build-graph';
import { CadSpec, SHEET_FAMILIES, type CadFamily } from '@/contracts/cad';
import { buyerNumbers, CadProposal, guardProposal, REQUIRED_PARAMS, requestCadProposal, TRACE_TOLERANCE_MM, type CadAgentResult } from '@/server/cad/agent';
import { generateCad, type CadResult } from '@/server/cad/client';
import { estimateCadParts } from '@/server/cad/estimate';
import type { CadPanelPart } from '@/server/cad/pipeline';
import { analyzePart, createPartUpload, uploadPartBytes } from '@/server/quote';

export const EVALS_DIR = path.dirname(new URL(import.meta.url).pathname);

export type EvalCase = {
    id: string;
    prompt: string;
    requirements: string[];
    answers?: string[];
    material: string | null;
    buyer_numbers: number[];
    expected: { status: CadAgentResult['status']; family?: CadFamily; dropped?: number };
    expected_spec?: Record<string, unknown>;
    recorded: unknown;
};

export type Provider = { id: string; label: string; model: LanguageModel | null };

export type CaseScore = {
    caseId: string;
    provider: string;
    status: CadAgentResult['status'] | 'no_proposal' | 'error';
    family: string | null;
    outcomeOk: boolean;
    compiles: boolean | null;
    dfm: boolean | 'n/a' | null;
    traceable: boolean | null;
    dropped: number;
    makeabilityScore: number | null;
    worker: 'live' | 'golden' | 'none' | null;
    pass: boolean;
    notes: string[];
    durationMs: number;
};

export type Scorecard = {
    version: 'dm-cad-evals/1';
    mode: 'offline' | 'live';
    startedAt: string;
    finishedAt: string;
    providers: { id: string; label: string; cases: number; passed: number; passRate: number; compiles: number; dfm: number; traceable: number; outcome: number }[];
    skippedProviders: { id: string; reason: string }[];
    results: CaseScore[];
};

export function loadCases(file = path.join(EVALS_DIR, 'cases.json')): EvalCase[] {
    return (JSON.parse(readFileSync(file, 'utf8')) as { cases: EvalCase[] }).cases;
}

/** The approved Build Graph version the CAD agent would see for this case. */
export function caseView(c: EvalCase): BuildGraphView {
    const node = (key: string, type: BgNode['type'], label: string, source: BgNode['source'], data: Record<string, unknown>): BgNode => ({
        id: `bgn_${key.replace(/[^a-z0-9]/gi, '')}`,
        buildId: 'bld_eval',
        designVersion: 2,
        key,
        type,
        label: label.slice(0, 200),
        data,
        confidence: null,
        source,
        provenance: `eval:${c.id}`,
    });
    const nodes: BgNode[] = [node('build:root', 'BUILD', c.prompt, 'make_ai', { summary: c.prompt })];
    c.requirements.forEach((text, i) => nodes.push(node(`req:U${i + 1}`, 'REQUIREMENT', text, 'user', { text, requirementSource: 'user' })));
    (c.answers ?? []).forEach((answer, i) => nodes.push(node(`unk:A${i + 1}`, 'UNKNOWN', 'Buyer answer', 'make_ai', { status: 'answered', answer, question: 'What size do you need?' })));
    if (c.material) nodes.push(node(`mat:${c.material}`, 'MATERIAL', c.material, 'make_ai', { role: 'recommended', catalogSlug: c.material, inCatalog: true, needsSourcing: false }));
    return {
        build: { id: 'bld_eval', displayId: 'DM-EVAL1', name: c.id, origin: 'make_ai', trustState: 'ENGINEERING_REVIEW', currentVersion: 2, derivedFromBuildId: null },
        version: { id: 'dv_eval', buildId: 'bld_eval', version: 2, status: 'APPROVED', summary: 'eval', parentVersion: 1, createdBy: 'buyer', approvedBy: 'buyer', approvedAt: null, createdAt: '2026-10-09T00:00:00.000Z' },
        versions: [],
        nodes,
        edges: [],
    };
}

/** Spec equality ignoring key order and null-vs-missing optionals. */
export function normalizeSpec(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(normalizeSpec);
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(value).sort()) {
            const v = (value as Record<string, unknown>)[k];
            if (v !== null && v !== undefined) out[k] = normalizeSpec(v);
        }
        return out;
    }
    return value;
}
export const sameSpec = (a: unknown, b: unknown) => JSON.stringify(normalizeSpec(a)) === JSON.stringify(normalizeSpec(b));

/** Independent traceability check of a guarded spec (does not trust the guard). */
export function traceIssues(spec: CadSpec, view: BuildGraphView): string[] {
    const numbers = [...buyerNumbers(view.nodes).values()].flat();
    const traces = (v: number) => numbers.some((n) => Math.abs(n - v) <= TRACE_TOLERANCE_MM);
    const issues: string[] = [];
    const s = spec as Record<string, unknown>;
    for (const param of REQUIRED_PARAMS[spec.family]) if (typeof s[param] === 'number' && !traces(s[param] as number)) issues.push(`${param}=${s[param]}`);
    if (spec.family === 'multi_bend_bracket') spec.flanges_mm.forEach((v, i) => !traces(v) && issues.push(`flanges_mm[${i}]=${v}`));
    const featureLists: Record<string, string[]> = { holes: ['x_mm', 'y_mm', 'diameter_mm'], holes_a: ['x_mm', 'y_mm', 'diameter_mm'], holes_b: ['x_mm', 'y_mm', 'diameter_mm'], floor_holes: ['x_mm', 'y_mm', 'diameter_mm'], slots: ['x_mm', 'y_mm', 'length_mm', 'width_mm'], countersinks: ['x_mm', 'y_mm', 'through_diameter_mm', 'head_diameter_mm'] };
    for (const [list, fields] of Object.entries(featureLists)) {
        const items = s[list];
        if (!Array.isArray(items)) continue;
        items.forEach((f: Record<string, unknown>, i) => {
            for (const k of fields) if (typeof f[k] === 'number' && !traces(f[k] as number)) issues.push(`${list}[${i}].${k}=${f[k]}`);
        });
    }
    if (spec.family === 'sheet_enclosure' && spec.gland_diameter_mm != null && !traces(spec.gland_diameter_mm)) issues.push(`gland_diameter_mm=${spec.gland_diameter_mm}`);
    return issues;
}

// ---------------------------------------------------------------------------
// Worker: live when configured, else the recorded golden output for the expected spec
// ---------------------------------------------------------------------------

type GoldenFile = { family: string; metrics: CadResult['metrics']; processes: string[]; warnings: string[]; worker_version?: string; artifacts: { kind: string; filename: string; content_type: string; bytes: number; sha256: string; content_base64?: string }[] };

export type WorkerFn = (spec: CadSpec, c: EvalCase) => Promise<{ result: CadResult | null; source: 'live' | 'golden' | 'none'; note?: string }>;

export function goldenWorker(dir = path.join(EVALS_DIR, 'golden')): WorkerFn {
    return async (spec, c) => {
        if (!c.expected_spec || !sameSpec(CadSpec.parse(c.expected_spec), spec)) return { result: null, source: 'none', note: 'no recorded worker output for this spec (start the CAD worker for live compiles)' };
        let golden: GoldenFile;
        try {
            golden = JSON.parse(readFileSync(path.join(dir, `${c.id}.json`), 'utf8')) as GoldenFile;
        } catch {
            return { result: null, source: 'none', note: `missing golden ${c.id}.json (python -m cad_worker.golden)` };
        }
        const artifacts = golden.artifacts.map((a) => ({ ...a, kind: a.kind as CadResult['artifacts'][number]['kind'], data: new Uint8Array(a.content_base64 ? Buffer.from(a.content_base64, 'base64') : Buffer.alloc(0)) }));
        return { result: { family: golden.family as CadFamily, metrics: golden.metrics, processes: golden.processes, warnings: golden.warnings, worker_version: golden.worker_version, artifacts }, source: 'golden' };
    };
}

export function liveWorker(fetchImpl?: typeof fetch): WorkerFn {
    return async (spec, c) => ({ result: await generateCad(spec, { ref: `eval:${c.id}`, fetchImpl }), source: 'live' });
}

// ---------------------------------------------------------------------------
// DFM: every flat pattern through the R1 engine (needs a migrated + seeded database)
// ---------------------------------------------------------------------------

async function dfmCheck(spec: CadSpec, result: CadResult, view: BuildGraphView): Promise<{ ok: boolean; score: number | null; note?: string }> {
    const dxfs = result.artifacts.filter((a) => a.kind === 'DXF' && a.data.byteLength > 0);
    if (!dxfs.length) return { ok: false, score: null, note: 'no flat pattern to check' };
    const panels = (result.metrics.panels as { filename: string; quantity: number; label: string }[] | undefined) ?? [];
    const parts: CadPanelPart[] = [];
    for (const dxf of dxfs) {
        const created = await createPartUpload({ filename: dxf.filename, sizeBytes: dxf.data.byteLength, contentType: 'application/dxf' });
        await uploadPartBytes(created.partId, dxf.data);
        const part = await analyzePart(created.partId);
        if (part.status !== 'READY') return { ok: false, score: null, note: `${dxf.filename} did not analyze (${part.status})` };
        const panel = panels.find((p) => p.filename === dxf.filename);
        parts.push({ part, filename: dxf.filename, label: panel?.label ?? dxf.filename, quantity: panel?.quantity ?? 1 });
    }
    const estimate = await estimateCadParts({ spec, parts, nodes: view.nodes });
    if (!estimate) return { ok: false, score: null, note: 'no catalog material stocks this sheet thickness' };
    const primary = estimate.options.find((o) => o.recommended) ?? estimate.options[0]!;
    return { ok: primary.allBinding, score: primary.makeabilityScore, note: primary.allBinding ? undefined : `not BINDING in ${primary.materialName}` };
}

// ---------------------------------------------------------------------------

export async function scoreCase(c: EvalCase, provider: Provider, opts: { worker: WorkerFn; offline: boolean; withDfm: boolean; hints?: string[] }): Promise<CaseScore> {
    const started = Date.now();
    const view = caseView(c);
    const score: CaseScore = { caseId: c.id, provider: provider.id, status: 'error', family: null, outcomeOk: false, compiles: null, dfm: null, traceable: null, dropped: 0, makeabilityScore: null, worker: null, pass: false, notes: [], durationMs: 0 };
    try {
        let proposal: CadProposal | null;
        if (opts.offline || !provider.model) {
            const parsed = CadProposal.safeParse(c.recorded);
            proposal = parsed.success ? parsed.data : null;
            if (!parsed.success) score.notes.push(`recorded proposal does not match CadProposal: ${parsed.error.issues[0]?.message}`);
        } else {
            proposal = await requestCadProposal(view, { model: provider.model, hints: { catalogThicknesses: opts.hints } });
        }
        if (!proposal) {
            score.status = 'no_proposal';
            score.outcomeOk = c.expected.status === 'not_supported';
            score.pass = score.outcomeOk;
            return score;
        }
        const guarded = guardProposal(proposal, view);
        score.status = guarded.status;
        if (guarded.status !== 'ready') {
            score.outcomeOk = guarded.status === c.expected.status;
            if (guarded.status === 'needs_input') score.notes.push(...guarded.questions.slice(0, 3));
            score.pass = score.outcomeOk;
            return score;
        }
        score.family = guarded.spec.family;
        score.dropped = guarded.dropped.length;
        score.outcomeOk = c.expected.status === 'ready' && guarded.spec.family === c.expected.family && (c.expected.dropped === undefined || c.expected.dropped === guarded.dropped.length);
        const issues = traceIssues(guarded.spec, view);
        score.traceable = issues.length === 0;
        if (issues.length) score.notes.push(`untraced: ${issues.join(', ')}`);

        const compiled = await opts.worker(guarded.spec, c);
        score.worker = compiled.source;
        if (compiled.note) score.notes.push(compiled.note);
        score.compiles = Boolean(compiled.result && compiled.result.artifacts.some((a) => a.kind === 'STEP') && compiled.result.family === guarded.spec.family);
        if (compiled.result && score.compiles) {
            if (!SHEET_FAMILIES.includes(guarded.spec.family)) score.dfm = 'n/a';
            else if (opts.withDfm) {
                const dfm = await dfmCheck(guarded.spec, compiled.result, view);
                score.dfm = dfm.ok;
                score.makeabilityScore = dfm.score;
                if (dfm.note) score.notes.push(dfm.note);
            }
        }
        score.pass = score.outcomeOk && score.compiles === true && score.traceable === true && (score.dfm === true || score.dfm === 'n/a');
        return score;
    } catch (err) {
        score.status = 'error';
        score.notes.push(err instanceof Error ? err.message.slice(0, 300) : String(err));
        return score;
    } finally {
        score.durationMs = Date.now() - started;
    }
}

export async function runCadEvals(opts: { cases: EvalCase[]; providers: Provider[]; skipped?: Scorecard['skippedProviders']; worker: WorkerFn; offline: boolean; withDfm: boolean; hints?: string[] }): Promise<Scorecard> {
    const startedAt = new Date().toISOString();
    const results: CaseScore[] = [];
    for (const provider of opts.providers) {
        for (const c of opts.cases) results.push(await scoreCase(c, provider, opts));
    }
    const providers = opts.providers.map((p) => {
        const mine = results.filter((r) => r.provider === p.id);
        const generated = mine.filter((r) => r.status === 'ready');
        return {
            id: p.id,
            label: p.label,
            cases: mine.length,
            passed: mine.filter((r) => r.pass).length,
            passRate: mine.length ? Math.round((mine.filter((r) => r.pass).length / mine.length) * 1000) / 10 : 0,
            compiles: generated.filter((r) => r.compiles).length,
            dfm: generated.filter((r) => r.dfm === true || r.dfm === 'n/a').length,
            traceable: generated.filter((r) => r.traceable).length,
            outcome: mine.filter((r) => r.outcomeOk).length,
        };
    });
    return { version: 'dm-cad-evals/1', mode: opts.offline ? 'offline' : 'live', startedAt, finishedAt: new Date().toISOString(), providers, skippedProviders: opts.skipped ?? [], results };
}

const cell = (v: boolean | 'n/a' | null) => (v === null ? '–' : v === 'n/a' ? 'n/a' : v ? 'yes' : 'NO');

export function scorecardMarkdown(card: Scorecard): string {
    const lines = [
        `# CAD agent evals (${card.mode})`,
        '',
        `Run ${card.startedAt}. A case passes when its outcome is right and a generated spec compiles, passes R1 DFM (BINDING, no blocking violation) and every length traces to a buyer number (0.5 mm).`,
        '',
        '| Provider | Pass | Outcome | Compiles | DFM | Traceable |',
        '|---|---|---|---|---|---|',
        ...card.providers.map((p) => `| ${p.label} | ${p.passed}/${p.cases} (${p.passRate}%) | ${p.outcome}/${p.cases} | ${p.compiles} | ${p.dfm} | ${p.traceable} |`),
    ];
    if (card.skippedProviders.length) lines.push('', 'Skipped providers:', ...card.skippedProviders.map((s) => `- ${s.id}: ${s.reason}`));
    lines.push('', '| Case | Provider | Result | Family | Compiles | DFM | Traceable | Makeability | Worker | Notes |', '|---|---|---|---|---|---|---|---|---|---|');
    for (const r of card.results) {
        lines.push(`| ${r.caseId} | ${r.provider} | ${r.pass ? 'PASS' : 'FAIL'} (${r.status}) | ${r.family ?? '–'} | ${cell(r.compiles)} | ${cell(r.dfm)} | ${cell(r.traceable)} | ${r.makeabilityScore ?? '–'} | ${r.worker ?? '–'} | ${r.notes.join('; ').replace(/\|/g, '/').slice(0, 200)} |`);
    }
    return `${lines.join('\n')}\n`;
}
