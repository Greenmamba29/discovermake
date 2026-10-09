/**
 * CAD evals, offline mode (backlog 100-4) in CI: every recorded proposal in evals/cad/cases.json
 * goes through guardProposal -> CadSpec -> the CAD worker (its recorded golden output, or the
 * live worker when CAD_WORKER_URL is healthy) -> the R1 analyzer + quote engine. Every case must
 * pass: right outcome, and for generated specs "compiles + passes DFM + traceable".
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MockLanguageModelV4 } from 'ai/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CadSpec } from '@/contracts/cad';
import { buyerNumbers, guardProposal, CadProposal } from '@/server/cad/agent';
import { LocalDiskStorage, setStorage } from '@/server/storage';
import { caseView, goldenWorker, liveWorker, loadCases, runCadEvals, sameSpec, scorecardMarkdown, traceIssues, type Scorecard } from '../../evals/cad/lib';
import { resolveProviders } from '../../evals/cad/run';
import { textResult } from '../build-graph/fixtures';
import { liveWorker as liveWorkerFetch } from '../support/cad-golden-worker';
import { useTestDb as withTestDb } from '../support/db';

withTestDb({ seed: true });
const cases = loadCases();
let storageDir = '';
let card: Scorecard;

beforeAll(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), 'dm-evals-'));
    setStorage(new LocalDiskStorage({ rootDir: storageDir, appUrl: 'http://localhost:3100', signingSecret: 'test-storage-secret' }));
    const live = await liveWorkerFetch();
    card = await runCadEvals({ cases, providers: [{ id: 'recorded', label: 'Recorded proposals', model: null }], worker: live ? liveWorker(live) : goldenWorker(), offline: true, withDfm: true });
}, 120_000);

afterAll(async () => {
    setStorage(null);
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
});

describe('CAD eval fixtures', () => {
    it('has at least 12 prompts covering every family and both refusal paths', () => {
        expect(cases.length).toBeGreaterThanOrEqual(12);
        const families = new Set(cases.map((c) => c.expected.family).filter(Boolean));
        expect([...families].sort()).toEqual(['enclosure', 'l_bracket', 'multi_bend_bracket', 'sheet_enclosure', 'sheet_panel', 'slotted_plate', 'u_channel']);
        expect(cases.filter((c) => c.expected.status === 'needs_input').length).toBeGreaterThanOrEqual(2);
        expect(cases.filter((c) => c.expected.status === 'not_supported').length).toBeGreaterThanOrEqual(2);
        expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    });

    it.each(cases.map((c) => [c.id, c] as const))('%s: recorded proposal, buyer numbers and expected spec agree', async (_id, c) => {
        expect(CadProposal.safeParse(c.recorded).success).toBe(true);
        const view = caseView(c);
        const supplied = [...buyerNumbers(view.nodes).values()].flat();
        for (const n of c.buyer_numbers) expect(supplied.some((s) => Math.abs(s - n) <= 1e-6), `buyer number ${n}`).toBe(true);
        const guarded = guardProposal(CadProposal.parse(c.recorded), view);
        expect(guarded.status).toBe(c.expected.status);
        if (guarded.status === 'ready') {
            expect(c.expected_spec).toBeDefined();
            expect(sameSpec(guarded.spec, CadSpec.parse(c.expected_spec))).toBe(true);
            expect(traceIssues(guarded.spec, view)).toEqual([]);
            const golden = JSON.parse(await readFile(path.join(__dirname, '../../evals/cad/golden', `${c.id}.json`), 'utf8')) as { family: string };
            expect(golden.family).toBe(guarded.spec.family);
        }
    });
});

describe('CAD evals, offline (recorded proposals)', () => {
    it('scores every case as passing: compiles + passes DFM + traceable, or the right refusal', () => {
        const failures = card.results.filter((r) => !r.pass).map((r) => `${r.caseId}: ${r.status} ${r.notes.join('; ')}`);
        expect(failures).toEqual([]);
        expect(card.providers[0]).toMatchObject({ cases: cases.length, passed: cases.length, passRate: 100 });
    });

    it('quotes every sheet family BINDING and marks printed parts n/a', () => {
        for (const r of card.results.filter((x) => x.status === 'ready')) {
            const c = cases.find((x) => x.id === r.caseId)!;
            expect(r.compiles, r.caseId).toBe(true);
            if (c.expected.family === 'enclosure') expect(r.dfm).toBe('n/a');
            else {
                expect(r.dfm, `${r.caseId}: ${r.notes.join('; ')}`).toBe(true);
                expect(r.makeabilityScore).toBeGreaterThanOrEqual(60);
            }
        }
    });

    it('reports dropped features instead of inventing them', () => {
        expect(card.results.find((r) => r.caseId === 'u-channel-invented-hole')).toMatchObject({ pass: true, dropped: 1 });
    });

    it('runs live mode through the real CAD agent call (mock model) and scores it the same way', async () => {
        const c = cases.find((x) => x.id === 'z-bracket')!;
        const model = new MockLanguageModelV4({ provider: 'test', modelId: 'cad-eval-mock', doGenerate: async () => textResult(JSON.stringify(c.recorded)) });
        const live = await runCadEvals({ cases: [c], providers: [{ id: 'mock:cad', label: 'Mock', model }], worker: goldenWorker(), offline: false, withDfm: true, hints: ['Mild steel: 1.52 mm'] });
        expect(live).toMatchObject({ mode: 'live', providers: [{ id: 'mock:cad', passed: 1, cases: 1 }] });
    });

    it('renders a markdown scorecard', () => {
        const md = scorecardMarkdown(card);
        expect(md).toContain('# CAD agent evals (offline)');
        expect(md).toContain(`| Recorded proposals | ${cases.length}/${cases.length} (100%)`);
        for (const c of cases) expect(md).toContain(`| ${c.id} |`);
    });
});

describe('eval providers', () => {
    const KEYS = ['GOOGLE_GENERATIVE_AI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'AI_GATEWAY_API_KEY'] as const;
    const saved: Partial<Record<(typeof KEYS)[number], string>> = {};
    beforeAll(() => {
        for (const k of KEYS) {
            saved[k] = process.env[k];
            delete process.env[k];
        }
    });
    afterAll(() => {
        for (const k of KEYS) if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    });

    it('skips every provider without a key (offline mode then replays recordings)', async () => {
        const { providers, skipped } = await resolveProviders(null);
        expect(providers).toEqual([]);
        expect(skipped.map((s) => s.id)).toEqual(['google', 'anthropic', 'openai', 'gateway']);
    });

    it('uses Google and the AI Gateway when keyed, and skips SDK providers that are not installed', async () => {
        process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-google-key';
        process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
        process.env.AI_GATEWAY_API_KEY = 'test-gateway-key';
        try {
            const { providers, skipped } = await resolveProviders(null);
            expect(providers.map((p) => p.id)).toEqual(expect.arrayContaining([expect.stringMatching(/^google:/), 'gateway:anthropic/claude-sonnet-4.5', 'gateway:openai/gpt-5']));
            expect(skipped.find((s) => s.id === 'anthropic')?.reason).toMatch(/not installed|not set/);
        } finally {
            for (const k of KEYS) delete process.env[k];
        }
    });
});
