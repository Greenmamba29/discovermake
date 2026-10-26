import type { Store } from '@netlify/blobs';
import { describe, expect, it } from 'vitest';
import { NetlifyBlobsStorage, verifyLocalSignature } from '@/server/storage';

/** In-memory stand-in for a Netlify Blobs store (the methods the driver uses). */
function memoryStore() {
    const blobs = new Map<string, { data: ArrayBuffer; metadata: Record<string, unknown> }>();
    const store = {
        async set(key: string, blob: Blob, opts?: { metadata?: Record<string, unknown> }) {
            blobs.set(key, { data: await blob.arrayBuffer(), metadata: opts?.metadata ?? {} });
        },
        async get(key: string) {
            return blobs.get(key)?.data ?? null;
        },
        async getWithMetadata(key: string) {
            const hit = blobs.get(key);
            return hit ? { data: hit.data, metadata: hit.metadata, etag: 'x' } : null;
        },
        async delete(key: string) {
            blobs.delete(key);
        },
    };
    return { store: store as unknown as Store, blobs };
}

describe('Netlify Blobs storage driver', () => {
    it('stores, reads, heads and deletes objects in the Blobs store, never on disk', async () => {
        const { store, blobs } = memoryStore();
        const s = new NetlifyBlobsStorage({ appUrl: 'https://discovermake.com', signingSecret: 'secret' }, store);
        expect(s.driver).toBe('netlify-blobs');

        await s.putObject('parts/prt_1/source.dxf', 'DXF', { contentType: 'application/dxf' });
        expect(blobs.has('parts/prt_1/source.dxf')).toBe(true);
        expect((await s.getObject('parts/prt_1/source.dxf'))?.toString()).toBe('DXF');
        expect(await s.headObject('parts/prt_1/source.dxf')).toEqual({ sizeBytes: 3, contentType: 'application/dxf' });

        await s.deleteObject('parts/prt_1/source.dxf');
        expect(await s.getObject('parts/prt_1/source.dxf')).toBeNull();
        expect(await s.headObject('parts/prt_1/source.dxf')).toBeNull();
        await expect(s.putObject('../etc/passwd', 'x')).rejects.toThrow(/Invalid storage key/);
    });

    it('mints the same verifiable signed URLs as the local driver, on APP_URL', async () => {
        const s = new NetlifyBlobsStorage({ appUrl: 'https://discovermake.com', signingSecret: 'secret' }, memoryStore().store);
        const signed = await s.getSignedUrl('parts/prt_1/source.dxf', { method: 'PUT', contentType: 'application/dxf', maxBytes: 1000 });
        const u = new URL(signed.url);
        expect(u.origin).toBe('https://discovermake.com');
        expect(u.pathname).toBe('/api/storage/local/parts/prt_1/source.dxf');
        expect(verifyLocalSignature('secret', 'parts/prt_1/source.dxf', u.searchParams, 'PUT')).toMatchObject({ maxBytes: 1000 });
    });
});

describe('STORAGE_DRIVER default', () => {
    const keys = ['STORAGE_DRIVER', 'NETLIFY', 'NETLIFY_BLOBS_CONTEXT'] as const;
    const driverWith = async (vars: Partial<Record<(typeof keys)[number], string>>) => {
        const { env, resetEnvCache } = await import('@/server/env');
        const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
        for (const k of keys) delete process.env[k];
        Object.assign(process.env, vars);
        resetEnvCache();
        try {
            return env().STORAGE_DRIVER;
        } finally {
            for (const k of keys) if (saved[k] === undefined) delete process.env[k];
            else process.env[k] = saved[k];
            resetEnvCache();
        }
    };

    it('is netlify-blobs on Netlify, local elsewhere, and an explicit value always wins', async () => {
        expect(await driverWith({})).toBe('local');
        expect(await driverWith({ NETLIFY: 'true' })).toBe('netlify-blobs');
        expect(await driverWith({ NETLIFY_BLOBS_CONTEXT: 'e30=' })).toBe('netlify-blobs');
        expect(await driverWith({ NETLIFY: 'true', STORAGE_DRIVER: 's3' })).toBe('s3');
    });
});

describe('APP_URL default', () => {
    it("falls back to Netlify's primary site URL, and an explicit APP_URL wins", async () => {
        const { env, resetEnvCache } = await import('@/server/env');
        const saved = { app: process.env.APP_URL, url: process.env.URL };
        try {
            delete process.env.APP_URL;
            process.env.URL = 'https://discovermake.com';
            resetEnvCache();
            expect(env().APP_URL).toBe('https://discovermake.com');
            process.env.APP_URL = 'https://example.org';
            resetEnvCache();
            expect(env().APP_URL).toBe('https://example.org');
        } finally {
            for (const [k, v] of [['APP_URL', saved.app], ['URL', saved.url]] as const) if (v === undefined) delete process.env[k];
            else process.env[k] = v;
            resetEnvCache();
        }
    });
});
