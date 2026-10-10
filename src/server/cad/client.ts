/**
 * Client for the CAD worker (services/cad-worker).
 *
 * The worker runs outside Vercel (OpenCascade needs native libraries). This client
 * re-validates the spec before sending it, caps the response size, checks every
 * artifact against its declared sha256 and size, and never trusts the worker's
 * JSON shape without parsing it.
 */
import 'server-only';
import { createHash } from 'node:crypto';
import { CadGenerateResponse, CadSpec, type CadArtifact, type CadSpecInput } from '@/contracts/cad';
import { env } from '@/server/env';
import { ApiError } from '@/server/http';

export const CAD_WORKER_TIMEOUT_MS = 45_000;
/** STEP + DXF + GLB for the supported families stay well under this. */
export const CAD_MAX_RESPONSE_BYTES = 20 * 1024 * 1024;

export type DecodedArtifact = Omit<CadArtifact, 'content_base64'> & { data: Uint8Array };
export type CadResult = Omit<CadGenerateResponse, 'artifacts'> & { artifacts: DecodedArtifact[] };

export function isCadWorkerConfigured(): boolean {
    return Boolean(env().CAD_WORKER_URL);
}

export async function generateCad(specInput: CadSpecInput, opts: { ref?: string; fetchImpl?: typeof fetch } = {}): Promise<CadResult> {
    const { CAD_WORKER_URL, CAD_WORKER_TOKEN } = env();
    if (!CAD_WORKER_URL) throw new ApiError('NOT_IMPLEMENTED', 'CAD generation is not configured (CAD_WORKER_URL).');
    const spec = CadSpec.parse(specInput);
    const doFetch = opts.fetchImpl ?? fetch;

    let res: Response;
    try {
        res = await doFetch(new URL('/v1/generate', CAD_WORKER_URL), {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...(CAD_WORKER_TOKEN ? { authorization: `Bearer ${CAD_WORKER_TOKEN}` } : {}) },
            body: JSON.stringify({ spec, ref: opts.ref ?? null }),
            signal: AbortSignal.timeout(CAD_WORKER_TIMEOUT_MS),
            redirect: 'error',
        });
    } catch (err) {
        throw new ApiError('INTERNAL', `CAD worker unreachable: ${(err as Error).message}`);
    }

    const text = await readCapped(res, CAD_MAX_RESPONSE_BYTES);
    if (res.status === 422) {
        const message = safeErrorMessage(text) ?? 'The CAD worker rejected this spec.';
        throw new ApiError('VALIDATION_FAILED', message);
    }
    if (!res.ok) throw new ApiError('INTERNAL', `CAD worker failed (${res.status}): ${safeErrorMessage(text) ?? 'no detail'}`);

    const body = CadGenerateResponse.parse(JSON.parse(text));
    if (body.family !== spec.family) throw new ApiError('INTERNAL', 'CAD worker returned a different family than requested.');
    const artifacts = body.artifacts.map((a) => {
        const data = new Uint8Array(Buffer.from(a.content_base64, 'base64'));
        if (data.byteLength !== a.bytes) throw new ApiError('INTERNAL', `CAD artifact ${a.filename} size mismatch.`);
        if (createHash('sha256').update(data).digest('hex') !== a.sha256) throw new ApiError('INTERNAL', `CAD artifact ${a.filename} checksum mismatch.`);
        const { content_base64: _omit, ...meta } = a;
        return { ...meta, data };
    });
    return { ...body, artifacts };
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
            throw new ApiError('INTERNAL', 'CAD worker response too large.');
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
}

function safeErrorMessage(text: string): string | null {
    try {
        const parsed = JSON.parse(text) as { error?: { message?: unknown }; detail?: { message?: unknown } };
        const m = parsed.error?.message ?? parsed.detail?.message;
        return typeof m === 'string' ? m.slice(0, 500) : null;
    } catch {
        return null;
    }
}
