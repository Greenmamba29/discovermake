/**
 * Client for the CAD worker's text-to-CAD routes (cadgen, contract src/contracts/text-to-cad.ts).
 *
 *   buildFromScript(script)          POST /v1/text-to-cad/build              (a Make AI build123d script)
 *   buildKidTemplate(template, p)    POST /v1/kid-templates/{template}/build (our own parametric models)
 *   buildFromCommands(script)        POST /v1/solidcraft/build               (a SolidCraft command script, data not code)
 *   rebuildDesign(design, sizes)     POST /v1/solidcraft/rebuild             (new sizes for a saved SolidCraft design)
 *
 * Same worker, same bearer token and the same conventions as ./client.ts: inputs re-validated
 * before sending, a timeout, a capped response, the JSON parsed with the contract, and every
 * artifact checked against its declared size and sha256 after decoding. A build that the worker
 * refused or that failed comes back as a TextToCadError with the contract's code and its
 * plain-language message (safe to show); an unreachable or misbehaving worker is 'NETWORK'.
 * The generated code only ever runs inside the worker's gate + sandbox, never here.
 */
import 'server-only';
import { createHash } from 'node:crypto';
import type { z } from 'zod';
import {
    KidTemplateParams,
    SOLIDCRAFT_MAX_DESIGN_BYTES,
    SOLIDCRAFT_MAX_SCRIPT_BYTES,
    SolidcraftBuildRequest,
    SolidcraftRebuildRequest,
    TEXT_TO_CAD_MAX_SCRIPT_BYTES,
    TextToCadBuildRequest,
    TextToCadBuildResponse,
    type KidTemplateId,
    type SolidcraftOverrides,
    type SolidcraftScript,
    type TextToCadArtifact,
    type TextToCadEngine,
    type TextToCadErrorCode,
    type TextToCadGeometry,
    type TextToCadOutput,
    type TextToCadParameter,
} from '@/contracts/text-to-cad';
import { env } from '@/server/env';

/** A model run (120 s cap on the worker) plus the measure step and transfer. */
export const TEXT_TO_CAD_TIMEOUT_MS = 240_000;
/** Three outputs of at most 20 MB each, base64-encoded, plus the envelope. */
export const TEXT_TO_CAD_MAX_RESPONSE_BYTES = 90 * 1024 * 1024;

export type TextToCadResult = {
    engine: TextToCadEngine;
    artifacts: Array<Omit<TextToCadArtifact, 'content_base64'> & { data: Uint8Array }>;
    geometry: TextToCadGeometry;
    /** SolidCraft: the model's named sizes after the build (empty for cadgen). */
    parameters: TextToCadParameter[];
    /** SolidCraft builds: the exact script the worker built (null for cadgen and for rebuilds). */
    script: SolidcraftScript | null;
    /** SolidCraft: the saved design the next size change opens (null for cadgen). */
    design: { filename: 'model.sc'; sha256: string; bytes: number; data: Uint8Array } | null;
    warnings: string[];
    buildMs: number;
};

export class TextToCadError extends Error {
    constructor(
        public code: z.infer<typeof TextToCadErrorCode> | 'NETWORK',
        message: string,
        public violations: { line: number; rule: string }[] = [],
    ) {
        super(message);
        this.name = 'TextToCadError';
    }
}

export function isTextToCadConfigured(): boolean {
    return Boolean(env().CAD_WORKER_URL);
}

export async function buildFromScript(script: string, opts: { outputs?: TextToCadOutput[]; fetchImpl?: typeof fetch } = {}): Promise<TextToCadResult> {
    const parsed = TextToCadBuildRequest.safeParse({ script, ...(opts.outputs ? { outputs: opts.outputs } : {}) });
    if (!parsed.success) throw new TextToCadError('GATE_REJECTED', 'The model script is empty or larger than the worker accepts.', [{ line: 0, rule: parsed.error.issues[0]?.message ?? 'invalid script' }]);
    if (Buffer.byteLength(parsed.data.script, 'utf8') > TEXT_TO_CAD_MAX_SCRIPT_BYTES) throw new TextToCadError('GATE_REJECTED', 'The model script is larger than the worker accepts.', [{ line: 0, rule: `script over ${TEXT_TO_CAD_MAX_SCRIPT_BYTES / 1024} KB` }]);
    return post('/v1/text-to-cad/build', parsed.data, parsed.data.outputs, opts.fetchImpl);
}

