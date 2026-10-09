/** Optional GPU worker client: disabled without RECONSTRUCT_WORKER_URL; enabled path with a mocked fetch. */
import { afterEach, describe, expect, it } from 'vitest';
import { resetEnvCache } from '@/server/env';
import { isSegmentationEnabled, segmentAndMeasure, SEGMENT_MAX_IMAGE_BYTES } from '@/server/reconstruct/segmentation';

const IMAGE = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), contentType: 'image/jpeg' };
const enable = () => {
    process.env.RECONSTRUCT_WORKER_URL = 'https://gpu.example.test';
    process.env.RECONSTRUCT_WORKER_TOKEN = 'gpu-secret';
    resetEnvCache();
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
    delete process.env.RECONSTRUCT_WORKER_URL;
    delete process.env.RECONSTRUCT_WORKER_TOKEN;
    resetEnvCache();
});

describe('segmentation client', () => {
    it('is disabled when RECONSTRUCT_WORKER_URL is unset (501, no network)', async () => {
        resetEnvCache();
        expect(isSegmentationEnabled()).toBe(false);
        let called = false;
        const fetchImpl = (async () => {
            called = true;
            return json({});
        }) as typeof fetch;
        await expect(segmentAndMeasure(IMAGE, { fetchImpl })).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED', status: 501 });
        expect(called).toBe(false);
    });

    it('calls /v1/segment then /v1/measure with the bearer token and returns suggestions only', async () => {
        enable();
        expect(isSegmentationEnabled()).toBe(true);
        const calls: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];
        const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
            const u = String(url);
            calls.push({ url: u, auth: new Headers(init?.headers).get('authorization'), body: JSON.parse(String(init?.body)) });
            if (u.endsWith('/v1/segment'))
                return json({ polygons: [{ label: 'knob', score: 0.97, points: [{ x: 1, y: 1 }, { x: 50, y: 1 }, { x: 50, y: 50 }] }], reference: { preset: 'credit_card', a: { x: 0, y: 0 }, b: { x: 856, y: 0 } }, model: 'sam2-hiera-l' });
            return json({ suggestions: [{ param: 'diameter_mm', valueMm: 38.4, uncertaintyMm: 0.9, method: 'min-enclosing-circle' }], model: 'opencv-4.10' });
        }) as typeof fetch;
        const res = await segmentAndMeasure(IMAGE, { fetchImpl, hint: 'stove knob' });
        expect(calls.map((c) => c.url)).toEqual(['https://gpu.example.test/v1/segment', 'https://gpu.example.test/v1/measure']);
        expect(calls.every((c) => c.auth === 'Bearer gpu-secret')).toBe(true);
        expect(calls[0]!.body).toMatchObject({ content_type: 'image/jpeg', hint: 'stove knob' });
        expect(calls[1]!.body.polygons).toHaveLength(1);
        expect(res.suggestions).toEqual([{ param: 'diameter_mm', valueMm: 38.4, uncertaintyMm: 0.9, method: 'min-enclosing-circle' }]);
        expect(res.model).toBe('sam2-hiera-l + opencv-4.10');
    });

    it('rejects malformed worker output, worker errors and oversized photos', async () => {
        enable();
        const bad = (async () => json({ polygons: 'nope', model: 'x' })) as typeof fetch;
        await expect(segmentAndMeasure(IMAGE, { fetchImpl: bad })).rejects.toMatchObject({ status: 502 });
        const down = (async () => json({ error: 'gpu oom' }, 500)) as typeof fetch;
        await expect(segmentAndMeasure(IMAGE, { fetchImpl: down })).rejects.toMatchObject({ status: 502 });
        const timeout = (async () => {
            throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
        }) as typeof fetch;
        await expect(segmentAndMeasure(IMAGE, { fetchImpl: timeout })).rejects.toMatchObject({ status: 504 });
        await expect(segmentAndMeasure({ bytes: new Uint8Array(SEGMENT_MAX_IMAGE_BYTES + 1), contentType: 'image/jpeg' }, { fetchImpl: bad })).rejects.toMatchObject({ status: 413 });
    });

    it('caps the response size', async () => {
        enable();
        const huge = (async () => new Response('x'.repeat(3 * 1024 * 1024), { status: 200 })) as typeof fetch;
        await expect(segmentAndMeasure(IMAGE, { fetchImpl: huge })).rejects.toMatchObject({ status: 502 });
    });
});
