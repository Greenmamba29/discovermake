/**
 * Make AI "Make it in 3D" on the server: a mock model writes the script, a fake CAD worker answers
 * with the committed golden cadgen output (or with contract errors). Covers the honest unavailable
 * state, the new DRAFT version with the CAD record, the repair loop (BUILD_FAILED only, at most two
 * repairs), approval before a BINDING print quote, the Kids guard and owner-only routes.
 */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MockLanguageModelV4 } from 'ai/test';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MakeIt3dResponse, MakeIt3dStatus } from '@/contracts/make-it-3d';
import { POST as makeRoute, GET as statusRoute } from '@/app/api/builds/[buildId]/text-to-cad/route';
import { POST as quoteRoute } from '@/app/api/builds/[buildId]/text-to-cad/quote/route';
import { GET as availabilityRoute, POST as createRoute } from '@/app/api/text-to-cad/route';
import { approveVersion, getGraph, guestActor, writeVersion } from '@/server/build-graph';
import { builds, designVersions, parts, printQuoteDetails } from '@/server/db/schema';
import { withTx } from '@/server/db';
import { resetEnvCache } from '@/server/env';
import { LocalDiskStorage, setStorage } from '@/server/storage';
import { extractScript } from '@/server/text-to-cad/script';
import { makeIt3dLimiter } from '@/server/text-to-cad/request';
import { createMakeIt3dBuild, getMakeIt3dStatus, makeIn3D, quoteMakeIt3d, textToCadRecordOf } from '@/server/text-to-cad/service';
import { buildGraphWriteLimiter } from '@/server/build-graph';
import { textResult } from '../build-graph/fixtures';
import { useTestDb as withTestDb } from '../support/db';

const FIX = path.join(process.cwd(), 'tests', 'fixtures', 'text-to-cad');
const SCRIPT = readFileSync(path.join(FIX, 'model.py'), 'utf8');
const GOLDEN = JSON.parse(readFileSync(path.join(FIX, 'response.json'), 'utf8')) as {
    engine: { name: 'cadgen'; version: string };
    artifacts: { kind: 'step' | 'glb' | 'stl'; filename: string; sha256: string; bytes: number }[];
    geometry: { bbox_mm: [number, number, number]; volume_mm3: number; area_mm2: number; solids: number; sound: boolean };
};
const PROMPT = 'A desk cable holder with three slots for charging cables';
const BASE = 'http://localhost:3100';
const OWNER = 'dm_device=makeit3downerdevice0000000000000000001';
const STRANGER = 'dm_device=makeit3dstrangerdevice00000000000000002';

const ctx = withTestDb({ seed: true });
let storageDir = '';
let ip = 0;

