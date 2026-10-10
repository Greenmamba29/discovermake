/**
 * Workflow 01 acceptance test (spec 7.10, backlog 100-5).
 *
 * Input: "Make me a weatherproof outdoor enclosure for a Raspberry Pi with a solar battery."
 * The system must PERSIST all eleven artifacts:
 *    1 structured requirements     REQUIREMENT nodes (Make AI + the buyer's answers)
 *    2 missing-info list           UNKNOWN nodes (open in v1, answered later)
 *    3 part decomposition          PART nodes under part:main (panels + purchased hardware)
 *    4 materials                   MATERIAL nodes (Materials Engineer recommendation)
 *    5 initial CAD                 STEP + GLB + one DXF per panel, stored with sha256
 *    6 preliminary BOM             part:main data.bom + bom.json / bom.csv artifacts
 *    7 process recommendation      PROCESS nodes REQUIRED by part:main
 *    8 Makeability score           quote:preliminary (R1 DFM, every panel quoted)
 *    9 price range                 quote:preliminary priceRange (BINDING quotes)
 *   10 production time             quote:preliminary productionDays
 *   11 a persistent Build          builds row + linear design versions + domain events
 *
 * The models are replaced by their recorded structured outputs (intake, Materials Engineer,
 * CAD agent). The CAD worker is the real one when CAD_WORKER_URL points at a healthy worker,
 * otherwise its recorded output for this exact spec (tests/fixtures/cad/acceptance, written by
 * `python -m cad_worker.golden`; the worker's own acceptance test regenerates and checks it).
 */
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MockLanguageModelV4 } from 'ai/test';
import { asc, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BgNode, BuildGraphView } from '@/contracts/build-graph';
import { BuildCadEstimate, type BuildCadGenerated } from '@/contracts/cad';
import { answerUnknowns, approveVersion, getGraph, MAIN_PART_KEY } from '@/server/build-graph';
import { generateBuildCad, getBuildCad, PRELIMINARY_QUOTE_KEY } from '@/server/cad/build-cad';
import { builds, designVersions, domainEvents, quotes } from '@/server/db/schema';
import { resetEnvCache } from '@/server/env';
import { createBuildFromIntent } from '@/server/make-ai/builds';
import { runIntake } from '@/server/make-ai/intake';
import { getStorage, LocalDiskStorage, setStorage } from '@/server/storage';
import { ENCLOSURE_INTENT, materialAnswer, textResult } from '../build-graph/fixtures';
import { goldenDirWorker, liveWorker } from '../support/cad-golden-worker';
import { useTestDb as withTestDb } from '../support/db';

const ctx = withTestDb({ seed: true });
const PROMPT = 'Make me a weatherproof outdoor enclosure for a Raspberry Pi with a solar battery.';
const GOLDEN_DIR = path.join(__dirname, '../fixtures/cad/acceptance');

/** What the CAD agent's model proposed for the answered build (recorded structured output). */
const CAD_PROPOSAL = {
    family: 'sheet_enclosure',
    inner_x_mm: 180,
    inner_y_mm: 120,
    inner_z_mm: 70,
    thickness_mm: 1.6,
    inside_bend_radius_mm: 1.6,
    gland_diameter_mm: 12.5,
    dimension_sources: [
        { param: 'inner_x_mm', node_key: 'req:ans_U1' },
        { param: 'inner_y_mm', node_key: 'req:ans_U1' },
        { param: 'inner_z_mm', node_key: 'req:ans_U1' },
    ],
    missing_inputs: [],
    rationale: 'Outdoor metal box: a bent aluminium enclosure the partner shops can laser cut and bend, sized to the stated cavity.',
};

const model = (output: unknown, id = 'gemini-test-flash') => new MockLanguageModelV4({ provider: 'google.generative-ai', modelId: id, doGenerate: async () => textResult(JSON.stringify(output)) });

let storageDir = '';
let savedWorkerUrl: string | undefined;
let buildId = '';
let v1: BuildGraphView;
let cad: BuildCadGenerated;
let finalView: BuildGraphView;
let usedLiveWorker = false;

beforeAll(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), 'dm-wf01-'));
    setStorage(new LocalDiskStorage({ rootDir: storageDir, appUrl: 'http://localhost:3100', signingSecret: 'test-storage-secret' }));
    const live = await liveWorker();
    usedLiveWorker = Boolean(live);
    savedWorkerUrl = process.env.CAD_WORKER_URL;
    if (!live) process.env.CAD_WORKER_URL = 'http://cad-worker.golden.test';
    resetEnvCache();

    // Describe -> CreationIntent (persisted) -> Continue to Build (Materials Engineer runs first).
    const intake = await runIntake(PROMPT, { model: model(ENCLOSURE_INTENT) });
    const created = await createBuildFromIntent(intake.intentId, { model: model(materialAnswer(), 'gemini-test-materials') });
    buildId = created.buildId;
    v1 = (await getGraph(buildId, 1))!;

    // The buyer answers the NEEDS_INPUT questions, approves, and asks for CAD.
    const unknowns = v1.nodes.filter((n) => n.type === 'UNKNOWN');
    const answers = unknowns.map((u) => ({
        unknownKey: u.key,
        value: u.data.topic === 'quantity' ? '10' : 'Inside 180 x 120 x 70 mm, 1.6 mm aluminium sheet, with a 12.5 mm cable gland hole',
    }));
    const answered = await answerUnknowns(buildId, answers);
    await approveVersion(buildId, answered.version.version);
    const res = await generateBuildCad(buildId, { model: model(CAD_PROPOSAL, 'gemini-test-cad'), fetchImpl: live ?? goldenDirWorker(GOLDEN_DIR) });
    if (res.status !== 'generated') throw new Error(`CAD was not generated: ${JSON.stringify(res)}`);
    cad = res;
    finalView = (await getGraph(buildId))!;
}, 120_000);

