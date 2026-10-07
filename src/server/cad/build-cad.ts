/**
 * Build-level CAD: approved Build Graph version -> CadSpec -> CAD worker -> new version.
 *
 *   generateBuildCad(buildId, { spec? })
 *     1. needs the build's latest version to be APPROVED with no open questions;
 *     2. uses the buyer's explicit spec, or asks the CAD agent (which refuses untraceable
 *        dimensions: those become NEEDS_INPUT questions in a new version);
 *     3. runs the CAD worker, stores the artifacts, attaches a quotable flat-pattern part
 *        (sheet families) to the same build;
 *     4. writes a new DRAFT design version whose PART node carries the CAD record
 *        (`data.cad`: family, spec, metrics, artifact keys + sha256, part id).
 *   getBuildCad(buildId) reads the latest CAD record back with fresh signed URLs.
 */
import 'server-only';
import { eq } from 'drizzle-orm';
import type { BgEdgeInput, BgNode, BgNodeInput } from '@/contracts/build-graph';
import { CadSpec, SHEET_FAMILIES, type BuildCadArtifactView, type BuildCadGenerated, type BuildCadResponse, type CadSpecInput } from '@/contracts/cad';
import type { Actor } from '@/contracts';
import {
    getGraph,
    guestActor,
    isOpenUnknown,
    latestApprovedVersionRow,
    latestVersionRow,
    loadVersionGraph,
    MAIN_PART_KEY,
    ROOT_NODE_KEY,
    setGraphBuildStatus,
    slugify,
    toEdgeInput,
    toNodeInput,
    writeVersion,
} from '@/server/build-graph';
import { getDb, withTx } from '@/server/db';
import { parts } from '@/server/db/schema';
import { ApiError } from '@/server/http';
import { getStorage } from '@/server/storage';
import { proposeCadSpec } from './agent';
import { generateCad } from './client';
import { attachCadResult, type StoredCadArtifact } from './pipeline';
import type { LanguageModel } from 'ai';

export const CAD_URL_TTL_SECONDS = 15 * 60;

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
        const proposal = await proposeCadSpec(view, { model: opts.model });
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
    const { artifacts, part } = await attachCadResult({ buildId, version: nextVersion, result, actor });
    const record: CadRecord = {
        family: result.family,
        spec,
        metrics: result.metrics,
        processes: result.processes,
        warnings: result.warnings,
        dropped,
        artifacts,
        partId: part?.id ?? null,
        specSource,
        generatedAt: new Date().toISOString(),
    };

    const graph = await loadVersionGraph(db, buildId, approved.version);
    const nodes = graph.nodes.map(toNodeInput);
    const edges = graph.edges.map(toEdgeInput);
    const existing = nodes.find((n) => n.key === MAIN_PART_KEY);
    const cadData = { cad: record, partId: record.partId, dimensionsStatus: 'cad' };
    if (existing) {
        existing.data = { ...existing.data, ...cadData };
        existing.source = 'system';
        existing.provenance = `cad-worker:${result.worker_version ?? 'unknown'}`;
    } else {
        nodes.push({ key: MAIN_PART_KEY, type: 'PART', label: view.build.name.slice(0, 200), data: cadData, confidence: null, source: 'system', provenance: `cad-worker:${result.worker_version ?? 'unknown'}` });
        edges.push({ type: 'CONTAINS', fromKey: ROOT_NODE_KEY, toKey: MAIN_PART_KEY, data: {} });
    }

    const written = await withTx(async (tx) =>
        writeVersion(tx, buildId, { parentVersion: latest.version, summary: `Generated CAD (${result.family.replace('_', ' ')})`, nodes, edges, actor }),
    );
    if (written.version !== nextVersion) {
        // A concurrent write took the version number; the part still points at the stored artifacts.
        if (part) await db.update(parts).set({ designVersion: written.version }).where(eq(parts.id, part.id));
    }

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
        quotable: Boolean(part && part.status === 'READY' && SHEET_FAMILIES.includes(record.family)),
    };
}

/** The most recent CAD record on the build (latest version that has one), with fresh URLs. */
export async function getBuildCad(buildId: string): Promise<BuildCadGenerated | null> {
    const db = getDb();
    const view = await getGraph(buildId);
    if (!view) throw new ApiError('NOT_FOUND', 'Build not found');
    const node = view.nodes.find((n) => n.key === MAIN_PART_KEY && n.data.cad);
    if (!node) return null;
    const record = node.data.cad as CadRecord;
    let partStatus: string | null = null;
    if (record.partId) {
        const [row] = await db.select({ status: parts.status }).from(parts).where(eq(parts.id, record.partId));
        partStatus = row?.status ?? null;
    }
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
        partStatus,
        quotable: partStatus === 'READY' && SHEET_FAMILIES.includes(record.family),
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
