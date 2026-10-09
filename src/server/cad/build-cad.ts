/**
 * Build-level CAD: approved Build Graph version -> CadSpec -> CAD worker -> new version.
 *
 *   generateBuildCad(buildId, { spec? })
 *     1. needs the build's latest version to be APPROVED with no open questions;
 *     2. uses the buyer's explicit spec, or asks the CAD agent (which refuses untraceable
 *        dimensions: those become NEEDS_INPUT questions in a new version);
 *     3. runs the CAD worker, stores every artifact (STEP, DXFs, GLB, BOM, drawing, manifest)
 *        and attaches one quotable flat-pattern part per panel (sheet families);
 *     4. prices every panel with the R1 quote engine (Makeability, price range, production
 *        time; see ./estimate.ts);
 *     5. writes a new DRAFT design version (workflow 01 artifacts 3-10 persisted on the graph):
 *          part:main      PART  `data.cad` (family, spec, metrics, artifact keys + sha256, parts),
 *                               `data.bom` (preliminary BOM), `data.processes`
 *          part:<item>    PART  one per BOM line (panels with their part ids; purchased hardware)
 *          proc:*         PROCESS  the CAD result's processes, matched to the catalog
 *          quote:preliminary QUOTE  the estimate (QUOTED_AS from part:main)
 *   getBuildCad(buildId) reads the latest CAD record back with fresh signed URLs.
 */
import 'server-only';
import { z } from 'zod';
import { eq, inArray } from 'drizzle-orm';
import type { BgEdgeInput, BgNode, BgNodeInput } from '@/contracts/build-graph';
import { CadSpec, SHEET_FAMILIES, type BuildCadArtifactView, type BuildCadEstimate, type BuildCadGenerated, type BuildCadPart, type BuildCadResponse, type CadSpecInput } from '@/contracts/cad';
import type { Actor } from '@/contracts';
import {
    clip,
    getGraph,
    guestActor,
    isOpenUnknown,
    latestApprovedVersionRow,
    latestVersionRow,
    loadBuildCatalog,
    loadVersionGraph,
    MAIN_PART_KEY,
    matchProcess,
    ROOT_NODE_KEY,
    setGraphBuildStatus,
    slugify,
    toEdgeInput,
    toNodeInput,
    writeVersion,
} from '@/server/build-graph';
import { getDb, withTx } from '@/server/db';
import { parts } from '@/server/db/schema';
import { emitEvent } from '@/server/events/outbox';
import { ApiError } from '@/server/http';
import { getStorage } from '@/server/storage';
import { proposeCadSpec } from './agent';
import { generateCad, type CadResult } from './client';
import { catalogThicknessHints, estimateCadParts } from './estimate';
import { attachCadResult, type CadPanelPart, type StoredCadArtifact } from './pipeline';
import type { LanguageModel } from 'ai';

export const CAD_URL_TTL_SECONDS = 15 * 60;
export const PRELIMINARY_QUOTE_KEY = 'quote:preliminary';

/** One line of the worker's bom.json. Validated: a malformed line is skipped, never trusted. */
const CadBomItemSchema = z.object({
    item: z.number().int().nonnegative(),
    name: z.string().min(1).max(200),
    kind: z.enum(['fabricated', 'purchased']),
    quantity: z.number().int().positive().max(100_000),
    process: z.string().max(80).optional(),
    thickness_mm: z.number().positive().max(100).optional(),
    flat_size_mm: z.tuple([z.number().nonnegative(), z.number().nonnegative()]).optional(),
    size_mm: z.array(z.number().nonnegative()).max(3).optional(),
    bend_count: z.number().int().nonnegative().max(100).optional(),
    file: z.string().max(200).nullable().optional(),
    spec: z.string().max(200).optional(),
    notes: z.string().max(500).optional(),
});
export type CadBomItem = z.infer<typeof CadBomItemSchema>;