const req = (url: string, method: string, cookie: string, body?: unknown) =>
    new Request(`${BASE}${url}`, { method, headers: { 'content-type': 'application/json', origin: BASE, 'x-forwarded-for': `203.0.113.${++ip % 250}`, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
const params = (buildId: string) => ({ params: Promise.resolve({ buildId }) });

type WorkerReply = { ok: true } | { ok: false; code: string; message: string; violations?: { line: number; rule: string }[] };
function fakeWorker(replies: WorkerReply[]) {
    const calls: { url: string; script: string }[] = [];
    const fn = (async (url: URL | string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { script: string };
        calls.push({ url: String(url), script: body.script });
        const reply = replies[Math.min(calls.length - 1, replies.length - 1)]!;
        if (!reply.ok) return new Response(JSON.stringify({ violations: [], ...reply }), { status: 200 });
        const artifacts = GOLDEN.artifacts.map((a) => {
            const data = readFileSync(path.join(FIX, a.filename));
            return { ...a, content_base64: data.toString('base64') };
        });
        return new Response(JSON.stringify({ ok: true, engine: GOLDEN.engine, artifacts, geometry: GOLDEN.geometry, warnings: [], build_ms: 21000 }), { status: 200 });
    }) as unknown as typeof fetch;
    return Object.assign(fn, { calls });
}

function scriptModel(prompts: string[] = []) {
    return new MockLanguageModelV4({
        doGenerate: async (options) => {
            prompts.push(JSON.stringify(options.prompt));
            return textResult(`Here is the model:\n\n\`\`\`python\n${SCRIPT}\`\`\`\n`);
        },
    });
}

async function newBuild(owner: { ownerUserId: string | null; deviceHash: string | null } = { ownerUserId: null, deviceHash: null }) {
    return createMakeIt3dBuild(PROMPT, owner);
}

beforeAll(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), 'dm-make-it-3d-'));
    setStorage(new LocalDiskStorage({ rootDir: storageDir, appUrl: BASE, signingSecret: 'test-storage-secret' }));
    process.env.CAD_WORKER_URL = 'http://cad-worker.test';
    process.env.MAKE_AI_ENABLED = 'true';
    resetEnvCache();
});
afterAll(async () => {
    delete process.env.CAD_WORKER_URL;
    delete process.env.MAKE_AI_ENABLED;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    resetEnvCache();
    setStorage(null);
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
});
beforeEach(async () => {
    await makeIt3dLimiter.reset();
    await buildGraphWriteLimiter.reset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('extractScript', () => {
    it('takes the fenced python block that is a cadgen model', () => {
        expect(extractScript(`Sure!\n\`\`\`python\n${SCRIPT}\`\`\``)).toBe(SCRIPT);
        expect(extractScript('```\nprint(1)\n```\n```python\n' + SCRIPT + '```')).toBe(SCRIPT);
        expect(extractScript('')).toBeNull();
    });
});

describe('Make it in 3D', () => {
    it('answers an honest unavailable state without a model key, and writes nothing', async () => {
        const { buildId } = await newBuild();
        const worker = fakeWorker([{ ok: true }]);
        const res = await makeIn3D(buildId, PROMPT, { fetchImpl: worker });
        expect(res).toEqual({ status: 'unavailable', reason: 'Make AI is not connected to a model yet, so it cannot make 3D models.' });
        expect(worker.calls).toHaveLength(0);
        const status = MakeIt3dStatus.parse(await (await statusRoute(req(`/api/builds/${buildId}/text-to-cad`, 'GET', OWNER), params(buildId))).json());
        expect(status).toMatchObject({ available: false, record: null, latestVersion: 1, quotable: false });
        const avail = await (await availabilityRoute(req('/api/text-to-cad', 'GET', OWNER), { params: Promise.resolve({}) })).json();
        expect(avail.available).toBe(false);
    });

    it('writes a script, builds it in the worker and stores a NEW DRAFT version with the CAD record', async () => {
        const { buildId } = await newBuild();
        const worker = fakeWorker([{ ok: true }]);
        const prompts: string[] = [];
        const res = MakeIt3dResponse.parse(await makeIn3D(buildId, PROMPT, { model: scriptModel(prompts), fetchImpl: worker }));
        expect(res.status).toBe('generated');
        if (res.status !== 'generated') return;
        expect(res.version).toBe(2);
        expect(worker.calls).toHaveLength(1);
        expect(worker.calls[0]!.url).toBe('http://cad-worker.test/v1/text-to-cad/build');
        expect(worker.calls[0]!.script).toBe(SCRIPT);
        // The guide (preamble + vendored cadgen docs) is the model's instructions; the prompt is data.
        expect(prompts[0]).toContain('DiscoverMake rules');
        expect(prompts[0]).toContain('CAD modeling and inspection');
        expect(prompts[0]).toContain(PROMPT);

        const view = (await getGraph(buildId))!;
        expect(view.version).toMatchObject({ version: 2, status: 'DRAFT' });
        const record = textToCadRecordOf(view)!;
        expect(record).toMatchObject({ prompt: PROMPT, engine: { name: 'cadgen', version: '0.7.20' }, attempts: 1, model: 'mock-model-id' });
        expect(record.scriptSha256).toBe(createHash('sha256').update(SCRIPT).digest('hex'));
        expect(record.geometry.bbox_mm).toEqual([60, 24, 18]);
        expect(record.minWallMm).toBeGreaterThan(3.9);
        expect(record.artifacts.map((a) => [a.kind, a.key])).toEqual([
            ['STEP', `builds/${buildId}/cad/v2/model.step`],
            ['GLB', `builds/${buildId}/cad/v2/model.glb`],
            ['STL', `builds/${buildId}/cad/v2/model.stl`],
        ]);
        const stored = await readFile(path.join(storageDir, `builds/${buildId}/cad/v2/model.stl`));
        expect(createHash('sha256').update(stored).digest('hex')).toBe(GOLDEN.artifacts.find((a) => a.kind === 'stl')!.sha256);
        expect(await readFile(path.join(storageDir, record.scriptKey), 'utf8')).toBe(SCRIPT);
        expect(res.record.artifacts.every((a) => a.url.startsWith(`${BASE}/`))).toBe(true);
    });

    it('repairs at most twice, and only after BUILD_FAILED, feeding back the plain error', async () => {
        const { buildId } = await newBuild();
        const prompts: string[] = [];
        const worker = fakeWorker([{ ok: false, code: 'BUILD_FAILED', message: 'The model failed on line 18: Failed creating a fillet with radius of 5' }, { ok: true }]);
        const res = await makeIn3D(buildId, PROMPT, { model: scriptModel(prompts), fetchImpl: worker });
        expect(res.status).toBe('generated');
        expect(worker.calls).toHaveLength(2);
        expect(prompts[1]).toContain('Failed creating a fillet with radius of 5');
        expect(textToCadRecordOf((await getGraph(buildId))!)!.attempts).toBe(2);

        const always = fakeWorker([{ ok: false, code: 'BUILD_FAILED', message: 'The model made no solid.' }]);
        const failed = await makeIn3D(buildId, PROMPT, { model: scriptModel(), fetchImpl: always });
        expect(failed).toEqual({ status: 'failed', code: 'BUILD_FAILED', message: expect.stringContaining('solid shape'), detail: 'The model made no solid.', attempts: 3 });
        expect(always.calls).toHaveLength(3);
    });

    it('GATE_REJECTED and TIMEOUT are not repaired and read in plain words', async () => {
        const { buildId } = await newBuild();
        const gate = fakeWorker([{ ok: false, code: 'GATE_REJECTED', message: 'not allowed', violations: [{ line: 1, rule: "import of 'os' is not allowed" }] }]);
        const res = await makeIn3D(buildId, PROMPT, { model: scriptModel(), fetchImpl: gate });
        expect(res).toEqual({ status: 'failed', code: 'GATE_REJECTED', message: "Make AI couldn't build that safely. Try describing it another way.", detail: null, attempts: 1 });
        expect(gate.calls).toHaveLength(1);
        const timeout = fakeWorker([{ ok: false, code: 'TIMEOUT', message: 'took too long' }]);
        expect(await makeIn3D(buildId, PROMPT, { model: scriptModel(), fetchImpl: timeout })).toMatchObject({ status: 'failed', code: 'TIMEOUT', attempts: 1 });
        expect((await getGraph(buildId))!.version.version).toBe(1);
    });

    it('needs the buyer to approve the version, then quotes it BINDING through the print engine', async () => {
        const { buildId } = await newBuild();
        const made = await makeIn3D(buildId, PROMPT, { model: scriptModel(), fetchImpl: fakeWorker([{ ok: true }]) });
        expect(made.status).toBe('generated');
        await expect(quoteMakeIt3d(buildId, { printMaterialSlug: 'petg', quantity: 1 })).rejects.toMatchObject({ code: 'CONFLICT' });
        expect((await getMakeIt3dStatus(buildId)).quotable).toBe(false);

        await approveVersion(buildId, 2);
        const status = await getMakeIt3dStatus(buildId);
        expect(status).toMatchObject({ latestVersion: 2, latestApproved: true, quotable: true, quoteId: null });
        expect(status.printMaterials.some((m) => m.slug === 'petg')).toBe(true);

        const quote = await quoteMakeIt3d(buildId, { printMaterialSlug: 'petg', quantity: 2 });
        expect(quote).toMatchObject({ trustLevel: 'BINDING', status: 'READY' });
        const [details] = await ctx.db.select().from(printQuoteDetails).where(eq(printQuoteDetails.quoteId, quote.id));
        expect(details).toMatchObject({ family: 'text_to_cad', stlSha256: GOLDEN.artifacts.find((a) => a.kind === 'stl')!.sha256 });
        expect((details!.geometry as { bboxMm: number[] }).bboxMm).toEqual([60, 24, 18]);
        const [part] = await ctx.db.select().from(parts).where(and(eq(parts.buildId, buildId), eq(parts.format, 'stl')));
        expect(part).toMatchObject({ status: 'READY', designVersion: 2 });
        expect((await getMakeIt3dStatus(buildId)).quoteId).toBe(quote.id);
        // A second quote reuses the same printed part.
        await quoteMakeIt3d(buildId, { printMaterialSlug: 'petg', quantity: 1 });
        expect(await ctx.db.select().from(parts).where(and(eq(parts.buildId, buildId), eq(parts.format, 'stl')))).toHaveLength(1);
    });

    it('refuses a Kids project: nothing typed there goes to Make AI', async () => {
        const { buildId } = await newBuild();
        const view = (await getGraph(buildId))!;
        await withTx(async (tx) => {
            await writeVersion(tx, buildId, {
                parentVersion: 1,
                summary: 'kids',
                actor: guestActor(buildId),
                nodes: view.nodes.map((n) => ({ key: n.key, type: n.type, label: n.label, data: n.key === 'build' || n.type === 'BUILD' ? { ...n.data, audience: 'kids' } : n.data, confidence: n.confidence, source: n.source, provenance: n.provenance })),
                edges: view.edges.map((e) => ({ type: e.type, fromKey: e.fromKey, toKey: e.toKey, data: e.data })),
            });
        });
        const model = scriptModel();
        await expect(makeIn3D(buildId, PROMPT, { model, fetchImpl: fakeWorker([{ ok: true }]) })).rejects.toMatchObject({ status: 403 });
        expect(model.doGenerateCalls).toHaveLength(0);
    });
});

describe('Make it in 3D routes', () => {
    it('creates a build from /make/ai only when available, owned by this device', async () => {
        const unavailable = await createRoute(req('/api/text-to-cad', 'POST', OWNER, { prompt: PROMPT }), { params: Promise.resolve({}) });
        expect(unavailable.status).toBe(503);
        process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-key';
        resetEnvCache();
        try {
            const created = await createRoute(req('/api/text-to-cad', 'POST', OWNER, { prompt: PROMPT }), { params: Promise.resolve({}) });
            expect(created.status).toBe(201);
            const { buildId, url } = await created.json();
            expect(url).toBe(`/build/${buildId}/workspace?section=object`);
            const [row] = await ctx.db.select().from(builds).where(eq(builds.id, buildId));
            expect(row).toMatchObject({ origin: 'make_ai', deviceHash: expect.any(String) });
            const [v1] = await ctx.db.select().from(designVersions).where(eq(designVersions.buildId, buildId));
            expect(v1!.status).toBe('DRAFT');
            const tooShort = await createRoute(req('/api/text-to-cad', 'POST', OWNER, { prompt: 'cup' }), { params: Promise.resolve({}) });
            expect(tooShort.status).toBe(400);
        } finally {
            delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
            resetEnvCache();
        }
    });

    it('only the owner may make it in 3D or quote it', async () => {
        const { buildId } = await newBuild({ ownerUserId: null, deviceHash: null });
        // A build with an owner device: strangers are refused.
        await ctx.db.update(builds).set({ deviceHash: 'f'.repeat(64) }).where(eq(builds.id, buildId));
        const denied = await makeRoute(req(`/api/builds/${buildId}/text-to-cad`, 'POST', STRANGER, { prompt: PROMPT }), params(buildId));
        expect(denied.status).toBe(403);
        const deniedQuote = await quoteRoute(req(`/api/builds/${buildId}/text-to-cad/quote`, 'POST', STRANGER, { printMaterialSlug: 'petg', quantity: 1 }), params(buildId));
        expect(deniedQuote.status).toBe(403);
    });

    it('the owner gets the honest unavailable answer (200) without a model key', async () => {
        const created = await (async () => {
            process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'k';
            resetEnvCache();
            try {
                return await (await createRoute(req('/api/text-to-cad', 'POST', OWNER, { prompt: PROMPT }), { params: Promise.resolve({}) })).json();
            } finally {
                delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
                resetEnvCache();
            }
        })();
        const res = await makeRoute(req(`/api/builds/${created.buildId}/text-to-cad`, 'POST', OWNER, { prompt: PROMPT }), params(created.buildId));
        expect(res.status).toBe(200);
        expect(MakeIt3dResponse.parse(await res.json())).toMatchObject({ status: 'unavailable' });
    });
});
