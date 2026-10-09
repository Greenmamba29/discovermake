/**
 * CAD agent eval runner (backlog 100-4).
 *
 *   bun run eval:cad                     live when a provider key is set, else offline
 *   bun run eval:cad --offline           replay the recorded proposals (what CI runs, via vitest)
 *   bun run eval:cad --live --cases pi-enclosure,z-bracket
 *   bun run eval:cad --no-dfm            skip the R1 quote engine (no database needed)
 *   bun run eval:cad --out .data/evals/cad
 *
 * Providers (live mode; unavailable ones are skipped and listed in the scorecard):
 *   google     GOOGLE_GENERATIVE_AI_API_KEY   model CAD_EVAL_GOOGLE_MODEL | MAKE_AI_MODEL | gemini-3.5-flash
 *   anthropic  ANTHROPIC_API_KEY + the @ai-sdk/anthropic package   model CAD_EVAL_ANTHROPIC_MODEL
 *   openai     OPENAI_API_KEY + the @ai-sdk/openai package         model CAD_EVAL_OPENAI_MODEL
 *   gateway    AI_GATEWAY_API_KEY (Vercel AI Gateway, built into `ai`)  models CAD_EVAL_GATEWAY_MODELS
 * No package is added for a provider: if it is not installed it is skipped.
 *
 * Worker: the live CAD worker when CAD_WORKER_URL answers /healthz, else the recorded golden
 * output in evals/cad/golden. DFM: a throwaway database (createTestDb, seeded) on the server
 * behind DATABASE_URL; without Postgres the run continues with DFM skipped.
 *
 * Writes <out>/<timestamp>.json + .md and <out>/latest.json + latest.md. Offline mode exits 1
 * unless every case passes.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGateway, type LanguageModel } from 'ai';
import { setDb } from '@/server/db';
import { createTestDb, type TestDb } from '@/server/db/test-db';
import { catalogThicknessHints } from '@/server/cad/estimate';
import { LocalDiskStorage, setStorage } from '@/server/storage';
import { goldenWorker, liveWorker, loadCases, runCadEvals, scorecardMarkdown, type Provider, type Scorecard } from './lib';

type Args = { mode: 'offline' | 'live' | 'auto'; cases: string[] | null; dfm: boolean; out: string; providers: string[] | null };

function parseArgs(argv: string[]): Args {
    const args: Args = { mode: 'auto', cases: null, dfm: true, out: path.resolve('.data/evals/cad'), providers: null };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--offline') args.mode = 'offline';
        else if (a === '--live') args.mode = 'live';
        else if (a === '--no-dfm') args.dfm = false;
        else if (a === '--cases') args.cases = (argv[++i] ?? '').split(',').filter(Boolean);
        else if (a === '--providers') args.providers = (argv[++i] ?? '').split(',').filter(Boolean);
        else if (a === '--out') args.out = path.resolve(argv[++i] ?? args.out);
        else throw new Error(`unknown argument ${a}`);
    }
    return args;
}

/** Optional AI SDK provider packages are loaded by name so a missing one is a skip, not a build error. */
async function optionalProvider(pkg: string, factory: string): Promise<((opts: { apiKey: string }) => (id: string) => LanguageModel) | null> {
    try {
        const mod = (await import(/* @vite-ignore */ pkg)) as Record<string, unknown>;
        return typeof mod[factory] === 'function' ? (mod[factory] as (opts: { apiKey: string }) => (id: string) => LanguageModel) : null;
    } catch {
        return null;
    }
}

export async function resolveProviders(only: string[] | null): Promise<{ providers: Provider[]; skipped: Scorecard['skippedProviders'] }> {
    const env = process.env;
    const providers: Provider[] = [];
    const skipped: Scorecard['skippedProviders'] = [];
    const want = (id: string) => !only || only.includes(id);

    if (want('google')) {
        if (env.GOOGLE_GENERATIVE_AI_API_KEY) {
            const id = env.CAD_EVAL_GOOGLE_MODEL || env.MAKE_AI_MODEL || 'gemini-3.5-flash';
            providers.push({ id: `google:${id}`, label: `Google ${id}`, model: createGoogleGenerativeAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY })(id) });
        } else skipped.push({ id: 'google', reason: 'GOOGLE_GENERATIVE_AI_API_KEY is not set' });
    }
    for (const [name, pkg, factory, keyVar, modelVar, fallback] of [
        ['anthropic', '@ai-sdk/anthropic', 'createAnthropic', 'ANTHROPIC_API_KEY', 'CAD_EVAL_ANTHROPIC_MODEL', 'claude-sonnet-4-5'],
        ['openai', '@ai-sdk/openai', 'createOpenAI', 'OPENAI_API_KEY', 'CAD_EVAL_OPENAI_MODEL', 'gpt-5'],
    ] as const) {
        if (!want(name)) continue;
        const key = env[keyVar];
        if (!key) {
            skipped.push({ id: name, reason: `${keyVar} is not set` });
            continue;
        }
        const create = await optionalProvider(pkg, factory);
        if (!create) {
            skipped.push({ id: name, reason: `${pkg} is not installed (not added on purpose; use the gateway provider instead)` });
            continue;
        }
        const id = env[modelVar] || fallback;
        providers.push({ id: `${name}:${id}`, label: `${name} ${id}`, model: create({ apiKey: key })(id) });
    }
    if (want('gateway')) {
        if (env.AI_GATEWAY_API_KEY) {
            const gw = createGateway({ apiKey: env.AI_GATEWAY_API_KEY });
            for (const id of (env.CAD_EVAL_GATEWAY_MODELS || 'anthropic/claude-sonnet-4.5,openai/gpt-5').split(',').map((s) => s.trim()).filter(Boolean)) {
                providers.push({ id: `gateway:${id}`, label: `AI Gateway ${id}`, model: gw(id) });
            }
        } else skipped.push({ id: 'gateway', reason: 'AI_GATEWAY_API_KEY is not set' });
    }
    return { providers, skipped };
}

