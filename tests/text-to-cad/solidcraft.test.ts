/**
 * "Make it in 3D" with SolidCraft (TEXT_TO_CAD_ENGINE=solidcraft): a mock model writes a SolidCraft
 * command script, a fake CAD worker answers with the committed goldens (recorded from the real
 * engine by `python -m cad_worker.solidcraft.golden`). Covers the script extraction, the new DRAFT
 * version with the named sizes and the saved design, the repair loop (engine errors AND the gate's
 * rules), changing sizes from the saved design without Make AI (checksums, unknown names, a size the
 * model cannot take), approval before a BINDING quote, and owner-only routes.
 */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MockLanguageModelV4 } from 'ai/test';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MakeIt3dResponse, MakeIt3dStatus } from '@/contracts/make-it-3d';
import { GET as statusRoute } from '@/app/api/builds/[buildId]/text-to-cad/route';
import { POST as sizesRoute } from '@/app/api/builds/[buildId]/text-to-cad/parameters/route';
import { POST as createRoute } from '@/app/api/text-to-cad/route';
import { approveVersion, buildGraphWriteLimiter, getGraph } from '@/server/build-graph';
import { builds, printQuoteDetails } from '@/server/db/schema';
import { resetEnvCache } from '@/server/env';
import { LocalDiskStorage, setStorage } from '@/server/storage';
import { makeIt3dLimiter } from '@/server/text-to-cad/request';
import { extractSolidcraftScript } from '@/server/text-to-cad/solidcraft-script';
import { changeMakeIt3dParameters, createMakeIt3dBuild, getMakeIt3dStatus, makeIn3D, quoteMakeIt3d, textToCadRecordOf } from '@/server/text-to-cad/service';
import { textResult } from '../build-graph/fixtures';
import { useTestDb as withTestDb } from '../support/db';

const FIX = path.join(process.cwd(), 'tests', 'fixtures', 'text-to-cad', 'solidcraft');
const SCRIPT_TEXT = readFileSync(path.join(FIX, 'model.solidcraft.json'), 'utf8');
const SCRIPT = JSON.parse(SCRIPT_TEXT) as { commands: { command: string; params: Record<string, unknown> }[] };
type Golden = {
    engine: { name: 'solidcraft'; version: string };
    artifacts: { kind: 'step' | 'glb' | 'stl'; filename: string; sha256: string; bytes: number }[];
    design: { filename: 'model.sc'; sha256: string; bytes: number };
    geometry: { bbox_mm: [number, number, number]; volume_mm3: number; area_mm2: number; solids: number; sound: boolean };
    parameters: { name: string; expression: string; value: number; unit: string; comment: string }[];
    script?: unknown;
    warnings: string[];
};
const golden = (folder: string) => JSON.parse(readFileSync(path.join(FIX, folder, 'response.json'), 'utf8')) as Golden;
const BUILD = golden('build');
const L80 = golden('rebuild-L80');
const PROMPT = 'A desk cable holder with three slots for charging cables';
const BASE = 'http://localhost:3100';
const OWNER = 'dm_device=solidcraftownerdevice000000000000000001';
const STRANGER = 'dm_device=solidcraftstrangerdevice0000000000002';

const ctx = withTestDb({ seed: true });
let storageDir = '';
let ip = 0;

