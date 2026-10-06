import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { LocalDiskStorage, verifyLocalSignature } from '@/server/storage';
import { canonicalJson } from '@/server/auth/tokens';
import { uuidv7, newId } from '@/server/ids';

describe('local storage + primitives', () => {
    let dir = '';
    afterAll(async () => dir && rm(dir, { recursive: true, force: true }));

    it('stores, reads and signs URLs', async () => {
        dir = await mkdtemp(path.join(os.tmpdir(), 'dm-storage-'));
        const s = new LocalDiskStorage({ rootDir: dir, appUrl: 'http://localhost:3100', signingSecret: 'secret' });
        await s.putObject('parts/prt_x/source.dxf', '0\nSECTION\n', { contentType: 'application/dxf' });
        expect((await s.getObject('parts/prt_x/source.dxf'))?.toString()).toContain('SECTION');
        expect(await s.headObject('parts/prt_x/source.dxf')).toEqual({ sizeBytes: 10, contentType: 'application/dxf' });
        expect(await s.getObject('parts/missing')).toBeNull();
        await expect(s.putObject('../escape', 'x')).rejects.toThrow();

        const put = await s.getSignedUrl('parts/prt_y/source.dxf', { method: 'PUT', contentType: 'application/dxf', maxBytes: 1000 });
        const u = new URL(put.url);
        expect(u.pathname).toBe('/api/storage/local/parts/prt_y/source.dxf');
        expect(verifyLocalSignature('secret', 'parts/prt_y/source.dxf', u.searchParams, 'PUT')).toMatchObject({ maxBytes: 1000 });
        expect(verifyLocalSignature('secret', 'parts/prt_y/source.dxf', u.searchParams, 'GET')).toBeNull();
        expect(verifyLocalSignature('other', 'parts/prt_y/source.dxf', u.searchParams, 'PUT')).toBeNull();
        expect(verifyLocalSignature('secret', 'parts/prt_z/source.dxf', u.searchParams, 'PUT')).toBeNull();
    });

    it('generates ids and canonical json', () => {
        expect(newId('part')).toMatch(/^prt_[0-9a-z]{20}$/);
        expect(uuidv7()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[2,{"y":2,"z":1}]},"b":1}');
    });
});