/** What the PART node stores under `data.cad`. */
export type CadRecord = {
    family: BuildCadGenerated['family'];
    spec: CadSpec;
    metrics: BuildCadGenerated['metrics'];
    processes: string[];
    warnings: string[];
    dropped: string[];
    artifacts: StoredCadArtifact[];
    partId: string | null;
    parts?: { partId: string; filename: string; label: string; quantity: number }[];
    estimate?: BuildCadEstimate | null;
    specSource: 'buyer' | 'make_ai';
    generatedAt: string;
};

export type GenerateBuildCadOptions = {
    spec?: CadSpecInput;
    actor?: Actor;
    model?: LanguageModel;
    fetchImpl?: typeof fetch;
};

export async function generateBuildCad(buildId: string, opts: GenerateBuildCadOptions = {}): Promise<BuildCadResponse> {
    const db = getDb();
    const actor = opts.actor ?? guestActor(buildId);
    const [latest, approved] = await Promise.all([latestVersionRow(db, buildId), latestApprovedVersionRow(db, buildId)]);
    if (!latest) throw new ApiError('NOT_FOUND', 'This build has no design versions yet.');
    if (!approved || approved.version !== latest.version) {
        throw new ApiError('CONFLICT', 'Approve the latest design version before generating CAD.');
    }
    const view = await getGraph(buildId, approved.version);
    if (!view) throw new ApiError('NOT_FOUND', 'Build not found');
    if (view.nodes.some(isOpenUnknown)) throw new ApiError('CONFLICT', 'Answer the open questions before generating CAD.');

    let spec: CadSpec;
    let dropped: string[] = [];
    let specSource: CadRecord['specSource'] = 'buyer';
    if (opts.spec) {
        spec = CadSpec.parse(opts.spec);
    } else {
        const proposal = await proposeCadSpec(view, { model: opts.model, hints: { catalogThicknesses: await catalogThicknessHints() } });
        if (proposal.status === 'not_supported') return proposal;
        if (proposal.status === 'needs_input') {
            const version = await addQuestions(buildId, approved.version, view.nodes, proposal.questions, actor);
            return { status: 'needs_input', version, questions: proposal.questions };
        }
        spec = proposal.spec;
        dropped = proposal.dropped;
        specSource = 'make_ai';
    }

    const nextVersion = latest.version + 1;
    const result = await generateCad(spec, { ref: `${buildId}@v${nextVersion}`, fetchImpl: opts.fetchImpl });
    const { artifacts, part, parts: panelParts } = await attachCadResult({ buildId, version: nextVersion, result, actor });
    const estimate = SHEET_FAMILIES.includes(result.family) ? await estimateCadParts({ spec, parts: panelParts, nodes: view.nodes }) : null;
    const bom = readBom(result);
    const record: CadRecord = {
        family: result.family,
        spec,
        metrics: result.metrics,
        processes: result.processes,
        warnings: result.warnings,
        dropped,
        artifacts,
        partId: part?.id ?? null,
        parts: panelParts.map((p) => ({ partId: p.part.id, filename: p.filename, label: p.label, quantity: p.quantity })),
        estimate,
        specSource,
        generatedAt: new Date().toISOString(),
    };

    const graph = await loadVersionGraph(db, buildId, approved.version);
    const nodes = graph.nodes.map(toNodeInput);
    const edges = graph.edges.map(toEdgeInput);
    const provenance = `cad-worker:${result.worker_version ?? 'unknown'}`;
    const existing = nodes.find((n) => n.key === MAIN_PART_KEY);
    const cadData = { cad: record, partId: record.partId, dimensionsStatus: 'cad', bom, processes: result.processes };
    if (existing) {
        existing.data = { ...existing.data, ...cadData };
        existing.source = 'system';
        existing.provenance = provenance;
    } else {
        nodes.push({ key: MAIN_PART_KEY, type: 'PART', label: view.build.name.slice(0, 200), data: cadData, confidence: null, source: 'system', provenance });
        edges.push({ type: 'CONTAINS', fromKey: ROOT_NODE_KEY, toKey: MAIN_PART_KEY, data: {} });
    }
    await addDecomposition(nodes, edges, bom, panelParts, provenance);
    await addProcesses(nodes, edges, result.processes, view.nodes);
    if (estimate) addEstimateNode(nodes, edges, estimate);

    // writeVersion locks the build and requires `parentVersion` to still be the latest, so a
    // concurrent write makes this throw 409 (the buyer retries) instead of taking a different
    // number: the new version is always `nextVersion`, which the part and artifact keys use.
    const written = await withTx(async (tx) => {
        const v = await writeVersion(tx, buildId, { parentVersion: latest.version, summary: `Generated CAD (${result.family.replace(/_/g, ' ')})`, nodes, edges, actor });
        if (estimate) {
            await emitEvent(tx, { type: 'makeability.completed', payload: { buildId, version: v.version, makeabilityScore: estimate.makeabilityScore, partCount: panelParts.length }, actor, correlationId: buildId, buildId });
            await emitEvent(tx, {
                type: 'quote.preliminary',
                payload: {
                    buildId,
                    version: v.version,
                    quantity: estimate.quantity,
                    lowCents: estimate.priceRange.lowCents,
                    highCents: estimate.priceRange.highCents,
                    productionDaysMin: estimate.productionDays.min,
                    productionDaysMax: estimate.productionDays.max,
                    trustLevel: estimate.trustLevel,
                },
                actor,
                correlationId: buildId,
                buildId,
            });
        }
        return v;
    });

    const partViews: BuildCadPart[] = panelParts.map((p) => ({ partId: p.part.id, filename: p.filename, label: p.label, quantity: p.quantity, status: p.part.status }));
    return {
        status: 'generated',
        version: written.version,
        family: record.family,
        spec,
        metrics: record.metrics,
        processes: record.processes,
        warnings: record.warnings,
        dropped,
        artifacts: await signArtifacts(artifacts),
        partId: record.partId,
        partStatus: part?.status ?? null,
        parts: partViews,
        quotable: isQuotable(record.family, partViews),
        estimate,
    };
}

