/**
 * The text-to-CAD client against a fake worker: request shape and bearer token, artifact
 * decoding with size + sha256 checks, contract error codes passed through with their plain
 * message and violations, and the NETWORK / UNAVAILABLE / TIMEOUT edges.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildFromScript, buildKidTemplate, isTextToCadConfigured, TextToCadError } from '@/server/cad/text-to-cad';
import { resetEnvCache } from '@/server/env';

const FIX = path.join(process.cwd(), 'tests', 'fixtures', 'text-to-cad');
const SCRIPT = readFileSync(path.join(FIX, 'model.py'), 'utf8');
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function art(kind: 'step' | 'glb' | 'stl', data: Buffer, over: Record<string, unknown> = {}) {
    return { kind, filename: `model.${kind}`, content_base64: data.toString('base64'), sha256: sha(data), bytes: data.byteLength, ...over };
}

const OK = (artifacts = [art('step', Buffer.from('ISO-10303-21;')), art('glb', Buffer.from('glTF')), art('stl', Buffer.from('solid'))]) => ({
    ok: true,
    engine: { name: 'cadgen', version: '0.7.20' },
    artifacts,
    geometry: { bbox_mm: [60, 24, 18], volume_mm3: 19707.9, area_mm2: 6939.4, solids: 1, sound: true },
    warnings: [],
    build_ms: 23202,
});

type Call = { url: string; init: RequestInit };
function fakeFetch(status: number, body: unknown, calls: Call[] = []): typeof fetch {
    return (async (url: URL | string, init: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
}

async function caught(p: Promise<unknown>): Promise<TextToCadError> {
    try {
        await p;
    } catch (e) {
        expect(e).toBeInstanceOf(TextToCadError);
        return e as TextToCadError;
    }
    throw new Error('expected a TextToCadError');
}

beforeEach(() => {
    process.env.CAD_WORKER_URL = 'http://cad.test';
    process.env.CAD_WORKER_TOKEN = 'tok';
    resetEnvCache();
});
afterEach(() => {
    delete process.env.CAD_WORKER_URL;
    delete process.env.CAD_WORKER_TOKEN;
    resetEnvCache();
});

describe('buildFromScript', () => {
    it('posts the script with the bearer token and decodes verified artifacts', async () => {
        const calls: Call[] = [];
        const r = await buildFromScript(SCRIPT, { fetchImpl: fakeFetch(200, OK(), calls) });
        expect(calls[0]!.url).toBe('http://cad.test/v1/text-to-cad/build');
        expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer tok');
        expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ script: SCRIPT, outputs: ['step', 'glb', 'stl'] });
        expect(calls[0]!.init.redirect).toBe('error');
        expect(r.engine).toEqual({ name: 'cadgen', version: '0.7.20' });
        expect(r.artifacts.map((a) => a.kind)).toEqual(['step', 'glb', 'stl']);
        expect(Buffer.from(r.artifacts[0]!.data).toString()).toBe('ISO-10303-21;');
        expect(r.artifacts[0]).not.toHaveProperty('content_base64');
        expect(r.geometry.bbox_mm).toEqual([60, 24, 18]);
        expect(r.buildMs).toBe(23202);
    });

    it('rejects a checksum or size mismatch as NETWORK', async () => {
        const bad = OK([art('step', Buffer.from('ISO'), { sha256: 'a'.repeat(64) }), art('glb', Buffer.from('g')), art('stl', Buffer.from('s'))]);
        expect((await caught(buildFromScript(SCRIPT, { fetchImpl: fakeFetch(200, bad) }))).code).toBe('NETWORK');
        const size = OK([art('step', Buffer.from('ISO'), { bytes: 99 }), art('glb', Buffer.from('g')), art('stl', Buffer.from('s'))]);
        expect((await caught(buildFromScript(SCRIPT, { fetchImpl: fakeFetch(200, size) }))).message).toMatch(/wrong size/);
    });

    it('rejects a missing or unexpected output and an unsafe filename', async () => {
        const missing = OK([art('step', Buffer.from('ISO'))]);
        expect((await caught(buildFromScript(SCRIPT, { fetchImpl: fakeFetch(200, missing) }))).message).toMatch(/GLB, STL/);
        const unexpected = OK([art('step', Buffer.from('ISO')), art('glb', Buffer.from('g'))]);
        expect((await caught(buildFromScript(SCRIPT, { outputs: ['step'], fetchImpl: fakeFetch(200, unexpected) }))).message).toMatch(/unexpected GLB/);
        const unsafe = OK([art('step', Buffer.from('ISO'), { filename: '../x.step' }), art('glb', Buffer.from('g')), art('stl', Buffer.from('s'))]);
        expect((await caught(buildFromScript(SCRIPT, { fetchImpl: fakeFetch(200, unsafe) }))).message).toMatch(/unsafe name/);
    });

    it('passes contract errors through with the plain message and violations', async () => {
        const gate = { ok: false, code: 'GATE_REJECTED', message: 'The model uses something that is not allowed, so it was not run.', violations: [{ line: 3, rule: "import of 'os' is not allowed" }] };
        const e = await caught(buildFromScript(SCRIPT, { fetchImpl: fakeFetch(200, gate) }));
        expect(e.code).toBe('GATE_REJECTED');
        expect(e.violations).toEqual([{ line: 3, rule: "import of 'os' is not allowed" }]);
        const failed = { ok: false, code: 'BUILD_FAILED', message: 'The model failed on line 9: ValueError: bad' };
        expect((await caught(buildFromScript(SCRIPT, { fetchImpl: fakeFetch(200, failed) }))).message).toBe('The model failed on line 9: ValueError: bad');
        const unavailable = { ok: false, code: 'UNAVAILABLE', message: 'not installed', violations: [] };
        expect((await caught(buildFromScript(SCRIPT, { fetchImpl: fakeFetch(503, unavailable) }))).code).toBe('UNAVAILABLE');
    });

    it('maps worker trouble to NETWORK and a timeout to TIMEOUT', async () => {
        expect((await caught(buildFromScript(SCRIPT, { fetchImpl: fakeFetch(500, { error: 'boom' }) }))).code).toBe('NETWORK');
        expect((await caught(buildFromScript(SCRIPT, { fetchImpl: fakeFetch(401, {}) }))).code).toBe('NETWORK');
        expect((await caught(buildFromScript(SCRIPT, { fetchImpl: fakeFetch(200, 'not json') }))).code).toBe('NETWORK');
        expect((await caught(buildFromScript(SCRIPT, { fetchImpl: fakeFetch(200, { ok: true }) }))).code).toBe('NETWORK');
        const refused = (async () => {
            throw new TypeError('fetch failed');
        }) as unknown as typeof fetch;
        expect((await caught(buildFromScript(SCRIPT, { fetchImpl: refused }))).code).toBe('NETWORK');
        const slow = (async () => {
            throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
        }) as unknown as typeof fetch;
        expect((await caught(buildFromScript(SCRIPT, { fetchImpl: slow }))).code).toBe('TIMEOUT');
    });

    it('refuses an empty or oversized script before calling the worker', async () => {
        const calls: Call[] = [];
        expect((await caught(buildFromScript('', { fetchImpl: fakeFetch(200, OK(), calls) }))).code).toBe('GATE_REJECTED');
        expect((await caught(buildFromScript('é'.repeat(40_000), { fetchImpl: fakeFetch(200, OK(), calls) }))).code).toBe('GATE_REJECTED');
        expect(calls).toHaveLength(0);
    });

    it('is UNAVAILABLE without CAD_WORKER_URL', async () => {
        delete process.env.CAD_WORKER_URL;
        resetEnvCache();
        expect(isTextToCadConfigured()).toBe(false);
        expect((await caught(buildFromScript(SCRIPT, { fetchImpl: fakeFetch(200, OK()) }))).code).toBe('UNAVAILABLE');
    });
});

describe('buildKidTemplate', () => {
    it('validates the params with the template schema and posts them as data', async () => {
        const calls: Call[] = [];
        const r = await buildKidTemplate('name_keychain', { label: ' Mia ', color: 'purple', size: 'small' }, { fetchImpl: fakeFetch(200, OK(), calls) });
        expect(calls[0]!.url).toBe('http://cad.test/v1/kid-templates/name_keychain/build');
        expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ params: { label: 'Mia', color: 'purple', size: 'small' } });
        expect(r.artifacts).toHaveLength(3);
    });

    it('never sends a label with symbols', async () => {
        const calls: Call[] = [];
        await expect(buildKidTemplate('bookmark', { label: 'me@mail.com', color: 'red', shape: 'rounded' }, { fetchImpl: fakeFetch(200, OK(), calls) })).rejects.toThrow();
        expect(calls).toHaveLength(0);
    });
});
