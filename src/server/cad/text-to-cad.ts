/**
 * replaced at integration by the text-to-CAD client
 *
 * Minimal faithful client for the CAD worker's kid-template route (src/contracts/text-to-cad.ts):
 *   POST `${CAD_WORKER_URL}/v1/kid-templates/${template}/build`  bearer CAD_WORKER_TOKEN, body { params }
 * The params are re-validated with the template's own schema before they leave, the response is
 * parsed with TextToCadBuildResponse (never trusted as-is), and every artifact is decoded and
 * checked against its declared size and sha256.
 */
import 'server-only';
import { createHash } from 'node:crypto';
import { parseKidTemplateParams, TextToCadBuildResponse, type KidTemplateId, type KidTemplateParams, type TextToCadArtifact, type TextToCadGeometry, TEXT_TO_CAD_ERROR_CODES } from '@/contracts/text-to-cad';
import { env } from '@/server/env';

export const TEXT_TO_CAD_TIMEOUT_MS = 60_000;
export const TEXT_TO_CAD_MAX_RESPONSE_BYTES = 25 * 1024 * 1024;

export type TextToCadErrorCode = (typeof TEXT_TO_CAD_ERROR_CODES)[number];

export function isTextToCadConfigured(): boolean {
    return Boolean(env().CAD_WORKER_URL);
}

export type TextToCadResult = {
    engine: { name: 'cadgen'; version: string };
    artifacts: Array<Omit<TextToCadArtifact, 'content_base64'> & { data: Uint8Array }>;
    geometry: TextToCadGeometry;
    warnings: string[];
    buildMs: number;
};

export class TextToCadError extends Error {
    constructor(
        public code: TextToCadErrorCode | 'NETWORK',
        message: string,
        public violations: { line: number; rule: string }[] = [],
    ) {
        super(message);
        this.name = 'TextToCadError';
    }
}

export async function buildKidTemplate<T extends KidTemplateId>(template: T, params: KidTemplateParams<T>, opts: { fetchImpl?: typeof fetch } = {}): Promise<TextToCadResult> {
    const { CAD_WORKER_URL, CAD_WORKER_TOKEN } = env();
    if (!CAD_WORKER_URL) throw new TextToCadError('UNAVAILABLE', 'The workshop is not configured (CAD_WORKER_URL).');
    const checked = parseKidTemplateParams(template, params);
    const doFetch = opts.fetchImpl ?? fetch;

    let res: Response;
    try {
        res = await doFetch(new URL(`/v1/kid-templates/${encodeURIComponent(template)}/build`, CAD_WORKER_URL), {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...(CAD_WORKER_TOKEN ? { authorization: `Bearer ${CAD_WORKER_TOKEN}` } : {}) },
            body: JSON.stringify({ params: checked }),
            signal: AbortSignal.timeout(TEXT_TO_CAD_TIMEOUT_MS),
            redirect: 'error',
        });
    } catch (err) {
        throw new TextToCadError('NETWORK', `The workshop could not be reached: ${(err as Error).message}`);
    }

    const text = await readCapped(res, TEXT_TO_CAD_MAX_RESPONSE_BYTES);
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        throw new TextToCadError('NETWORK', `The workshop answered HTTP ${res.status} without a readable body.`);
    }
    const parsed = TextToCadBuildResponse.safeParse(raw);
    if (!parsed.success) throw new TextToCadError('NETWORK', `The workshop answered HTTP ${res.status} with an unexpected body.`);
    const body = parsed.data;
    if (!body.ok) throw new TextToCadError(body.code, body.message, body.violations);

    const artifacts = body.artifacts.map((a) => {
        const data = new Uint8Array(Buffer.from(a.content_base64, 'base64'));
        if (data.byteLength !== a.bytes) throw new TextToCadError('BUILD_FAILED', `Artifact ${a.filename} size mismatch.`);
        if (createHash('sha256').update(data).digest('hex') !== a.sha256) throw new TextToCadError('BUILD_FAILED', `Artifact ${a.filename} checksum mismatch.`);
        const { content_base64: _omit, ...meta } = a;
        return { ...meta, data };
    });
    return { engine: body.engine, artifacts, geometry: body.geometry, warnings: body.warnings, buildMs: body.build_ms };
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
            throw new TextToCadError('TOO_LARGE', 'The workshop response was too large.');
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
}
