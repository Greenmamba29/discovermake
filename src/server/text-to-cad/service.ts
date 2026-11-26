/**
 * Make AI "Make it in 3D" (text to CAD for adult buyers).
 *
 *   makeIt3dAvailability()                 flag + model key + CAD worker (never throws)
 *   createMakeIt3dBuild(prompt, owner)     a new build (version 1: the description) to make it in
 *   makeIn3D(buildId, prompt)              Make AI writes a model for TEXT_TO_CAD_ENGINE (a cadgen
 *                                          script, or a SolidCraft command script) -> worker gate + sandbox
 *                                          (at most 2 repairs on BUILD_FAILED) -> artifacts stored
 *                                          -> a NEW DRAFT design version with `part:main.data.textToCad`
 *   getMakeIt3dStatus(buildId)             the record with fresh signed URLs, approval, quote
 *   changeMakeIt3dParameters(id, c)        SolidCraft models: new sizes rebuilt from the stored script
 *                                          (no Make AI call) -> a NEW DRAFT design version
 *   quoteMakeIt3d(buildId, input)          once the buyer APPROVED that version: the STL becomes a
 *                                          READY printed part and the print engine (createPrintQuote)
 *                                          prices it from the worker's measured geometry -> BINDING
 *
 * Safety: the generated code is only text in this app; it runs nowhere but the worker's gate and
 * sandbox. Kids projects never come here (they use templates; nothing typed in Kids mode is sent
 * to Make AI): a build marked `audience: 'kids'` on its root node is refused.
 */
