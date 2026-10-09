/**
 * Optional GPU reconstruction worker client (RECONSTRUCT_WORKER_URL). Disabled when unset: the
 * UI then has no "Auto-detect" button and the manual path (mark the reference, draw lines,
 * confirm with calipers) is complete on its own.
 *
 *   POST {url}/v1/segment   { image_base64, content_type, hint? }  -> { polygons, reference, model }
 *   POST {url}/v1/measure   { image_base64, content_type, polygons, reference_mm? } -> { suggestions, model }
 *
 * Contract and the SAM 2 -> OpenCV -> COLMAP / Open3D pipeline behind it:
 * docs/architecture/r6-reconstruct.md. Bearer RECONSTRUCT_WORKER_TOKEN, hard timeouts, an image
 * cap on the way out and a response cap on the way back; every response is zod-parsed.
 * Outputs only ever PREFILL estimates: the caliper confirmation rule is unchanged.
 */
import 'server-only';
import { z } from 'zod';
import { PixelPoint, ReferencePreset, SegmentPolygon, SegmentResponse, SuggestedDimension } from '@/contracts/reconstruct';
import { env } from '@/server/env';
import { ApiError } from '@/server/http';

export const SEGMENT_TIMEOUT_MS = 20_000;
export const MEASURE_TIMEOUT_MS = 30_000;
/** Images sent to the worker: the attachment cap (15 MB). */
export const SEGMENT_MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const SEGMENT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

const WorkerSegment = z.object({
    polygons: z.array(SegmentPolygon).max(20),
    reference: z.object({ preset: ReferencePreset, a: PixelPoint, b: PixelPoint }).nullable().default(null),
    model: z.string().max(80),
});
const WorkerMeasure = z.object({ suggestions: z.array(SuggestedDimension).max(20), model: z.string().max(80) });

export function isSegmentationEnabled(): boolean {
    return Boolean(env().RECONSTRUCT_WORKER_URL);
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
            throw new ApiError('INTERNAL', 'Reconstruction worker response too large.', 502);
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
}

async function call<T>(path: string, body: unknown, schema: z.ZodType<T>, timeoutMs: number, fetchImpl: typeof fetch): Promise<T> {
    const { RECONSTRUCT_WORKER_URL, RECONSTRUCT_WORKER_TOKEN } = env();
    if (!RECONSTRUCT_WORKER_URL) throw new ApiError('NOT_IMPLEMENTED', 'Auto-detect is not available (no reconstruction worker is configured).', 501);
    let res: Response;
    try {
        res = await fetchImpl(new URL(path, RECONSTRUCT_WORKER_URL), {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...(RECONSTRUCT_WORKER_TOKEN ? { authorization: `Bearer ${RECONSTRUCT_WORKER_TOKEN}` } : {}) },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(timeoutMs),
            redirect: 'error',
        });
    } catch (err) {
        const timeout = (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError';
        throw new ApiError('INTERNAL', timeout ? 'Auto-detect timed out. Mark the reference and measure by hand.' : 'The reconstruction worker is unreachable.', timeout ? 504 : 502);
    }
    const text = await readCapped(res, SEGMENT_MAX_RESPONSE_BYTES);
    if (!res.ok) throw new ApiError('INTERNAL', `Auto-detect failed (${res.status}). Mark the reference and measure by hand.`, 502);
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new ApiError('INTERNAL', 'The reconstruction worker sent an invalid response.', 502);
    }
    const checked = schema.safeParse(parsed);
    if (!checked.success) throw new ApiError('INTERNAL', 'The reconstruction worker sent an invalid response.', 502);
    return checked.data;
}

export type SegmentImage = { bytes: Uint8Array; contentType: string };

/** Masks (SAM 2), the detected reference object, then suggested dimensions (OpenCV / COLMAP). */
export async function segmentAndMeasure(image: SegmentImage, opts: { hint?: string; fetchImpl?: typeof fetch } = {}): Promise<SegmentResponse> {
    if (image.bytes.byteLength > SEGMENT_MAX_IMAGE_BYTES) throw new ApiError('PAYLOAD_TOO_LARGE', 'That photo is too large for auto-detect.', 413);
    const fetchImpl = opts.fetchImpl ?? fetch;
    const image_base64 = Buffer.from(image.bytes).toString('base64');
    const seg = await call('/v1/segment', { image_base64, content_type: image.contentType, hint: opts.hint ?? null }, WorkerSegment, SEGMENT_TIMEOUT_MS, fetchImpl);
    const measured = await call('/v1/measure', { image_base64, content_type: image.contentType, polygons: seg.polygons, reference: seg.reference }, WorkerMeasure, MEASURE_TIMEOUT_MS, fetchImpl);
    return SegmentResponse.parse({ polygons: seg.polygons, reference: seg.reference, suggestions: measured.suggestions, model: `${seg.model} + ${measured.model}`.slice(0, 80) });
}