export async function buildKidTemplate<T extends KidTemplateId>(template: T, params: KidTemplateParams<T>, opts: { fetchImpl?: typeof fetch } = {}): Promise<TextToCadResult> {
    // Re-validate with the template's own schema (labels: letters, digits and spaces only).
    const clean = KidTemplateParams[template].parse(params);
    return post(`/v1/kid-templates/${encodeURIComponent(template)}/build`, { template, params: clean }, ['step', 'glb', 'stl'], opts.fetchImpl);
}

/**
 * A SolidCraft command script (Make AI's, or the stored one with new sizes). The worker gates every
 * command against its allow-list before anything runs; the app re-checks the shape and size first.
 */
export async function buildFromCommands(script: SolidcraftScript, opts: { outputs?: TextToCadOutput[]; fetchImpl?: typeof fetch } = {}): Promise<TextToCadResult> {
    const parsed = SolidcraftBuildRequest.safeParse({ script, ...(opts.outputs ? { outputs: opts.outputs } : {}) });
    if (!parsed.success) throw new TextToCadError('GATE_REJECTED', 'The model script is not in the shape the 3D model service accepts.', [{ line: 0, rule: parsed.error.issues[0]?.message ?? 'invalid script' }]);
    if (Buffer.byteLength(JSON.stringify(parsed.data.script), 'utf8') > SOLIDCRAFT_MAX_SCRIPT_BYTES) throw new TextToCadError('GATE_REJECTED', 'The model script is larger than the worker accepts.', [{ line: 0, rule: `script over ${SOLIDCRAFT_MAX_SCRIPT_BYTES / 1024} KB` }]);
    const result = await post('/v1/solidcraft/build', parsed.data, parsed.data.outputs, opts.fetchImpl);
    if (result.engine.name !== 'solidcraft' || !result.script || !result.design) throw new TextToCadError('NETWORK', 'The 3D model service answered for the wrong engine.');
    return result;
}

/**
 * New sizes for a SolidCraft model: the saved design goes back to the worker with its sha256 and the
 * new values; the worker refuses a design whose checksum does not match. Nothing is regenerated by AI.
 */
export async function rebuildDesign(design: Uint8Array, sha256: string, parameters: SolidcraftOverrides, opts: { outputs?: TextToCadOutput[]; fetchImpl?: typeof fetch } = {}): Promise<TextToCadResult> {
    if (design.byteLength === 0 || design.byteLength > SOLIDCRAFT_MAX_DESIGN_BYTES) throw new TextToCadError('TOO_LARGE', 'The saved design is empty or too large to rebuild.');
    if (createHash('sha256').update(design).digest('hex') !== sha256) throw new TextToCadError('GATE_REJECTED', 'The saved design does not match its checksum.');
    const parsed = SolidcraftRebuildRequest.safeParse({ design: { content_base64: Buffer.from(design).toString('base64'), sha256 }, parameters, ...(opts.outputs ? { outputs: opts.outputs } : {}) });
    if (!parsed.success) throw new TextToCadError('GATE_REJECTED', parsed.error.issues[0]?.message ?? 'Those sizes are not allowed.', [{ line: 0, rule: parsed.error.issues[0]?.message ?? 'invalid sizes' }]);
    const result = await post('/v1/solidcraft/rebuild', parsed.data, parsed.data.outputs, opts.fetchImpl);
    if (result.engine.name !== 'solidcraft' || !result.design) throw new TextToCadError('NETWORK', 'The 3D model service answered for the wrong engine.');
    return result;
}

