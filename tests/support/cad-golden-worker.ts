/**
 * CAD worker stand-ins for tests and evals.
 *
 * - `goldenDirWorker(dir)`: serves a recorded worker response (`response.json` + one file per
 *   artifact, as written by `python -m cad_worker.golden`), after checking that the request's
 *   spec is the recorded one. The client still verifies every size and sha256.
 * - `liveWorker()`: the real worker when CAD_WORKER_URL is set and /healthz answers, else null.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

type RecordedArtifact = { kind: string; filename: string; content_type: string; bytes: number; sha256: string; content_base64?: string };
export type RecordedResponse = { family: string; artifacts: RecordedArtifact[]; metrics: Record<string, unknown>; processes: string[]; warnings: string[]; worker_version?: string };

/** Spec equality that ignores key order, int/float spelling and null-vs-missing optionals. */
export function normalizeSpec(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(normalizeSpec);
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(value).sort()) {
            const v = (value as Record<string, unknown>)[k];
            if (v === null || v === undefined) continue;
            out[k] = normalizeSpec(v);
        }
        return out;
    }
    return value;
}

export const sameSpec = (a: unknown, b: unknown) => JSON.stringify(normalizeSpec(a)) === JSON.stringify(normalizeSpec(b));

export function loadGoldenDir(dir: string): { response: RecordedResponse; spec: unknown; files: Map<string, Buffer> } {
    const response = JSON.parse(readFileSync(path.join(dir, 'response.json'), 'utf8')) as RecordedResponse;
    const files = new Map<string, Buffer>();
    for (const a of response.artifacts) files.set(a.filename, readFileSync(path.join(dir, a.filename)));
    const manifest = JSON.parse(files.get('manifest.json')!.toString('utf8')) as { spec: unknown };
    return { response, spec: manifest.spec, files };
}

function respond(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A fetch that answers POST /v1/generate with the recorded response in `dir`. */
export function goldenDirWorker(dir: string): typeof fetch & { calls: unknown[] } {
    const golden = loadGoldenDir(dir);
    const calls: unknown[] = [];
    const impl = (async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as { spec: unknown; ref?: string | null };
        calls.push(body.spec);
        if (!sameSpec(body.spec, golden.spec)) {
            return respond({ error: { code: 'VALIDATION_FAILED', message: `golden worker in ${path.basename(dir)} only knows ${JSON.stringify(golden.spec)}` } }, 422);
        }
        return respond({
            ...golden.response,
            ref: body.ref ?? null,
            artifacts: golden.response.artifacts.map((a) => {
                const data = golden.files.get(a.filename)!;
                if (createHash('sha256').update(data).digest('hex') !== a.sha256) throw new Error(`golden ${a.filename} does not match response.json`);
                return { ...a, content_base64: data.toString('base64') };
            }),
        });
    }) as typeof fetch & { calls: unknown[] };
    impl.calls = calls;
    return impl;
}

/** The real CAD worker, when one is configured and healthy. */
export async function liveWorker(): Promise<typeof fetch | null> {
    const url = process.env.CAD_WORKER_URL;
    if (!url) return null;
    try {
        const res = await fetch(new URL('/healthz', url), { signal: AbortSignal.timeout(2000) });
        return res.ok ? fetch : null;
    } catch {
        return null;
    }
}