afterAll(async () => {
    if (savedWorkerUrl === undefined) delete process.env.CAD_WORKER_URL;
    else process.env.CAD_WORKER_URL = savedWorkerUrl;
    resetEnvCache();
    setStorage(null);
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
});

const ofType = (view: BuildGraphView, type: BgNode['type']) => view.nodes.filter((n) => n.type === type);
const node = (view: BuildGraphView, key: string) => view.nodes.find((n) => n.key === key);

describe(`workflow 01 acceptance: "${PROMPT}"`, () => {
    it('1 · persists structured requirements (Make AI and the buyer)', () => {
        const reqs = ofType(finalView, 'REQUIREMENT');
        expect(reqs.filter((r) => r.source === 'make_ai').map((r) => r.data.category)).toEqual(expect.arrayContaining(['function', 'environment']));
        const fromBuyer = reqs.filter((r) => r.source === 'user');
        expect(fromBuyer.map((r) => r.data.category).sort()).toEqual(['dimension', 'quantity']);
        expect(finalView.edges.filter((e) => e.type === 'CONSTRAINED_BY' && e.fromKey === 'build:root').length).toBeGreaterThanOrEqual(reqs.length);
    });

    it('2 · persists the missing-info list (open in v1, answered by the buyer since)', () => {
        const open = ofType(v1, 'UNKNOWN');
        expect(open.length).toBeGreaterThanOrEqual(2);
        expect(open.every((u) => u.data.status === 'open' && typeof u.data.question === 'string' && typeof u.data.why === 'string')).toBe(true);
        expect(open.some((u) => u.data.topic === 'dimension')).toBe(true);
        expect(ofType(finalView, 'UNKNOWN').every((u) => u.data.status === 'answered')).toBe(true);
    });

    it('3 · persists the part decomposition (four bent panels + purchased hardware)', () => {
        const items = finalView.nodes.filter((n) => n.type === 'PART' && n.data.role === 'cad_item');
        const panels = items.filter((n) => n.data.kind === 'fabricated');
        expect(panels.map((p) => p.data.file).sort()).toEqual(['body_flat.dxf', 'end_cap_flat.dxf', 'end_cap_gland_flat.dxf', 'lid_flat.dxf']);
        expect(panels.every((p) => typeof p.data.partId === 'string' && p.data.thicknessMm === 1.6)).toBe(true);
        expect(items.filter((n) => n.data.kind === 'purchased').length).toBeGreaterThanOrEqual(4);
        const contained = new Set(finalView.edges.filter((e) => e.type === 'CONTAINS' && e.fromKey === MAIN_PART_KEY).map((e) => e.toKey));
        expect(items.every((n) => contained.has(n.key))).toBe(true);
    });

    it('4 · persists the materials (Materials Engineer recommendation from the catalog)', () => {
        const mats = ofType(finalView, 'MATERIAL');
        const rec = mats.find((m) => m.data.role === 'recommended');
        expect(rec).toMatchObject({ key: 'mat:aluminum-5052', data: { inCatalog: true, suggestedBy: 'materials_engineer' } });
        expect(mats.some((m) => m.data.needsSourcing === true)).toBe(true); // polycarbonate window: needs sourcing, never invented
    });

    it('5 · persists the initial CAD: STEP, GLB and one flat pattern per panel, stored with their sha256', async () => {
        const kinds = cad.artifacts.map((a) => a.kind);
        expect(kinds.filter((k) => k === 'DXF')).toHaveLength(4);
        expect(kinds).toEqual(expect.arrayContaining(['STEP', 'GLB', 'SVG', 'MANIFEST']));
        const record = node(finalView, MAIN_PART_KEY)!.data.cad as { artifacts: { key: string; sha256: string; filename: string }[]; spec: unknown };
        expect(record.spec).toMatchObject({ family: 'sheet_enclosure', inner_x_mm: 180, inner_y_mm: 120, inner_z_mm: 70, gland_diameter_mm: 12.5 });
        for (const a of record.artifacts) {
            const bytes = await getStorage().getObject(a.key);
            expect(bytes, a.filename).not.toBeNull();
            expect(createHash('sha256').update(bytes!).digest('hex')).toBe(a.sha256);
        }
        expect(cad.parts).toHaveLength(4);
        expect(cad.parts?.every((p) => p.status === 'READY')).toBe(true);
        expect(cad.quotable).toBe(true);
        const read = await getBuildCad(buildId);
        expect(read?.artifacts.map((a) => a.filename).sort()).toEqual(cad.artifacts.map((a) => a.filename).sort());
    });

    it('6 · persists the preliminary BOM on the graph and as JSON + CSV', () => {
        const bom = node(finalView, MAIN_PART_KEY)!.data.bom as { kind: string; quantity: number; name: string }[];
        expect(bom.filter((i) => i.kind === 'fabricated')).toHaveLength(4);
        expect(bom.filter((i) => i.kind === 'purchased').map((i) => i.name).join(' ')).toMatch(/rivet[\s\S]*M3[\s\S]*gasket[\s\S]*gland/i);
        expect(cad.artifacts.map((a) => a.filename)).toEqual(expect.arrayContaining(['bom.json', 'bom.csv', 'drawing.svg', 'manifest.json']));
    });

    it('7 · persists the process recommendation (catalog processes required by the part)', () => {
        const required = new Set(finalView.edges.filter((e) => e.type === 'REQUIRES_PROCESS' && e.fromKey === MAIN_PART_KEY).map((e) => e.toKey));
        const procs = ofType(finalView, 'PROCESS').filter((p) => required.has(p.key));
        const inCatalog = procs.filter((p) => p.data.inCatalog === true).map((p) => p.label.toLowerCase());
        expect(inCatalog.some((l) => l.includes('laser'))).toBe(true);
        expect(inCatalog.some((l) => l.includes('brake') || l.includes('bend'))).toBe(true);
        expect((node(finalView, MAIN_PART_KEY)!.data.processes as string[])).toEqual(['laser cutting', 'press brake bending', 'hardware insertion']);
    });

    it('8-10 · persists the Makeability score, a BINDING price range and the production time', async () => {
        const q = node(finalView, PRELIMINARY_QUOTE_KEY)!;
        expect(q).toMatchObject({ type: 'QUOTE', source: 'quote_engine' });
        const estimate = BuildCadEstimate.parse(q.data);
        expect(estimate).toMatchObject({ quantity: 10, quantitySource: 'buyer', trustLevel: 'BINDING', currency: 'usd' });
        expect(estimate.makeabilityScore).toBeGreaterThanOrEqual(70);
        expect(estimate.priceRange.lowCents).toBeGreaterThan(0);
        expect(estimate.priceRange.highCents).toBeGreaterThanOrEqual(estimate.priceRange.lowCents);
        expect(estimate.productionDays.min).toBeGreaterThan(0);
        expect(estimate.productionDays.max).toBeGreaterThanOrEqual(estimate.productionDays.min);
        const recommended = estimate.options.find((o) => o.recommended)!;
        expect(recommended).toMatchObject({ materialSlug: 'aluminum-5052', allBinding: true });
        // Every number comes from real, persisted R1 quotes: one per panel, 10 builds (end cap x1 each).
        const rows = await ctx.db.select().from(quotes).where(inArray(quotes.id, recommended.quoteIds));
        expect(rows).toHaveLength(4);
        expect(rows.every((r) => r.trustLevel === 'BINDING' && r.buildId === buildId)).toBe(true);
        expect(rows.reduce((s, r) => s + r.subtotalCents, 0)).toBe(recommended.totalCents);
        expect(edgesTo(finalView, PRELIMINARY_QUOTE_KEY)).toContain(`QUOTED_AS|${MAIN_PART_KEY}`);
    });

    it('11 · persists the Build with a linear version history and its domain events', async () => {
        const [row] = await ctx.db.select().from(builds).where(eq(builds.id, buildId));
        expect(row).toMatchObject({ origin: 'make_ai', currentVersion: cad.version });
        const versions = await ctx.db.select().from(designVersions).where(eq(designVersions.buildId, buildId)).orderBy(asc(designVersions.version));
        expect(versions.map((v) => [v.version, v.status])).toEqual([
            [1, 'DRAFT'],
            [2, 'APPROVED'],
            [3, 'DRAFT'],
        ]);
        const events = await ctx.db.select({ type: domainEvents.eventType }).from(domainEvents).where(eq(domainEvents.buildId, buildId));
        expect(new Set(events.map((e) => e.type))).toEqual(
            new Set(['build.created', 'design.version_created', 'requirements.generated', 'material.recommended', 'design.version_approved', 'cad.generated', 'makeability.completed', 'quote.preliminary', 'part.uploaded', 'part.analyzed', 'dfm.completed', 'quote.created']),
        );
        if (usedLiveWorker) console.info('[workflow-01] used the live CAD worker');
    });
});

function edgesTo(view: BuildGraphView, key: string): string[] {
    return view.edges.filter((e) => e.toKey === key).map((e) => `${e.type}|${e.fromKey}`);
}