const req = (url: string, method: string, cookie: string, body?: unknown) =>
    new Request(`${BASE}${url}`, { method, headers: { 'content-type': 'application/json', origin: BASE, 'x-forwarded-for': `198.51.100.${++ip % 250}`, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
const params = (buildId: string) => ({ params: Promise.resolve({ buildId }) });

type Reply = { ok: true; golden?: 'build' | 'rebuild-L80' } | { ok: false; code: string; message: string; violations?: { line: number; rule: string }[] };
type Call = { url: string; body: Record<string, unknown> };
function fakeWorker(replies: Reply[]) {
    const calls: Call[] = [];
    const fn = (async (url: URL | string, init: RequestInit) => {
        calls.push({ url: String(url), body: JSON.parse(String(init.body)) as Record<string, unknown> });
        const reply = replies[Math.min(calls.length - 1, replies.length - 1)]!;
        if (!reply.ok) return new Response(JSON.stringify({ violations: [], ...reply }), { status: 200 });
        const folder = reply.golden ?? (String(url).endsWith('/rebuild') ? 'rebuild-L80' : 'build');
        const g = golden(folder);
        const file = (name: string) => readFileSync(path.join(FIX, folder, name)).toString('base64');
        const artifacts = g.artifacts.map((a) => ({ ...a, content_base64: file(a.filename) }));
        const design = { ...g.design, content_base64: file(g.design.filename) };
        return new Response(JSON.stringify({ ...g, artifacts, design }), { status: 200 });
    }) as unknown as typeof fetch;
    return Object.assign(fn, { calls });
}

function scriptModel(prompts: string[] = [], replies: string[] = [SCRIPT_TEXT]) {
    let n = 0;
    return new MockLanguageModelV4({
        doGenerate: async (options) => {
            prompts.push(JSON.stringify(options.prompt));
            const text = replies[Math.min(n++, replies.length - 1)]!;
            return textResult(`Here is the model:\n\n\`\`\`json\n${text}\`\`\`\n`);
        },
    });
}

async function made(owner: { ownerUserId: string | null; deviceHash: string | null } = { ownerUserId: null, deviceHash: null }) {
    const { buildId } = await createMakeIt3dBuild(PROMPT, owner);
    const res = await makeIn3D(buildId, PROMPT, { model: scriptModel(), fetchImpl: fakeWorker([{ ok: true }]) });
    expect(res.status).toBe('generated');
    return buildId;
}

beforeAll(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), 'dm-solidcraft-'));
    setStorage(new LocalDiskStorage({ rootDir: storageDir, appUrl: BASE, signingSecret: 'test-storage-secret' }));
    process.env.CAD_WORKER_URL = 'http://cad-worker.test';
    process.env.MAKE_AI_ENABLED = 'true';
    process.env.TEXT_TO_CAD_ENGINE = 'solidcraft';
    resetEnvCache();
});
afterAll(async () => {
    for (const k of ['CAD_WORKER_URL', 'MAKE_AI_ENABLED', 'TEXT_TO_CAD_ENGINE', 'GOOGLE_GENERATIVE_AI_API_KEY']) delete process.env[k];
    resetEnvCache();
    setStorage(null);
    vi.unstubAllGlobals();
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
});
beforeEach(async () => {
    await makeIt3dLimiter.reset();
    await buildGraphWriteLimiter.reset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('extractSolidcraftScript', () => {
    it('takes the fenced json block that is a command script, or bare JSON, and nothing else', () => {
        expect(extractSolidcraftScript(`Sure!\n\`\`\`json\n${SCRIPT_TEXT}\`\`\``)).toEqual(SCRIPT);
        expect(extractSolidcraftScript(SCRIPT_TEXT)).toEqual(SCRIPT);
        expect(extractSolidcraftScript(JSON.stringify(SCRIPT.commands))).toEqual(SCRIPT);
        expect(extractSolidcraftScript('```json\n{"commands": []}\n```')).toBeNull();
        expect(extractSolidcraftScript('```json\n{"commands": [{"command": "solid.box", "params": {}, "extra": 1}]}\n```')).toBeNull();
        expect(extractSolidcraftScript('```python\nprint(1)\n```')).toBeNull();
        expect(extractSolidcraftScript('')).toBeNull();
    });
});

describe('Make it in 3D with SolidCraft', () => {
    it('builds the script in the worker and stores a NEW DRAFT version with its sizes and saved design', async () => {
        const { buildId } = await createMakeIt3dBuild(PROMPT, { ownerUserId: null, deviceHash: null });
        const worker = fakeWorker([{ ok: true }]);
        const prompts: string[] = [];
        const res = MakeIt3dResponse.parse(await makeIn3D(buildId, PROMPT, { model: scriptModel(prompts), fetchImpl: worker }));
        expect(res.status).toBe('generated');
        if (res.status !== 'generated') return;
        expect(worker.calls.map((c) => c.url)).toEqual(['http://cad-worker.test/v1/solidcraft/build']);
        expect(worker.calls[0]!.body).toEqual({ script: SCRIPT, outputs: ['step', 'glb', 'stl'] });
        // SolidCraft's guide is the model's instructions; the description is data.
        expect(prompts[0]).toContain('with SolidCraft (read first; these win)');
        expect(prompts[0]).toContain('SolidCraft command reference for agents');
        expect(prompts[0]).toContain(PROMPT);

        expect(res.record).toMatchObject({ version: 2, engine: { name: 'solidcraft', version: '0.48.1' }, origin: 'make_ai', changes: [] });
        expect(res.record.parameters.map((p) => [p.name, p.expression, p.comment])).toEqual([
            ['L', '60 mm', 'overall length'],
            ['W', '24 mm', 'depth front to back'],
            ['H', '18 mm', 'height'],
            ['slot', '5 mm', 'cable slot width'],
            ['pitch', '16 mm', 'distance between slots'],
        ]);
        const record = textToCadRecordOf((await getGraph(buildId))!)!;
        expect(record.geometry.bbox_mm).toEqual([60, 24, 18]);
        expect(record.scriptKey).toBe(`builds/${buildId}/cad/v2/model.solidcraft.json`);
        expect(JSON.parse(await readFile(path.join(storageDir, record.scriptKey), 'utf8'))).toEqual(SCRIPT);
        expect(record.design).toEqual({ key: `builds/${buildId}/cad/v2/model.sc`, sha256: BUILD.design.sha256, bytes: BUILD.design.bytes });
        const design = await readFile(path.join(storageDir, record.design!.key));
        expect(createHash('sha256').update(design).digest('hex')).toBe(BUILD.design.sha256);
        expect(record.minWallMm).toBeGreaterThan(1);
    });

    it('repairs from the engine error and from the gate, with the step that failed', async () => {
        const { buildId } = await createMakeIt3dBuild(PROMPT, { ownerUserId: null, deviceHash: null });
        const prompts: string[] = [];
        const worker = fakeWorker([
            { ok: false, code: 'GATE_REJECTED', message: 'not allowed', violations: [{ line: 3, rule: '`file.export` is not a modelling command this service runs' }] },
            { ok: false, code: 'BUILD_FAILED', message: 'Step 7 (solid.fillet): no edge at [30, 12, 9]: the nearest edge is 9.000 mm away' },
            { ok: true },
        ]);
        const res = await makeIn3D(buildId, PROMPT, { model: scriptModel(prompts), fetchImpl: worker });
        expect(res.status).toBe('generated');
        expect(worker.calls).toHaveLength(3);
        expect(prompts[1]).toContain('step 3: `file.export` is not a modelling command');
        expect(prompts[2]).toContain('Step 7 (solid.fillet): no edge at [30, 12, 9]');
        expect(textToCadRecordOf((await getGraph(buildId))!)!.attempts).toBe(3);
    });

    it('a reply that is not a command script is a plain failure, and nothing reaches the worker', async () => {
        const { buildId } = await createMakeIt3dBuild(PROMPT, { ownerUserId: null, deviceHash: null });
        const worker = fakeWorker([{ ok: true }]);
        const res = await makeIn3D(buildId, PROMPT, { model: scriptModel([], ['{"commands": "rm -rf /"}']), fetchImpl: worker });
        expect(res).toMatchObject({ status: 'failed', code: 'BUILD_FAILED', detail: 'Make AI did not write a model.' });
        expect(worker.calls).toHaveLength(0);
    });
});

describe('Changing sizes', () => {
    it('rebuilds the SAVED DESIGN with the new values, without Make AI, as a new DRAFT version', async () => {
        const buildId = await made();
        const worker = fakeWorker([{ ok: true }]);
        const res = MakeIt3dResponse.parse(await changeMakeIt3dParameters(buildId, { changes: { L: '80 mm', W: '24 mm' } }, { fetchImpl: worker }));
        expect(res.status).toBe('generated');
        if (res.status !== 'generated') return;
        // Only the real change is sent; the design goes back byte for byte with the worker's checksum.
        expect(worker.calls.map((c) => c.url)).toEqual(['http://cad-worker.test/v1/solidcraft/rebuild']);
        const body = worker.calls[0]!.body as { design: { content_base64: string; sha256: string }; parameters: Record<string, string> };
        expect(body.parameters).toEqual({ L: '80 mm' });
        expect(body.design.sha256).toBe(BUILD.design.sha256);
        expect(createHash('sha256').update(Buffer.from(body.design.content_base64, 'base64')).digest('hex')).toBe(BUILD.design.sha256);

        expect(res.record).toMatchObject({ version: 3, origin: 'parameters', changes: [{ name: 'L', from: '60 mm', to: '80 mm' }] });
        expect(res.record.geometry.bbox_mm).toEqual([80, 24, 18]);
        expect(res.record.parameters.find((p) => p.name === 'L')!.expression).toBe('80 mm');
        const view = (await getGraph(buildId))!;
        expect(view.version).toMatchObject({ version: 3, status: 'DRAFT' });
        const record = textToCadRecordOf(view)!;
        expect(record.design!.sha256).toBe(L80.design.sha256);
        // The script that made the design is kept unchanged with the version.
        expect(JSON.parse(await readFile(path.join(storageDir, record.scriptKey), 'utf8'))).toEqual(SCRIPT);
        // The next change opens the NEW design.
        const again = fakeWorker([{ ok: true }]);
        await changeMakeIt3dParameters(buildId, { changes: { H: '20 mm' } }, { fetchImpl: again });
        expect((again.calls[0]!.body as { design: { sha256: string } }).design.sha256).toBe(L80.design.sha256);
    });

    it('refuses unknown names, no change, a tampered design, and a cadgen model', async () => {
        const buildId = await made();
        const worker = fakeWorker([{ ok: true }]);
        await expect(changeMakeIt3dParameters(buildId, { changes: { depth: '30 mm' } }, { fetchImpl: worker })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
        await expect(changeMakeIt3dParameters(buildId, { changes: { L: '60  mm' } }, { fetchImpl: worker })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: expect.stringContaining('Nothing changed') });
        await expect(changeMakeIt3dParameters(buildId, { changes: { L: '80 mm; drop' } }, { fetchImpl: worker })).rejects.toThrow();
        const record = textToCadRecordOf((await getGraph(buildId))!)!;
        await writeFile(path.join(storageDir, record.design!.key), Buffer.from('PK\u0003\u0004tampered'));
        await expect(changeMakeIt3dParameters(buildId, { changes: { L: '80 mm' } }, { fetchImpl: worker })).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('checksums') });
        expect(worker.calls).toHaveLength(0);
    });

    it("a size the model can't take comes back in the engine's words; nothing is written", async () => {
        const buildId = await made();
        const msg = 'Corners: not supported yet: the fillet is larger than the faces beside its edges allow; the largest radius that fits is 2.5 mm';
        const res = await changeMakeIt3dParameters(buildId, { changes: { L: '5 mm' } }, { fetchImpl: fakeWorker([{ ok: false, code: 'BUILD_FAILED', message: msg }]) });
        expect(res).toMatchObject({ status: 'failed', code: 'BUILD_FAILED', detail: msg, attempts: 1 });
        expect((await getGraph(buildId))!.version.version).toBe(2);
    });

    it('the new version must be approved, then quotes BINDING from its own STL', async () => {
        const buildId = await made();
        await approveVersion(buildId, 2);
        await changeMakeIt3dParameters(buildId, { changes: { L: '80 mm' } }, { fetchImpl: fakeWorker([{ ok: true }]) });
        expect((await getMakeIt3dStatus(buildId)).quotable).toBe(false);
        await expect(quoteMakeIt3d(buildId, { printMaterialSlug: 'petg', quantity: 1 })).rejects.toMatchObject({ code: 'CONFLICT' });
        await approveVersion(buildId, 3);
        const quote = await quoteMakeIt3d(buildId, { printMaterialSlug: 'petg', quantity: 1 });
        expect(quote).toMatchObject({ trustLevel: 'BINDING', status: 'READY' });
        const [details] = await ctx.db.select().from(printQuoteDetails).where(eq(printQuoteDetails.quoteId, quote.id));
        expect(details).toMatchObject({ family: 'text_to_cad', stlSha256: L80.artifacts.find((a) => a.kind === 'stl')!.sha256 });
        expect((details!.geometry as { bboxMm: number[] }).bboxMm).toEqual([80, 24, 18]);
        expect(details!.notes).toEqual(expect.arrayContaining([expect.stringContaining('the buyer changed sizes (L 60 mm -> 80 mm)')]));
    });
});

