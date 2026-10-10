/**
 * Load test for the hot paths (GA hardening): readiness, catalog, and the full
 * instant-quote flow (create part → upload DXF → analyze → quote).
 *
 *   bun scripts/load/run.ts --base http://localhost:3000 --duration 30 --concurrency 20
 *   bun scripts/load/run.ts --scenario quote --concurrency 5 --duration 60
 *
 * Prints p50/p95/p99 latency, throughput and error rate per scenario and exits 1 when a
 * scenario misses its SLO. `--spoof-ip` sends a distinct X-Forwarded-For per virtual user
 * so per-IP rate limits measure capacity instead of throttling (only use it against
 * your own staging/local servers). 429s are reported separately from errors.
 */
import { sampleBracketDxf } from '../../src/lib/sample-dxf';

type Scenario = 'health' | 'catalog' | 'quote';
type Slo = { p95Ms: number; maxErrorRate: number };

const SLO: Record<Scenario, Slo> = {
    health: { p95Ms: 200, maxErrorRate: 0.001 },
    catalog: { p95Ms: 300, maxErrorRate: 0.001 },
    quote: { p95Ms: 3000, maxErrorRate: 0.01 },
};

function arg(name: string, fallback: string): string {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}
const BASE = arg('base', process.env.LOAD_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const DURATION_S = Number(arg('duration', '20'));
const CONCURRENCY = Number(arg('concurrency', '10'));
const ONLY = arg('scenario', 'all');
const SPOOF = process.argv.includes('--spoof-ip');
const DXF = new TextEncoder().encode(sampleBracketDxf());

class HttpError extends Error {
    constructor(public status: number, message: string) {
        super(message);
    }
}

/**
 * One cookie jar per virtual user, like a browser: parts belong to the `dm_device` cookie that
 * `POST /api/parts` sets, and the upload/analyze/quote calls must send it back (else 403).
 */
const jars = new Map<number, Map<string, string>>();

async function call(path: string, init: RequestInit, vu: number): Promise<Response> {
    const headers = new Headers(init.headers);
    if (SPOOF) headers.set('x-forwarded-for', `10.${(vu >> 8) & 255}.${vu & 255}.${1 + (vu % 250)}`);
    const jar = jars.get(vu) ?? new Map<string, string>();
    jars.set(vu, jar);
    if (jar.size > 0) headers.set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
    const res = await fetch(`${BASE}${path}`, { ...init, headers });
    for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(';');
        const eq = pair.indexOf('=');
        if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    if (!res.ok) throw new HttpError(res.status, `${init.method ?? 'GET'} ${path} -> ${res.status}`);
    return res;
}

const jsonInit = (body: unknown): RequestInit => ({
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify(body),
});

const RUNNERS: Record<Scenario, (vu: number) => Promise<void>> = {
    health: async (vu) => {
        await (await call('/api/health', {}, vu)).arrayBuffer();
    },
    catalog: async (vu) => {
        await (await call('/api/catalog', {}, vu)).arrayBuffer();
    },
    quote: async (vu) => {
        const part = await (await call('/api/parts', jsonInit({ filename: `load-${vu}.dxf`, sizeBytes: DXF.byteLength }), vu)).json();
        await (await call(`/api/parts/${part.partId}/upload`, { method: 'POST', headers: { 'content-type': 'application/dxf', origin: BASE }, body: DXF }, vu)).arrayBuffer();
        await (await call(`/api/parts/${part.partId}/analyze`, jsonInit({}), vu)).arrayBuffer();
        await (
            await call('/api/quotes', jsonInit({ partId: part.partId, materialId: 'mat_al_6061', thicknessOptionId: 'thk_al6061_090', quantity: 10 }), vu)
        ).arrayBuffer();
    },
};

function pct(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

async function runScenario(name: Scenario) {
    const latencies: number[] = [];
    let errors = 0;
    let throttled = 0;
    const errorSamples = new Set<string>();
    const deadline = Date.now() + DURATION_S * 1000;
    const started = Date.now();
    await Promise.all(
        Array.from({ length: CONCURRENCY }, async (_, vu) => {
            while (Date.now() < deadline) {
                const t0 = performance.now();
                try {
                    await RUNNERS[name](vu);
                    latencies.push(performance.now() - t0);
                } catch (err) {
                    if (err instanceof HttpError && err.status === 429) throttled++;
                    else {
                        errors++;
                        if (errorSamples.size < 5) errorSamples.add(err instanceof Error ? err.message : String(err));
                    }
                }
            }
        }),
    );
    const elapsedS = (Date.now() - started) / 1000;
    latencies.sort((a, b) => a - b);
    const total = latencies.length + errors;
    const errorRate = total === 0 ? 1 : errors / total;
    const p95 = pct(latencies, 95);
    const pass = p95 <= SLO[name].p95Ms && errorRate <= SLO[name].maxErrorRate && latencies.length > 0;
    console.log(
        `${pass ? 'PASS' : 'FAIL'} ${name.padEnd(8)} ok=${latencies.length} err=${errors} 429=${throttled} rps=${(latencies.length / elapsedS).toFixed(1)} ` +
            `p50=${pct(latencies, 50).toFixed(0)}ms p95=${p95.toFixed(0)}ms p99=${pct(latencies, 99).toFixed(0)}ms (SLO p95≤${SLO[name].p95Ms}ms, errors≤${SLO[name].maxErrorRate * 100}%)`,
    );
    for (const e of errorSamples) console.log(`    error: ${e}`);
    return pass;
}

const scenarios = (ONLY === 'all' ? Object.keys(RUNNERS) : ONLY.split(',')) as Scenario[];
console.log(`Load test ${BASE} · ${CONCURRENCY} virtual users · ${DURATION_S}s per scenario${SPOOF ? ' · spoofed IPs' : ''}`);
let ok = true;
for (const s of scenarios) ok = (await runScenario(s)) && ok;
process.exit(ok ? 0 : 1);
