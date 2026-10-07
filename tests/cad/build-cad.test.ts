/**
 * Make AI build -> approved design version -> CAD -> quotable part -> BINDING quote.
 * The CAD worker is a stand-in serving the golden flat pattern (its real output is
 * covered by services/cad-worker/tests and tests/cad/cad-worker-quote.test.ts).
 */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MockLanguageModelV4 } from 'ai/test';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CreationIntent } from '@/contracts/make-ai';
import { approveVersion, getGraph } from '@/server/build-graph';
import { generateBuildCad, getBuildCad } from '@/server/cad/build-cad';
import { builds } from '@/server/db/schema';
import { resetEnvCache } from '@/server/env';
import { createBuildFromIntent } from '@/server/make-ai/builds';
import { createQuote } from '@/server/quote';
import { LocalDiskStorage, setStorage } from '@/server/storage';
import { POST as postCad } from '@/app/api/builds/[buildId]/cad/route';
import { insertIntent, textResult } from '../build-graph/fixtures';
import { useTestDb as withTestDb } from '../support/db';

const ctx = withTestDb({ seed: true });
let storageDir = '';
let dxf: Buffer;

const INTENT: CreationIntent = {
    intent: 'create',
    product_type: 'shelf bracket',
    summary: 'A bent steel L-bracket for a shelf.',
    requirements: [
        { id: 'R1', text: 'Legs 50 mm and 80 mm, 40 mm wide', category: 'dimension', source: 'user', confidence: 1 },
        { id: 'R2', text: 'Holds a 5 kg shelf', category: 'function', source: 'user', confidence: 0.9 },
    ],
    constraints: [],
    unknowns: [],
    materials_suggested: [{ material: 'Cold rolled steel', why: 'Bends well.' }],
    processes_suggested: ['Laser cutting', 'Bending'],
    risk_class: 'standard',
    required_specialists: [],
};

const SPEC = { family: 'l_bracket', leg_a_mm: 50, leg_b_mm: 80, width_mm: 40, thickness_mm: 1.52, inside_bend_radius_mm: 1.52 } as const;