async function post(path: string, body: unknown, outputs: TextToCadOutput[], fetchImpl?: typeof fetch): Promise<TextToCadResult> {
    const { CAD_WORKER_URL, CAD_WORKER_TOKEN } = env();
    if (!CAD_WORKER_URL) throw new TextToCadError('UNAVAILABLE', '3D model building is not set up here yet.');
    const doFetch = fetchImpl ?? fetch;

    let res: Response;
    try {
        res = await doFetch(new URL(path, CAD_WORKER_URL), {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...(CAD_WORKER_TOKEN ? { authorization: `Bearer ${CAD_WORKER_TOKEN}` } : {}) },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(TEXT_TO_CAD_TIMEOUT_MS),
            redirect: 'error',
        });
    } catch (err) {
        const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
        if (timedOut) throw new TextToCadError('TIMEOUT', 'Building the 3D model took too long. Try a simpler shape.');
        console.warn('[text-to-cad] worker unreachable', err instanceof Error ? err.message : err);
        throw new TextToCadError('NETWORK', 'The 3D model service could not be reached. Try again in a minute.');
    }

    const text = await readCapped(res, TEXT_TO_CAD_MAX_RESPONSE_BYTES);
    if (res.status !== 200 && res.status !== 503) {
        console.warn(`[text-to-cad] worker answered ${res.status}`);
        throw new TextToCadError('NETWORK', `The 3D model service failed (${res.status}). Try again in a minute.`);
    }
    let json: unknown;
    try {
        json = JSON.parse(text);
    } catch {
        throw new TextToCadError('NETWORK', 'The 3D model service sent an unreadable answer.');
    }
    const parsed = TextToCadBuildResponse.safeParse(json);
    if (!parsed.success) throw new TextToCadError('NETWORK', 'The 3D model service sent an answer in the wrong shape.');
    const out = parsed.data;
    if (!out.ok) throw new TextToCadError(out.code, out.message.slice(0, 500), out.violations.slice(0, 50));

    const artifacts = out.artifacts.map((a) => {
        if (!outputs.includes(a.kind)) throw new TextToCadError('NETWORK', `The 3D model service returned an unexpected ${a.kind.toUpperCase()} file.`);
        if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(a.filename)) throw new TextToCadError('NETWORK', 'The 3D model service returned a file with an unsafe name.');
        const data = new Uint8Array(Buffer.from(a.content_base64, 'base64'));
        if (data.byteLength !== a.bytes) throw new TextToCadError('NETWORK', `The ${a.kind.toUpperCase()} file arrived with the wrong size.`);
        if (createHash('sha256').update(data).digest('hex') !== a.sha256) throw new TextToCadError('NETWORK', `The ${a.kind.toUpperCase()} file failed its checksum.`);
        const { content_base64: _omit, ...meta } = a;
        return { ...meta, data };
    });
    const missing = outputs.filter((k) => !artifacts.some((a) => a.kind === k));
    if (missing.length) throw new TextToCadError('NETWORK', `The 3D model service did not return ${missing.map((m) => m.toUpperCase()).join(', ')}.`);
    let design: TextToCadResult['design'] = null;
    if (out.design) {
        const data = new Uint8Array(Buffer.from(out.design.content_base64, 'base64'));
        if (data.byteLength !== out.design.bytes || createHash('sha256').update(data).digest('hex') !== out.design.sha256) throw new TextToCadError('NETWORK', 'The saved design arrived damaged.');
        design = { filename: out.design.filename, sha256: out.design.sha256, bytes: out.design.bytes, data };
    }
    return { engine: out.engine, artifacts, geometry: out.geometry, parameters: out.parameters, script: out.script ?? null, design, warnings: out.warnings, buildMs: out.build_ms };
}

async function readCapped(res: Response, max: number): Promise<string> {
    if (!res.body) return '';
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > max) {
            await reader.cancel();
            throw new TextToCadError('TOO_LARGE', 'The 3D model files are too large to receive.');
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
}