function isQuotable(family: CadRecord['family'], partViews: BuildCadPart[]): boolean {
    return partViews.length > 0 && partViews.every((p) => p.status === 'READY') && SHEET_FAMILIES.includes(family);
}

export function readBom(result: Pick<CadResult, 'artifacts'>): CadBomItem[] {
    const art = result.artifacts.find((a) => a.kind === 'BOM');
    if (!art) return [];
    let raw: unknown;
    try {
        raw = JSON.parse(Buffer.from(art.data).toString('utf8'));
    } catch {
        console.warn('[cad] bom.json is not JSON; decomposition skipped');
        return [];
    }
    const items = raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown }).items) ? ((raw as { items: unknown[] }).items as unknown[]) : [];
    const out: CadBomItem[] = [];
    for (const line of items.slice(0, 100)) {
        const parsed = CadBomItemSchema.safeParse(line);
        if (parsed.success) out.push(parsed.data);
        else console.warn('[cad] skipped a malformed BOM line', parsed.error.issues[0]?.message);
    }
    return out;
}

/** One PART node per BOM line under part:main (workflow 01 "part decomposition"). */
async function addDecomposition(nodes: BgNodeInput[], edges: BgEdgeInput[], bom: CadBomItem[], panelParts: CadPanelPart[], provenance: string): Promise<void> {
    const taken = new Set(nodes.map((n) => n.key));
    // A previous CAD version's decomposition is replaced, not merged.
    const stale = new Set(nodes.filter((n) => n.type === 'PART' && n.data.role === 'cad_item').map((n) => n.key));
    for (let i = nodes.length - 1; i >= 0; i--) if (stale.has(nodes[i]!.key)) nodes.splice(i, 1);
    for (let i = edges.length - 1; i >= 0; i--) if (stale.has(edges[i]!.fromKey) || stale.has(edges[i]!.toKey)) edges.splice(i, 1);
    for (const k of stale) taken.delete(k);
    for (const item of bom) {
        const base = `part:${item.kind === 'purchased' ? 'hw-' : ''}${slugify(item.name, 60) || `item-${item.item}`}`;
        let key = base;
        for (let n = 2; taken.has(key); n++) key = `${base}-${n}`;
        taken.add(key);
        const panel = item.file ? panelParts.find((p) => p.filename === item.file) : undefined;
        nodes.push({
            key,
            type: 'PART',
            label: clip(item.name, 200),
            data: {
                role: 'cad_item',
                bomItem: item.item,
                kind: item.kind,
                quantity: item.quantity,
                ...(item.process ? { process: item.process } : {}),
                ...(item.thickness_mm !== undefined ? { thicknessMm: item.thickness_mm } : {}),
                ...(item.flat_size_mm ? { flatSizeMm: item.flat_size_mm } : {}),
                ...(item.size_mm ? { sizeMm: item.size_mm } : {}),
                ...(item.spec ? { spec: item.spec } : {}),
                ...(item.file ? { file: item.file } : {}),
                ...(panel ? { partId: panel.part.id } : {}),
            },
            confidence: null,
            source: 'system',
            provenance,
        });
        edges.push({ type: 'CONTAINS', fromKey: MAIN_PART_KEY, toKey: key, data: { quantity: item.quantity } });
    }
}