async function workerHealthy(): Promise<boolean> {
    const url = process.env.CAD_WORKER_URL;
    if (!url) return false;
    try {
        return (await fetch(new URL('/healthz', url), { signal: AbortSignal.timeout(2000) })).ok;
    } catch {
        return false;
    }
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const all = loadCases();
    const cases = args.cases ? all.filter((c) => args.cases!.includes(c.id)) : all;
    if (!cases.length) throw new Error('no eval cases selected');

    const resolved = await resolveProviders(args.providers);
    const offline = args.mode === 'offline' || (args.mode === 'auto' && resolved.providers.length === 0);
    if (args.mode === 'live' && resolved.providers.length === 0) throw new Error(`--live needs a provider: ${resolved.skipped.map((s) => `${s.id} (${s.reason})`).join('; ')}`);
    const providers: Provider[] = offline ? [{ id: 'recorded', label: 'Recorded proposals', model: null }] : resolved.providers;

    const live = await workerHealthy();
    const worker = live ? liveWorker() : goldenWorker();
    console.log(`[eval:cad] ${offline ? 'offline' : 'live'} · ${cases.length} cases · providers: ${providers.map((p) => p.id).join(', ')} · worker: ${live ? process.env.CAD_WORKER_URL : 'golden'}`);

    let testDb: TestDb | null = null;
    let withDfm = args.dfm;
    const storageDir = mkdtempSync(path.join(os.tmpdir(), 'dm-eval-cad-'));
    setStorage(new LocalDiskStorage({ rootDir: storageDir, appUrl: 'http://localhost:3000', signingSecret: 'eval-storage-secret' }));
    if (withDfm) {
        try {
            testDb = await createTestDb({ seed: true });
            setDb(testDb.db);
        } catch (err) {
            console.warn(`[eval:cad] DFM skipped: no database (${(err as Error).message})`);
            withDfm = false;
        }
    }
    try {
        const hints = testDb && !offline ? await catalogThicknessHints() : undefined;
        const card = await runCadEvals({ cases, providers, skipped: offline ? [] : resolved.skipped, worker, offline, withDfm, hints });
        mkdirSync(args.out, { recursive: true });
        const stamp = card.startedAt.replace(/[:.]/g, '-');
        const md = scorecardMarkdown(card);
        for (const name of [stamp, 'latest']) {
            writeFileSync(path.join(args.out, `${name}.json`), `${JSON.stringify(card, null, 2)}\n`);
            writeFileSync(path.join(args.out, `${name}.md`), md);
        }
        for (const p of card.providers) console.log(`[eval:cad] ${p.label}: ${p.passed}/${p.cases} passed (${p.passRate}%) · compiles ${p.compiles} · DFM ${p.dfm} · traceable ${p.traceable}`);
        for (const s of card.skippedProviders) console.log(`[eval:cad] skipped ${s.id}: ${s.reason}`);
        for (const r of card.results.filter((x) => !x.pass)) console.log(`[eval:cad] FAIL ${r.provider} ${r.caseId} (${r.status}): ${r.notes.join('; ')}`);
        console.log(`[eval:cad] scorecard: ${path.join(args.out, 'latest.md')}`);
        if (offline && card.providers.some((p) => p.passed !== p.cases)) process.exitCode = 1;
    } finally {
        setDb(null);
        setStorage(null);
        await testDb?.drop();
        rmSync(storageDir, { recursive: true, force: true });
    }
}

if ((import.meta as ImportMeta & { main?: boolean }).main) {
    main().catch((err) => {
        console.error('[eval:cad]', err);
        process.exit(1);
    });
}
