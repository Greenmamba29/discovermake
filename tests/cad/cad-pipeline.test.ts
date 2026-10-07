/**
 * CAD client + pipeline against a stand-in worker that serves the golden flat pattern
 * (the real worker is exercised by services/cad-worker/tests).
 */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CadSpec } from '@/contracts/cad';
import { generateCad } from '@/server/cad/client';
import { attachCadResult } from '@/server/cad/pipeline';
import { domainEvents, parts } from '@/server/db/schema';
import { resetEnvCache } from '@/server/env';
import { createPartUpload } from '@/server/quote';
import { LocalDiskStorage, getStorage, setStorage } from '@/server/storage';
import { useTestDb as withTestDb } from '../support/db';

const ctx = withTestDb({ seed: true });
let storageDir = '';
let dxf: Buffer;

const BRACKET = { family: 'l_bracket', leg_a_mm: 50, leg_b_mm: 80, width_mm: 40, thickness_mm: 1.52, inside_bend_radius_mm: 1.52 } as const;

function workerResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function artifact(kind: 'DXF' | 'STEP', filename: string, data: Buffer) {
    return { kind, filename, content_type: 'application/octet-stream', bytes: data.byteLength, sha256: createHash('sha256').update(data).digest('hex'), content_base64: data.toString('base64') };
}

beforeAll(async () => {
    process.env.CAD_WORKER_URL = 'http://cad.test';
    process.env.CAD_WORKER_TOKEN = 'cad-token';
    resetEnvCache();
    storageDir = await mkdtemp(path.join(os.tmpdir(), 'dm-cadp-'));
    setStorage(new LocalDiskStorage({ rootDir: storageDir, appUrl: 'http://localhost:3100', signingSecret: 'test-storage-secret' }));
    dxf = await readFile(path.join(__dirname, '../fixtures/cad/cad-worker-l-bracket.dxf'));
});
afterAll(async () => {
    delete process.env.CAD_WORKER_URL;
    delete process.env.CAD_WORKER_TOKEN;
    resetEnvCache();
    setStorage(null);
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
});

describe('generateCad', () => {
    it('sends the validated spec with the bearer token and verifies artifacts', async () => {
        let seen: { url: string; auth: string | null; body: unknown } | null = null;
        const fetchImpl = (async (url: URL, init: RequestInit) => {
            seen = { url: String(url), auth: new Headers(init.headers).get('authorization'), body: JSON.parse(String(init.body)) };
            return workerResponse({ family: 'l_bracket', artifacts: [artifact('DXF', 'bracket_flat.dxf', dxf)], metrics: { bbox_mm: [80, 40, 50], volume_mm3: 1 }, processes: [], warnings: [] });
        }) as unknown as typeof fetch;
        const r = await generateCad(BRACKET, { fetchImpl, ref: 'bld_x@v1' });
        expect(seen!.url).toBe('http://cad.test/v1/generate');
        expect(seen!.auth).toBe('Bearer cad-token');
        expect(seen!.body).toEqual({ spec: CadSpec.parse(BRACKET), ref: 'bld_x@v1' });
        expect(Buffer.from(r.artifacts[0].data).equals(dxf)).toBe(true);
    });

    it('rejects tampered artifacts and invalid specs', async () => {
        const bad = { ...artifact('DXF', 'bracket_flat.dxf', dxf), sha256: '0'.repeat(64) };
        const fetchImpl = (async () => workerResponse({ family: 'l_bracket', artifacts: [bad], metrics: { bbox_mm: [1, 1, 1], volume_mm3: 1 }, processes: [], warnings: [] })) as unknown as typeof fetch;
        await expect(generateCad(BRACKET, { fetchImpl })).rejects.toThrow(/checksum/);
        await expect(generateCad({ ...BRACKET, script: 'import os' } as never, { fetchImpl })).rejects.toThrow();
    });

    it('maps worker 422 to VALIDATION_FAILED', async () => {
        const fetchImpl = (async () => workerResponse({ error: { code: 'GEOMETRY_FAILED', message: 'fillet too large' } }, 422)) as unknown as typeof fetch;
        await expect(generateCad(BRACKET, { fetchImpl })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: 'fillet too large' });
    });
});

describe('attachCadResult', () => {
    it('stores artifacts and attaches an analyzed, quotable part to the same build', async () => {
        const host = await createPartUpload({ filename: 'host.dxf', sizeBytes: 10 });
        const result = {
            family: 'l_bracket' as const,
            artifacts: [
                { kind: 'DXF' as const, filename: 'bracket_flat.dxf', content_type: 'application/dxf', bytes: dxf.byteLength, sha256: 'x'.repeat(64), data: new Uint8Array(dxf) },
                { kind: 'STEP' as const, filename: 'bracket.step', content_type: 'model/step', bytes: 4, sha256: 'y'.repeat(64), data: new TextEncoder().encode('ISO-') },
            ],
            metrics: { bbox_mm: [80, 40, 50] as [number, number, number], volume_mm3: 1 },
            processes: [],
            warnings: [],
        };
        const { artifacts, part } = await attachCadResult({ buildId: host.buildId, version: 3, result, actor: { kind: 'system', id: 'test' } });
        expect(artifacts.map((a) => a.key)).toEqual([`builds/${host.buildId}/cad/v3/bracket_flat.dxf`, `builds/${host.buildId}/cad/v3/bracket.step`]);
        expect(await getStorage().getObject(artifacts[1].key)).not.toBeNull();
        expect(part).toMatchObject({ status: 'READY', buildId: host.buildId });
        expect(part!.features?.bendCount).toBe(1);
        const [row] = await ctx.db.select().from(parts).where(eq(parts.id, part!.id));
        expect(row.designVersion).toBe(3);
        const events = await ctx.db.select().from(domainEvents).where(eq(domainEvents.eventType, 'cad.generated'));
        expect(events).toHaveLength(1);
    });
});