/** The CAD result's processes, matched to the catalog (workflow 01 "process recommendation"). */
async function addProcesses(nodes: BgNodeInput[], edges: BgEdgeInput[], processes: string[], current: BgNode[]): Promise<void> {
    const catalog = await loadBuildCatalog(getDb());
    const materialSlugs = current.filter((n) => n.type === 'MATERIAL' && typeof n.data.catalogSlug === 'string').map((n) => n.data.catalogSlug as string);
    for (const name of processes) {
        // The worker says "laser cutting"; the catalog knows fiber vs CO2. Prefer the fiber laser for sheet metal.
        const spec = matchProcess(/laser cutting/i.test(name) ? `Fiber laser cutting` : name, catalog, materialSlugs);
        if (!nodes.some((n) => n.key === spec.key)) {
            nodes.push({ key: spec.key, type: spec.type, label: spec.label, data: { ...spec.data, recommendedBy: 'cad' }, confidence: null, source: 'system', provenance: 'cad-worker' });
        }
        const type = spec.type === 'FINISH' ? 'FINISHED_WITH' : 'REQUIRES_PROCESS';
        if (!edges.some((e) => e.type === type && e.fromKey === MAIN_PART_KEY && e.toKey === spec.key)) edges.push({ type, fromKey: MAIN_PART_KEY, toKey: spec.key, data: {} });
    }
}

function addEstimateNode(nodes: BgNodeInput[], edges: BgEdgeInput[], estimate: BuildCadEstimate): void {
    const label = `Preliminary quote · ${formatUsd(estimate.priceRange.lowCents)}–${formatUsd(estimate.priceRange.highCents)} · ${estimate.productionDays.min}–${estimate.productionDays.max} business days`;
    const node: BgNodeInput = { key: PRELIMINARY_QUOTE_KEY, type: 'QUOTE', label: clip(label, 200), data: { ...estimate }, confidence: null, source: 'quote_engine', provenance: 'r1-quote-engine' };
    const at = nodes.findIndex((n) => n.key === PRELIMINARY_QUOTE_KEY);
    if (at >= 0) nodes[at] = node;
    else nodes.push(node);
    if (!edges.some((e) => e.type === 'QUOTED_AS' && e.toKey === PRELIMINARY_QUOTE_KEY)) edges.push({ type: 'QUOTED_AS', fromKey: MAIN_PART_KEY, toKey: PRELIMINARY_QUOTE_KEY, data: {} });
}

