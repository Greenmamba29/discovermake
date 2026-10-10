/** The kid-template workshop client: request shape, contract parsing, artifact checks, errors. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildKidTemplate, isTextToCadConfigured, TextToCadError } from '@/server/cad/text-to-cad';
import { resetEnvCache } from '@/server/env';
import { goldenKeychain, goldenKidResponse, goldenKidWorker } from '../support/kids-golden';

beforeAll(() => {
    process.env.CAD_WORKER_URL = 'http://cad-worker.test';
    process.env.CAD_WORKER_TOKEN = 'tok';
    resetEnvCache();
});
afterAll(() => {
    delete process.env.CAD_WORKER_URL;
    delete process.env.CAD_WORKER_TOKEN;
    resetEnvCache();
});

const respond = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('buildKidTemplate', () => {
    it('posts the validated params with the bearer token and decodes verified artifacts', async () => {
        expect(isTextToCadConfigured()).toBe(true);
        const worker = goldenKidWorker();
        const r = await buildKidTemplate('name_keychain', { label: ' MIA ', color: 'blue', size: 'small' }, { fetchImpl: worker });
        expect(worker.calls[0]).toEqual({ url: 'http://cad-worker.test/v1/kid-templates/name_keychain/build', body: { params: { label: 'MIA', color: 'blue', size: 'small' } }, auth: 'Bearer tok' });
        expect(r.engine).toEqual({ name: 'cadgen', version: '0.4.2-golden' });
        expect(r.geometry).toEqual(goldenKeychain().geometry);
        expect(r.buildMs).toBe(812);
        expect(r.artifacts[0]).toMatchObject({ kind: 'stl', sha256: goldenKeychain().sha256 });
        expect(Buffer.from(r.artifacts[0]!.data).equals(goldenKeychain().stl)).toBe(true);
        expect(r.artifacts[0]).not.toHaveProperty('content_base64');
    });

    it('never sends invalid params', async () => {
        const worker = goldenKidWorker();
        await expect(buildKidTemplate('name_keychain', { label: 'a@b', color: 'blue', size: 'small' }, { fetchImpl: worker })).rejects.toThrow();
        expect(worker.calls).toHaveLength(0);
    });

    it('maps contract errors, bad checksums, bad bodies and network failures', async () => {
        const fail = goldenKidWorker({ fail: { code: 'BUILD_FAILED', message: 'No solid.' } });
        await expect(buildKidTemplate('bike_hook', { color: 'red' }, { fetchImpl: fail })).rejects.toMatchObject({ name: 'TextToCadError', code: 'BUILD_FAILED', message: 'No solid.' });
        const bad = goldenKidResponse();
        bad.artifacts[0]!.sha256 = '0'.repeat(64);
        await expect(buildKidTemplate('bike_hook', { color: 'red' }, { fetchImpl: respond(bad) })).rejects.toThrow(/checksum/);
        await expect(buildKidTemplate('bike_hook', { color: 'red' }, { fetchImpl: respond({ nope: true }, 500) })).rejects.toMatchObject({ code: 'NETWORK' });
        const down = (async () => {
            throw new Error('ECONNREFUSED');
        }) as unknown as typeof fetch;
        const err = await buildKidTemplate('bike_hook', { color: 'red' }, { fetchImpl: down }).catch((e) => e);
        expect(err).toBeInstanceOf(TextToCadError);
        expect(err.code).toBe('NETWORK');
    });

    it('is unavailable without CAD_WORKER_URL', async () => {
        delete process.env.CAD_WORKER_URL;
        resetEnvCache();
        try {
            expect(isTextToCadConfigured()).toBe(false);
            await expect(buildKidTemplate('bike_hook', { color: 'red' })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
        } finally {
            process.env.CAD_WORKER_URL = 'http://cad-worker.test';
            resetEnvCache();
        }
    });
});