function fakeWorker(): typeof fetch {
    const art = (kind: 'DXF' | 'STEP' | 'GLB', filename: string, data: Buffer) => ({
        kind,
        filename,
        content_type: 'application/octet-stream',
        bytes: data.byteLength,
        sha256: createHash('sha256').update(data).digest('hex'),
        content_base64: data.toString('base64'),
    });
    return (async () =>
        new Response(
            JSON.stringify({
                family: 'l_bracket',
                artifacts: [art('DXF', 'bracket_flat.dxf', dxf), art('STEP', 'bracket.step', Buffer.from('ISO-10303-21;')), art('GLB', 'bracket.glb', Buffer.from('glTF0000'))],
                metrics: { bbox_mm: [80, 40, 50], volume_mm3: 9700, flat_size_mm: [40, 127.358], bend_count: 1 },
                processes: ['laser cutting', 'press brake bending'],
                warnings: [],
                worker_version: '0.1.0',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
        )) as unknown as typeof fetch;
}

async function approvedBuild(intent: CreationIntent = INTENT) {
    const intentId = await insertIntent(ctx.db, intent);
    const { buildId } = await createBuildFromIntent(intentId);
    await approveVersion(buildId, 1);
    return buildId;
}

beforeAll(async () => {
    process.env.CAD_WORKER_URL = 'http://cad.test';
    resetEnvCache();
    storageDir = await mkdtemp(path.join(os.tmpdir(), 'dm-bcad-'));
    setStorage(new LocalDiskStorage({ rootDir: storageDir, appUrl: 'http://localhost:3100', signingSecret: 'test-storage-secret' }));
    dxf = await readFile(path.join(__dirname, '../fixtures/cad/cad-worker-l-bracket.dxf'));
});
afterAll(async () => {
    delete process.env.CAD_WORKER_URL;
    resetEnvCache();
    setStorage(null);
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
});

describe('generateBuildCad', () => {
    it('turns an approved Make AI build into geometry, a new version and a BINDING-quotable part', async () => {
        const buildId = await approvedBuild();
        const res = await generateBuildCad(buildId, { spec: SPEC, fetchImpl: fakeWorker() });
        expect(res.status).toBe('generated');
        if (res.status !== 'generated') return;
        expect(res.version).toBe(2);
        expect(res.quotable).toBe(true);
        expect(res.artifacts.map((a) => a.kind).sort()).toEqual(['DXF', 'GLB', 'STEP']);
        expect(res.artifacts[0].url).toMatch(/^http:\/\/localhost:3100\/api\/storage\/local\//);

        const graph = await getGraph(buildId, 2);
        const part = graph!.nodes.find((n) => n.key === 'part:main')!;
        expect(part.data).toMatchObject({ partId: res.partId, cad: { family: 'l_bracket', specSource: 'buyer' } });
        expect(graph!.version.status).toBe('DRAFT');

        const quote = await createQuote({ partId: res.partId!, materialId: 'mat_steel_crs', thicknessOptionId: 'thk_crs_16ga', services: [{ serviceId: 'svc_bending' }], quantity: 10 });
        expect(quote.trustLevel).toBe('BINDING');
        expect(quote.buildId).toBe(buildId);

        const again = await getBuildCad(buildId);
        expect(again).toMatchObject({ status: 'generated', version: 2, partId: res.partId, quotable: true });
        // The CAD version is a DRAFT: it must be approved before generating again.
        await expect(generateBuildCad(buildId, { spec: SPEC, fetchImpl: fakeWorker() })).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('refuses builds whose latest version is not approved', async () => {
        const intentId = await insertIntent(ctx.db, INTENT);
        const { buildId } = await createBuildFromIntent(intentId);
        await expect(generateBuildCad(buildId, { spec: SPEC, fetchImpl: fakeWorker() })).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('turns untraceable agent dimensions into open questions in a new version, without calling the worker', async () => {
        const buildId = await approvedBuild();
        const model = new MockLanguageModelV4({
            provider: 'google.generative-ai',
            modelId: 'gemini-test-flash',
            doGenerate: async () =>
                textResult(JSON.stringify({ family: 'l_bracket', leg_a_mm: 300, leg_b_mm: 80, width_mm: 40, thickness_mm: 1.52, dimension_sources: [], missing_inputs: [], rationale: 'bracket' })),
        });
        let called = false;
        const res = await generateBuildCad(buildId, {
            model,
            fetchImpl: (async () => {
                called = true;
                return new Response('{}');
            }) as unknown as typeof fetch,
        });
        expect(called).toBe(false);
        expect(res.status).toBe('needs_input');
        if (res.status !== 'needs_input') return;
        const graph = await getGraph(buildId, res.version);
        const open = graph!.nodes.filter((n) => n.type === 'UNKNOWN' && n.data.status === 'open');
        expect(open).toHaveLength(1);
        expect(open[0].label).toMatch(/leg a/);
        const [b] = await ctx.db.select().from(builds).where(eq(builds.id, buildId));
        expect(b.status).toBe('NEEDS_INPUT');
    });
});

describe('POST /api/builds/:buildId/cad', () => {
    it('answers 501 when the CAD worker is not configured', async () => {
        const buildId = await approvedBuild();
        delete process.env.CAD_WORKER_URL;
        resetEnvCache();
        try {
            const res = await postCad(
                new Request(`http://localhost:3100/api/builds/${buildId}/cad`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ spec: SPEC }) }),
                { params: Promise.resolve({ buildId }) },
            );
            expect(res.status).toBe(501);
        } finally {
            process.env.CAD_WORKER_URL = 'http://cad.test';
            resetEnvCache();
        }
    });
});