const formatUsd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** The most recent CAD record on the build (latest version that has one), with fresh URLs. */
export async function getBuildCad(buildId: string): Promise<BuildCadGenerated | null> {
    const db = getDb();
    const view = await getGraph(buildId);
    if (!view) throw new ApiError('NOT_FOUND', 'Build not found');
    const node = view.nodes.find((n) => n.key === MAIN_PART_KEY && n.data.cad);
    if (!node) return null;
    const record = node.data.cad as CadRecord;
    const recordParts = record.parts ?? (record.partId ? [{ partId: record.partId, filename: record.artifacts.find((a) => a.kind === 'DXF')?.filename ?? 'flat.dxf', label: 'Flat pattern', quantity: 1 }] : []);
    const statusRows = recordParts.length ? await db.select({ id: parts.id, status: parts.status }).from(parts).where(inArray(parts.id, recordParts.map((p) => p.partId))) : [];
    const statusOf = (id: string) => statusRows.find((r) => r.id === id)?.status ?? null;
    const partViews: BuildCadPart[] = recordParts.map((p) => ({ ...p, status: statusOf(p.partId) }));
    return {
        status: 'generated',
        version: node.designVersion,
        family: record.family,
        spec: record.spec,
        metrics: record.metrics,
        processes: record.processes,
        warnings: record.warnings,
        dropped: record.dropped,
        artifacts: await signArtifacts(record.artifacts),
        partId: record.partId,
        partStatus: record.partId ? statusOf(record.partId) : null,
        parts: partViews,
        quotable: isQuotable(record.family, partViews),
        estimate: record.estimate ?? null,
    };
}

async function signArtifacts(artifacts: StoredCadArtifact[]): Promise<BuildCadArtifactView[]> {
    const storage = getStorage();
    return Promise.all(
        artifacts.map(async (a) => {
            const signed = await storage.getSignedUrl(a.key, { method: 'GET', expiresInSeconds: CAD_URL_TTL_SECONDS });
            return { kind: a.kind, filename: a.filename, bytes: a.bytes, sha256: a.sha256, url: signed.url, expiresAt: signed.expiresAt.toISOString() };
        }),
    );
}

/** Missing dimensions become open UNKNOWN nodes (BLOCKED_BY from the build) in a new version. */
async function addQuestions(buildId: string, approvedVersion: number, current: BgNode[], questions: string[], actor: Actor): Promise<number> {
    const db = getDb();
    const graph = await loadVersionGraph(db, buildId, approvedVersion);
    const nodes: BgNodeInput[] = graph.nodes.map(toNodeInput);
    const edges: BgEdgeInput[] = graph.edges.map(toEdgeInput);
    const taken = new Set(current.map((n) => n.key));
    for (const q of questions) {
        let key = `unk:cad-${slugify(q).slice(0, 40) || 'dimension'}`;
        for (let i = 2; taken.has(key); i++) key = `unk:cad-${slugify(q).slice(0, 36)}-${i}`;
        taken.add(key);
        nodes.push({
            key,
            type: 'UNKNOWN',
            label: q.slice(0, 200),
            data: { question: q, why: 'Needed to generate CAD without guessing a manufacturing-critical dimension.', suggested_default: null, status: 'open', topic: 'dimension' },
            confidence: null,
            source: 'make_ai',
            provenance: 'cad-agent',
        });
        edges.push({ type: 'BLOCKED_BY', fromKey: ROOT_NODE_KEY, toKey: key, data: {} });
    }
    return withTx(async (tx) => {
        const v = await writeVersion(tx, buildId, { parentVersion: approvedVersion, summary: `CAD needs ${questions.length} dimension${questions.length === 1 ? '' : 's'}`, nodes, edges, actor });
        await setGraphBuildStatus(tx, buildId, 'NEEDS_INPUT');
        return v.version;
    });
}