describe('Changing sizes: route', () => {
    it('only the owner may change sizes; the owner gets 201 and the status shows the change', async () => {
        process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'k';
        resetEnvCache();
        let buildId = '';
        try {
            buildId = (await (await createRoute(req('/api/text-to-cad', 'POST', OWNER, { prompt: PROMPT }), { params: Promise.resolve({}) })).json()).buildId;
        } finally {
            delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
            resetEnvCache();
        }
        expect((await makeIn3D(buildId, PROMPT, { model: scriptModel(), fetchImpl: fakeWorker([{ ok: true }]) })).status).toBe('generated');
        const worker = fakeWorker([{ ok: true }]);
        vi.stubGlobal('fetch', worker);
        try {
            const denied = await sizesRoute(req(`/api/builds/${buildId}/text-to-cad/parameters`, 'POST', STRANGER, { changes: { L: '80 mm' } }), params(buildId));
            expect(denied.status).toBe(403);
            const bad = await sizesRoute(req(`/api/builds/${buildId}/text-to-cad/parameters`, 'POST', OWNER, { changes: {} }), params(buildId));
            expect(bad.status).toBe(400);
            expect(worker.calls).toHaveLength(0);
            const ok = await sizesRoute(req(`/api/builds/${buildId}/text-to-cad/parameters`, 'POST', OWNER, { changes: { L: '80 mm' } }), params(buildId));
            expect(ok.status).toBe(201);
            expect(MakeIt3dResponse.parse(await ok.json())).toMatchObject({ status: 'generated', version: 3 });
        } finally {
            vi.unstubAllGlobals();
        }
        const status = MakeIt3dStatus.parse(await (await statusRoute(req(`/api/builds/${buildId}/text-to-cad`, 'GET', OWNER), params(buildId))).json());
        expect(status.record).toMatchObject({ version: 3, origin: 'parameters', changes: [{ name: 'L', from: '60 mm', to: '80 mm' }] });
        const [row] = await ctx.db.select().from(builds).where(eq(builds.id, buildId));
        expect(row!.deviceHash).toEqual(expect.any(String));
    });
});