import 'server-only';
import { createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { LanguageModel } from 'ai';
import type { Actor } from '@/contracts';
import type { BgEdgeInput, BgNodeInput, BuildGraphView } from '@/contracts/build-graph';
import { MAKE_IT_3D_FAILURE_COPY, MakeIt3dParametersRequest, MakeIt3dPrompt, type CreateMakeIt3dBuildResponse, type MakeIt3dArtifactView, type MakeIt3dRecordView, type MakeIt3dResponse, type MakeIt3dStatus } from '@/contracts/make-it-3d';
import type { QuoteView } from '@/contracts/quotes';
import { clip, getGraph, guestActor, latestVersionRow, loadVersionGraph, MAIN_PART_KEY, ROOT_NODE_KEY, toEdgeInput, toNodeInput, withDisplayId, writeVersion } from '@/server/build-graph';
import { cadArtifactKey } from '@/server/cad/pipeline';
import type { SolidcraftScript, TextToCadEngine, TextToCadParameter } from '@/contracts/text-to-cad';
import { buildFromCommands, buildFromScript, isTextToCadConfigured, rebuildDesign, TextToCadError, type TextToCadResult } from '@/server/cad/text-to-cad';
import { getDb, withTx } from '@/server/db';
import { builds, parts, quotes } from '@/server/db/schema';
import { env } from '@/server/env';
import { emitEvent } from '@/server/events/outbox';
import { ApiError } from '@/server/http';
import { newId } from '@/server/ids';
import { getMakeAiModel, MakeAiOutputError, MakeAiUnavailableError } from '@/server/make-ai';
import { createPrintQuote, listPrintMaterials, loadPrintMaterialBySlug, PRINT_DFM_VERSION } from '@/server/quote/printing';
import { getStorage } from '@/server/storage';
import { SOLIDCRAFT_GUIDE_VERSION, TEXT_TO_CAD_GUIDE_VERSION } from './guide';
import { measureMinWall, parseStl } from './mesh';
import { TEXT_TO_CAD_PROMPT_VERSION, writeModelScript, type ScriptAttempt } from './script';
import { SOLIDCRAFT_PROMPT_VERSION, writeSolidcraftScript, type SolidcraftAttempt } from './solidcraft-script';

export const MAKE_IT_3D_URL_TTL_SECONDS = 15 * 60;
/** One first try plus at most two repairs, and only for BUILD_FAILED. */
export const MAKE_IT_3D_MAX_ATTEMPTS = 3;
export const MAKE_IT_3D_REQUIREMENT_KEY = 'req:make-it-3d';
const DEFAULT_PRINT_MATERIAL = 'petg';

const KIND: Record<'step' | 'glb' | 'stl', MakeIt3dArtifactView['kind']> = { step: 'STEP', glb: 'GLB', stl: 'STL' };
const CONTENT_TYPE: Record<MakeIt3dArtifactView['kind'], string> = { STEP: 'model/step', GLB: 'model/gltf-binary', STL: 'model/stl' };

export type StoredTextToCadArtifact = { kind: MakeIt3dArtifactView['kind']; key: string; filename: string; bytes: number; sha256: string };

/** What `part:main.data.textToCad` holds. */
export type TextToCadRecord = {
    prompt: string;
    engine: TextToCadEngine;
    scriptSha256: string;
    scriptKey: string;
    geometry: TextToCadResult['geometry'];
    minWallMm: number | null;
    warnings: string[];
    artifacts: StoredTextToCadArtifact[];
    /** SolidCraft: the named sizes the buyer can change (records written before it have none). */
    parameters?: TextToCadParameter[];
    /** Made by Make AI from the description, or by the buyer changing sizes. */
    origin?: 'make_ai' | 'parameters';
    changes?: { name: string; from: string; to: string }[];
    /** SolidCraft: the saved design (`model.sc`) the next size change opens. */
    design?: { key: string; sha256: string; bytes: number };
    attempts: number;
    model: string;
    promptVersion: string;
    guideVersion: string;
    generatedAt: string;
};

const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

/** The engine Make AI models with (TEXT_TO_CAD_ENGINE; cadgen unless set). */
export function textToCadEngine(): TextToCadEngine['name'] {
    return env().TEXT_TO_CAD_ENGINE;
}

export function makeIt3dAvailability(): { available: boolean; reason: string | null } {
    const e = env();
    if (!e.MAKE_AI_ENABLED) return { available: false, reason: 'Make AI is switched off here, so it cannot make 3D models.' };
    if (!e.GOOGLE_GENERATIVE_AI_API_KEY) return { available: false, reason: 'Make AI is not connected to a model yet, so it cannot make 3D models.' };
    if (!isTextToCadConfigured()) return { available: false, reason: 'The 3D model service is not set up here yet, so Make AI cannot make 3D models.' };
    return { available: true, reason: null };
}

function isKidsBuild(view: BuildGraphView): boolean {
    const root = view.nodes.find((n) => n.key === ROOT_NODE_KEY) ?? view.nodes.find((n) => n.type === 'BUILD');
    return root?.data?.audience === 'kids' || root?.data?.kidsMode === true;
}

export function textToCadRecordOf(view: BuildGraphView): (TextToCadRecord & { version: number }) | null {
    const node = view.nodes.find((n) => n.key === MAIN_PART_KEY && n.data.textToCad);
    return node ? { ...(node.data.textToCad as TextToCadRecord), version: node.designVersion } : null;
}

/** A new build for "Make it in 3D" from /make/ai: version 1 holds the buyer's description. */
export async function createMakeIt3dBuild(promptInput: string, owner: { ownerUserId: string | null; deviceHash: string | null }): Promise<CreateMakeIt3dBuildResponse> {
    const prompt = MakeIt3dPrompt.parse(promptInput);
    const name = clip(prompt.replace(/\s+/g, ' ').replace(/[.!?].*$/, ''), 80) || 'My 3D model';
    return withDisplayId(async (displayId) =>
        withTx(async (tx) => {
            const buildId = newId('build');
            const actor: Actor = owner.ownerUserId ? { kind: 'buyer', id: owner.ownerUserId } : guestActor(buildId);
            await tx.insert(builds).values({ id: buildId, displayId, name, status: 'DRAFT', origin: 'make_ai', currentVersion: 1, ownerUserId: owner.ownerUserId, deviceHash: owner.deviceHash });
            await emitEvent(tx, { type: 'build.created', payload: { buildId, displayId, name }, actor, correlationId: buildId, buildId });
            const nodes: BgNodeInput[] = [
                { key: ROOT_NODE_KEY, type: 'BUILD', label: name, data: { displayId, intent: 'make_it_3d', audience: 'adult' }, confidence: null, source: 'user', provenance: 'make-it-3d' },
                { key: MAIN_PART_KEY, type: 'PART', label: `${name} · main part`, data: { role: 'main' }, confidence: null, source: 'user', provenance: 'make-it-3d' },
                { key: MAKE_IT_3D_REQUIREMENT_KEY, type: 'REQUIREMENT', label: clip(prompt, 200), data: { text: clip(prompt, 300), category: 'other', requirementSource: 'user', addedVia: 'make-it-3d' }, confidence: null, source: 'user', provenance: 'make-it-3d:description' },
            ];
            const edges: BgEdgeInput[] = [
                { type: 'CONTAINS', fromKey: ROOT_NODE_KEY, toKey: MAIN_PART_KEY, data: {} },
                { type: 'CONSTRAINED_BY', fromKey: ROOT_NODE_KEY, toKey: MAKE_IT_3D_REQUIREMENT_KEY, data: {} },
            ];
            await writeVersion(tx, buildId, { parentVersion: null, summary: 'Described an object to make in 3D', nodes, edges, actor });
            return { buildId, displayId, url: `/build/${buildId}/workspace?section=object` };
        }),
    );
}

export type MakeIn3DOptions = { model?: LanguageModel; fetchImpl?: typeof fetch; actor?: Actor; abortSignal?: AbortSignal };

type Failed = Extract<MakeIt3dResponse, { status: 'failed' }>;
const failed = (code: Failed['code'], attempts: number, detail: string | null = null): Failed => ({ status: 'failed', code, message: MAKE_IT_3D_FAILURE_COPY[code], detail, attempts });

export async function makeIn3D(buildId: string, promptInput: string, opts: MakeIn3DOptions = {}): Promise<MakeIt3dResponse> {
    const prompt = MakeIt3dPrompt.parse(promptInput);
    const view = await getGraph(buildId);
    if (!view) throw new ApiError('NOT_FOUND', 'This build has no Build Graph yet');
    if (isKidsBuild(view)) throw new ApiError('FORBIDDEN', 'Make it in 3D is not available for Kids projects. Kids make things from project templates.', 403);
    const availability = makeIt3dAvailability();
    if (!opts.model && !availability.available) return { status: 'unavailable', reason: availability.reason! };
    if (!isTextToCadConfigured()) return { status: 'unavailable', reason: 'The 3D model service is not set up here yet, so Make AI cannot make 3D models.' };

    const model = opts.model ?? getMakeAiModel();
    const modelId = typeof model === 'string' ? model : model.modelId;
    const engine = textToCadEngine();
    let result: TextToCadResult | null = null;
    let scriptText = '';
    let attempts = 0;
    if (engine === 'solidcraft') {
        let previous: SolidcraftAttempt | null = null;
        while (attempts < MAKE_IT_3D_MAX_ATTEMPTS) {
            attempts++;
            let script: SolidcraftScript;
            try {
                script = await writeSolidcraftScript(prompt, { model, previous, abortSignal: opts.abortSignal });
            } catch (err) {
                if (err instanceof MakeAiUnavailableError) return { ...failed('UNAVAILABLE', attempts), message: 'Make AI could not answer right now. Try again in a minute.' };
                if (err instanceof MakeAiOutputError) return failed('BUILD_FAILED', attempts, 'Make AI did not write a model.');
                throw err;
            }
            try {
                result = await buildFromCommands(script, { outputs: ['step', 'glb', 'stl'], fetchImpl: opts.fetchImpl });
                break;
            } catch (err) {
                if (!(err instanceof TextToCadError)) throw err;
                console.warn(`[text-to-cad] solidcraft attempt ${attempts} for ${buildId}: ${err.code}`, err.violations.length ? err.violations.slice(0, 5) : err.message);
                // The gate's rules are as repairable as an engine error: Make AI wrote a command it may not use.
                if ((err.code === 'BUILD_FAILED' || err.code === 'GATE_REJECTED') && attempts < MAKE_IT_3D_MAX_ATTEMPTS) {
                    const why = err.violations.length ? err.violations.map((v) => `step ${v.line}: ${v.rule}`).join('; ') : err.message;
                    previous = { script, error: why };
                    continue;
                }
                return failed(err.code, attempts, err.code === 'BUILD_FAILED' ? err.message : null);
            }
        }
        if (result?.script) scriptText = `${JSON.stringify(result.script, null, 1)}\n`;
    } else {
        let previous: ScriptAttempt | null = null;
        let script = '';
        while (attempts < MAKE_IT_3D_MAX_ATTEMPTS) {
            attempts++;
            try {
                script = await writeModelScript(prompt, { model, previous, abortSignal: opts.abortSignal });
            } catch (err) {
                if (err instanceof MakeAiUnavailableError) return { ...failed('UNAVAILABLE', attempts), message: 'Make AI could not answer right now. Try again in a minute.' };
                if (err instanceof MakeAiOutputError) return failed('BUILD_FAILED', attempts, 'Make AI did not write a model.');
                throw err;
            }
            try {
                result = await buildFromScript(script, { outputs: ['step', 'glb', 'stl'], fetchImpl: opts.fetchImpl });
                break;
            } catch (err) {
                if (!(err instanceof TextToCadError)) throw err;
                console.warn(`[text-to-cad] attempt ${attempts} for ${buildId}: ${err.code}`, err.violations.length ? err.violations.slice(0, 5) : err.message);
                if (err.code === 'BUILD_FAILED' && attempts < MAKE_IT_3D_MAX_ATTEMPTS) {
                    previous = { script, error: err.message };
                    continue;
                }
                return failed(err.code, attempts, err.code === 'BUILD_FAILED' ? err.message : null);
            }
        }
        scriptText = script;
    }
    if (!result || !scriptText) return failed('BUILD_FAILED', attempts);

    return storeGeneratedVersion(buildId, view, {
        prompt,
        built: result,
        scriptText,
        attempts,
        model: modelId,
        origin: 'make_ai',
        changes: [],
        summary: `Made in 3D with Make AI: ${prompt}`,
        actor: opts.actor,
    });
}

/** Where a version's model script is stored, by engine (the app never runs it). */
const SCRIPT_FILE: Record<TextToCadEngine['name'], { filename: string; contentType: string }> = {
    cadgen: { filename: 'model.py', contentType: 'text/x-python' },
    solidcraft: { filename: 'model.solidcraft.json', contentType: 'application/json' },
};

type StoreInput = {
    prompt: string;
    built: TextToCadResult;
    scriptText: string;
    attempts: number;
    model: string;
    origin: TextToCadRecord['origin'];
    changes: NonNullable<TextToCadRecord['changes']>;
    summary: string;
    actor?: Actor;
};

/** Artifacts first (keys carry the version they belong to), then the NEW DRAFT version that points at them. */
async function storeGeneratedVersion(buildId: string, view: BuildGraphView, input: StoreInput): Promise<MakeIt3dResponse> {
    const { prompt, built } = input;
    const stl = built.artifacts.find((a) => a.kind === 'stl');
    const wall = stl ? measureMinWall(parseStl(stl.data)) : null;
    const latest = await latestVersionRow(getDb(), buildId);
    if (!latest) throw new ApiError('NOT_FOUND', 'Build not found');
    const nextVersion = latest.version + 1;

    const storage = getStorage();
    const artifacts: StoredTextToCadArtifact[] = [];
    for (const a of built.artifacts) {
        const kind = KIND[a.kind];
        const key = cadArtifactKey(buildId, nextVersion, a.filename);
        await storage.putObject(key, a.data, { contentType: CONTENT_TYPE[kind] });
        artifacts.push({ kind, key, filename: a.filename, bytes: a.bytes, sha256: a.sha256 });
    }
    const file = SCRIPT_FILE[built.engine.name];
    const scriptKey = cadArtifactKey(buildId, nextVersion, file.filename);
    await storage.putObject(scriptKey, input.scriptText, { contentType: file.contentType });
    let design: TextToCadRecord['design'];
    if (built.design) {
        const key = cadArtifactKey(buildId, nextVersion, built.design.filename);
        await storage.putObject(key, built.design.data, { contentType: 'application/zip' });
        design = { key, sha256: built.design.sha256, bytes: built.design.bytes };
    }

    const solidcraft = built.engine.name === 'solidcraft';
    const record: TextToCadRecord = {
        prompt,
        engine: built.engine,
        scriptSha256: sha256(input.scriptText),
        scriptKey,
        geometry: built.geometry,
        minWallMm: wall?.minWallMm ?? null,
        warnings: built.warnings,
        artifacts,
        parameters: built.parameters,
        ...(design ? { design } : {}),
        origin: input.origin,
        changes: input.changes,
        attempts: input.attempts,
        model: input.model,
        promptVersion: solidcraft ? SOLIDCRAFT_PROMPT_VERSION : TEXT_TO_CAD_PROMPT_VERSION,
        guideVersion: solidcraft ? SOLIDCRAFT_GUIDE_VERSION : TEXT_TO_CAD_GUIDE_VERSION,
        generatedAt: new Date().toISOString(),
    };
    const actor = input.actor ?? guestActor(buildId);
    const version = await withTx(async (tx) => {
        const graph = await loadVersionGraph(tx, buildId, latest.version);
        // The new geometry replaces any earlier CAD on the main part, with its decomposition and estimate.
        const stale = new Set(graph.nodes.filter((n) => (n.type === 'PART' && n.data.role === 'cad_item') || n.key === 'quote:preliminary').map((n) => n.key));
        const nodes = graph.nodes.filter((n) => !stale.has(n.key)).map(toNodeInput);
        const edges = graph.edges.filter((e) => !stale.has(e.fromKey) && !stale.has(e.toKey)).map(toEdgeInput);
        const provenance = clip(input.origin === 'parameters' ? `${built.engine.name}:${built.engine.version} parameters by the buyer` : `${built.engine.name}:${built.engine.version} via ${input.model}`, 200);
        const data = { textToCad: record, dimensionsStatus: 'cad', partId: null };
        const main = nodes.find((n) => n.key === MAIN_PART_KEY);
        if (main) {
            const { cad: _previousCad, bom: _bom, ...rest } = main.data as Record<string, unknown>;
            main.data = { ...rest, ...data };
            main.source = input.origin === 'parameters' ? 'user' : 'make_ai';
            main.provenance = provenance;
        } else {
            nodes.push({ key: MAIN_PART_KEY, type: 'PART', label: clip(view.build.name, 200), data, confidence: null, source: 'make_ai', provenance });
            const root = nodes.find((n) => n.key === ROOT_NODE_KEY) ?? nodes.find((n) => n.type === 'BUILD');
            if (root) edges.push({ type: 'CONTAINS', fromKey: root.key, toKey: MAIN_PART_KEY, data: {} });
        }
        if (!nodes.some((n) => n.key === MAKE_IT_3D_REQUIREMENT_KEY)) {
            nodes.push({ key: MAKE_IT_3D_REQUIREMENT_KEY, type: 'REQUIREMENT', label: clip(prompt, 200), data: { text: clip(prompt, 300), category: 'other', requirementSource: 'user', addedVia: 'make-it-3d' }, confidence: null, source: 'user', provenance: 'make-it-3d:description' });
            const root = nodes.find((n) => n.key === ROOT_NODE_KEY) ?? nodes.find((n) => n.type === 'BUILD');
            if (root) edges.push({ type: 'CONSTRAINED_BY', fromKey: root.key, toKey: MAKE_IT_3D_REQUIREMENT_KEY, data: {} });
        }
        // writeVersion requires the parent to still be the latest: a concurrent write makes this 409.
        const v = await writeVersion(tx, buildId, { parentVersion: latest.version, summary: clip(input.summary, 300), nodes, edges, actor });
        return v.version;
    });
    if (version !== nextVersion) throw new ApiError('CONFLICT', 'This build changed while the model was being made. Try again.');
    return { status: 'generated', version, record: await recordView({ ...record, version }) };
}

/** "80 mm" -> "80 mm"; the engine's own expressions are short already. */
const plainValue = (p: TextToCadParameter | undefined) => (p ? p.expression : '');

/**
 * New sizes for a SolidCraft model: the saved design is reopened by the worker with the new values
 * (`--param`; no Make AI call), checked against its checksum here and there. Its edge and face picks
 * follow their geometry, so fillets and holes stay put. The result is a NEW DRAFT version the buyer
 * approves before any quote, like a model Make AI made.
 */
export async function changeMakeIt3dParameters(buildId: string, input: MakeIt3dParametersRequest, opts: { fetchImpl?: typeof fetch; actor?: Actor } = {}): Promise<MakeIt3dResponse> {
    const { changes } = MakeIt3dParametersRequest.parse(input);
    const view = await getGraph(buildId);
    if (!view) throw new ApiError('NOT_FOUND', 'This build has no Build Graph yet');
    if (isKidsBuild(view)) throw new ApiError('FORBIDDEN', 'Make it in 3D is not available for Kids projects. Kids make things from project templates.', 403);
    const record = textToCadRecordOf(view);
    if (!record) throw new ApiError('CONFLICT', 'Make it in 3D first.');
    if (record.engine.name !== 'solidcraft') throw new ApiError('CONFLICT', 'This model was not made with named sizes. Describe it again to change it.');
    if (!isTextToCadConfigured()) return { status: 'unavailable', reason: 'The 3D model service is not set up here yet, so the sizes cannot be changed.' };

    const known = new Map((record.parameters ?? []).map((p) => [p.name, p]));
    const unknown = Object.keys(changes).filter((n) => !known.has(n));
    if (unknown.length) throw new ApiError('VALIDATION_FAILED', `This model has no size named ${unknown.slice(0, 3).join(', ')}.`, 400);
    const real = Object.fromEntries(Object.entries(changes).filter(([n, v]) => plainValue(known.get(n)).replace(/\s+/g, ' ') !== v.replace(/\s+/g, ' ')));
    if (Object.keys(real).length === 0) throw new ApiError('VALIDATION_FAILED', 'Nothing changed: type a new value for at least one size.', 400);

    if (!record.design) throw new ApiError('CONFLICT', 'This model has no saved design to change. Describe the object again.');
    const storage = getStorage();
    const [designBuf, scriptBuf] = await Promise.all([storage.getObject(record.design.key), storage.getObject(record.scriptKey)]);
    if (!designBuf || !scriptBuf) throw new ApiError('CONFLICT', 'The model files are missing from storage. Describe the object again.');
    const design = new Uint8Array(designBuf);
    const scriptText = Buffer.from(scriptBuf).toString('utf8');
    if (sha256(design) !== record.design.sha256 || sha256(scriptText) !== record.scriptSha256) throw new ApiError('CONFLICT', 'The stored model does not match its checksums. Describe the object again.');

    let built: TextToCadResult;
    try {
        built = await rebuildDesign(design, record.design.sha256, real, { outputs: ['step', 'glb', 'stl'], fetchImpl: opts.fetchImpl });
    } catch (err) {
        if (!(err instanceof TextToCadError)) throw err;
        console.warn(`[text-to-cad] parameters for ${buildId}: ${err.code}`, err.message);
        // A size the model cannot take (a fillet bigger than a wall, a hole outside the part) comes
        // back in the engine's plain words, naming the feature that failed.
        return failed(err.code, 1, err.code === 'BUILD_FAILED' || err.code === 'GATE_REJECTED' ? err.message : null);
    }
    const changeList = Object.entries(real).map(([name, to]) => ({ name, from: plainValue(known.get(name)), to }));
    return storeGeneratedVersion(buildId, view, {
        prompt: record.prompt,
        built,
        // The script that made the design stays the record of how it was modelled; the sizes are in `changes`.
        scriptText,
        attempts: 1,
        model: record.model,
        origin: 'parameters',
        changes: changeList,
        summary: `Changed ${changeList.map((c) => `${c.name} to ${c.to}`).join(', ')}`,
        actor: opts.actor,
    });
}

async function recordView(record: TextToCadRecord & { version: number }): Promise<MakeIt3dRecordView> {
    const storage = getStorage();
    const artifacts = await Promise.all(
        record.artifacts.map(async (a) => {
            const signed = await storage.getSignedUrl(a.key, { method: 'GET', expiresInSeconds: MAKE_IT_3D_URL_TTL_SECONDS });
            return { kind: a.kind, filename: a.filename, bytes: a.bytes, sha256: a.sha256, url: signed.url, expiresAt: signed.expiresAt.toISOString() };
        }),
    );
    return {
        version: record.version,
        prompt: record.prompt,
        engine: record.engine,
        scriptSha256: record.scriptSha256,
        parameters: record.parameters ?? [],
        origin: record.origin ?? 'make_ai',
        changes: record.changes ?? [],
        geometry: record.geometry,
        minWallMm: record.minWallMm,
        warnings: record.warnings,
        attempts: record.attempts,
        artifacts,
        generatedAt: record.generatedAt,
    };
}

async function printedPartFor(buildId: string, version: number, stlSha256: string) {
    const [row] = await getDb()
        .select()
        .from(parts)
        .where(and(eq(parts.buildId, buildId), eq(parts.designVersion, version), eq(parts.format, 'stl'), eq(parts.fileSha256, stlSha256)))
        .orderBy(desc(parts.createdAt))
        .limit(1);
    return row ?? null;
}

export async function getMakeIt3dStatus(buildId: string): Promise<MakeIt3dStatus> {
    const view = await getGraph(buildId);
    if (!view) throw new ApiError('NOT_FOUND', 'This build has no Build Graph yet');
    const { available, reason } = makeIt3dAvailability();
    const record = textToCadRecordOf(view);
    const latestApproved = view.version.status === 'APPROVED';
    let quoteId: string | null = null;
    if (record) {
        const stl = record.artifacts.find((a) => a.kind === 'STL');
        const part = stl ? await printedPartFor(buildId, view.version.version, stl.sha256) : null;
        if (part) {
            const [q] = await getDb().select({ id: quotes.id }).from(quotes).where(eq(quotes.partId, part.id)).orderBy(desc(quotes.createdAt)).limit(1);
            quoteId = q?.id ?? null;
        }
    }
    return {
        available,
        reason,
        record: record ? await recordView(record) : null,
        latestVersion: view.version.version,
        latestApproved,
        quotable: Boolean(record) && latestApproved,
        quoteId,
        printMaterials: await listPrintMaterials(getDb()),
    };
}

/**
 * BINDING print quote for the approved version's text-to-CAD geometry. The STL's bytes must match
 * the record's sha256; the print engine prices the worker's measured geometry with the wall
 * thickness measured on the mesh. Nothing is quoted from a DRAFT.
 */
export async function quoteMakeIt3d(buildId: string, input: { printMaterialSlug?: string; quantity: number }): Promise<QuoteView> {
    const db = getDb();
    const view = await getGraph(buildId);
    if (!view) throw new ApiError('NOT_FOUND', 'Build not found');
    const record = textToCadRecordOf(view);
    if (!record) throw new ApiError('CONFLICT', 'Make it in 3D first.');
    if (view.version.status !== 'APPROVED') throw new ApiError('CONFLICT', 'Approve this design version before getting a quote.');
    if (!record.geometry.sound || record.geometry.solids !== 1) throw new ApiError('CONFLICT', 'This model is not one clean solid, so it cannot be quoted. Ask Make AI to make it again.');
    const slug = input.printMaterialSlug ?? DEFAULT_PRINT_MATERIAL;
    if (!(await loadPrintMaterialBySlug(db, slug))) throw new ApiError('VALIDATION_FAILED', 'Unknown print material', 400);
    const stl = record.artifacts.find((a) => a.kind === 'STL');
    if (!stl) throw new ApiError('CONFLICT', 'This model has no STL. Make it again.');
    const storage = getStorage();
    const buf = await storage.getObject(stl.key);
    if (!buf) throw new ApiError('CONFLICT', 'The model files are missing from storage. Make it again.');
    const bytes = new Uint8Array(buf);
    if (sha256(bytes) !== stl.sha256) throw new ApiError('CONFLICT', 'The model files do not match their checksums. Make it again.');
    const minWallMm = record.minWallMm ?? measureMinWall(parseStl(bytes))?.minWallMm ?? null;
    if (minWallMm === null) throw new ApiError('CONFLICT', 'The wall thickness of this model could not be measured, so it cannot be quoted instantly.');

    const version = view.version.version;
    let part = await printedPartFor(buildId, version, stl.sha256);
    if (!part) {
        const partId = newId('part');
        const key = `parts/${partId}/source.stl`;
        await storage.putObject(key, bytes, { contentType: 'model/stl' });
        const slugName = view.build.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'part';
        [part] = await db
            .insert(parts)
            .values({ id: partId, buildId, designVersion: version, fileKey: key, filename: `${slugName}-v${version}.stl`, format: 'stl', sizeBytes: bytes.byteLength, fileSha256: stl.sha256, units: 'mm', status: 'READY', rulesetVersion: PRINT_DFM_VERSION, analyzedAt: new Date() })
            .returning();
    }
    const [x, y, z] = record.geometry.bbox_mm;
    return createPrintQuote({
        partId: part!.id,
        printMaterialSlug: slug,
        quantity: input.quantity,
        geometry: { bboxMm: [x, y, z], volumeMm3: record.geometry.volume_mm3, surfaceAreaMm2: record.geometry.area_mm2, minWallMm, bridgeSpanMm: 0 },
        family: 'text_to_cad',
        stlSha256: stl.sha256,
        criticalDims: [],
        notes: [
            record.origin === 'parameters'
                ? `Made with ${record.engine.name} ${record.engine.version}: the buyer changed sizes (${(record.changes ?? []).map((c) => `${c.name} ${c.from} -> ${c.to}`).join(', ')}) and approved design version ${version}. Wall thickness measured on the mesh.`
                : `Made with Make AI (${record.engine.name} ${record.engine.version}) from the buyer's description; the buyer approved design version ${version}. Wall thickness measured on the mesh.`,
        ],
    });
}
