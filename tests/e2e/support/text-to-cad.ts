/**
 * E2E seam for Make AI "Make it in 3D". Neither a model key nor the CAD worker runs in e2e, so
 * the panel shows its honest unavailable state. Like `plantGoldenKnobCad`, this plants exactly
 * what `makeIn3D` stores, from the worker's committed golden cadgen output
 * (`tests/fixtures/text-to-cad`, written by `python -m cad_worker.text_to_cad.golden` through
 * the real gate and sandbox):
 *   - the STEP / GLB / STL (sha256-checked) and the script in the e2e local storage at
 *     `builds/<id>/cad/v<N+1>/<file>`;
 *   - design version N+1 (DRAFT) = version N copied, with `textToCad` on `part:main`.
 * Nothing about approval or price is faked: the buyer approves in the UI and the print engine
 * quotes for real (POST /api/builds/:id/text-to-cad/quote).
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type APIRequestContext } from '@playwright/test';
import postgres from 'postgres';
import { E2E_DATABASE_URL, E2E_ENV } from '../../../playwright.config';
import { measureMinWall, parseStl } from '../../../src/server/text-to-cad/mesh';

const GOLDEN = path.join(process.cwd(), 'tests', 'fixtures', 'text-to-cad');
export const GOLDEN_BBOX_MM = [60, 24, 18] as const;

type Recorded = {
    engine: { name: 'cadgen'; version: string };
    artifacts: { kind: 'step' | 'glb' | 'stl'; filename: string; sha256: string; bytes: number }[];
    geometry: { bbox_mm: number[]; volume_mm3: number; area_mm2: number; solids: number; sound: boolean };
    warnings: string[];
    prompt: string;
};

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const rid = () => randomUUID().replace(/-/g, '').slice(0, 20);
const KIND = { step: 'STEP', glb: 'GLB', stl: 'STL' } as const;
const CONTENT_TYPE = { step: 'model/step', glb: 'model/gltf-binary', stl: 'model/stl' } as const;

function writeObject(key: string, body: Buffer | string, contentType: string) {
    const file = path.join(process.cwd(), E2E_ENV.STORAGE_LOCAL_DIR!, key);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body);
    writeFileSync(`${file}.__meta.json`, JSON.stringify({ contentType }));
}

export const TEXT_TO_CAD_INTENT = {
    intent: 'create',
    product_type: 'desk cable holder',
    summary: 'A desk cable holder with three slots for charging cables.',
    requirements: [{ id: 'R1', text: 'Holds three charging cables on a desk', category: 'function', source: 'user', confidence: 0.9 }],
    constraints: [],
    unknowns: [],
    materials_suggested: [],
    processes_suggested: ['3D printing'],
    risk_class: 'standard',
    required_specialists: [],
};

/** A Make AI build owned by `request`'s device (the page's context). Returns its id. */
export async function createTextToCadBuild(request: APIRequestContext): Promise<string> {
    const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
    try {
        const intentId = randomUUID();
        await sql`insert into make_intents (id, intent, model, prompt_sha256, prompt_chars) values (${intentId}, ${sql.json(TEXT_TO_CAD_INTENT)}, ${'e2e'}, ${'0'.repeat(64)}, ${57})`;
        const made = await request.post('/api/make-ai/builds', { data: { intentId } });
        expect(made.status()).toBe(201);
        return ((await made.json()) as { buildId: string }).buildId;
    } finally {
        await sql.end();
    }
}

/** Plant the golden cadgen model as the next (DRAFT) design version. Returns that version. */
export async function plantGoldenTextToCad(buildId: string): Promise<number> {
    const response = JSON.parse(readFileSync(path.join(GOLDEN, 'response.json'), 'utf8')) as Recorded;
    const script = readFileSync(path.join(GOLDEN, 'model.py'), 'utf8');
    const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
    try {
        const [latest] = await sql<{ version: number }[]>`select max(version)::int as version from design_versions where build_id = ${buildId}`;
        const from = latest!.version;
        const version = from + 1;
        let minWallMm: number | null = null;
        const artifacts = response.artifacts.map((a) => {
            const body = readFileSync(path.join(GOLDEN, a.filename));
            expect(sha256(body)).toBe(a.sha256);
            if (a.kind === 'stl') minWallMm = measureMinWall(parseStl(new Uint8Array(body)))?.minWallMm ?? null;
            const key = `builds/${buildId}/cad/v${version}/${a.filename}`;
            writeObject(key, body, CONTENT_TYPE[a.kind]);
            return { kind: KIND[a.kind], key, filename: a.filename, bytes: a.bytes, sha256: a.sha256 };
        });
        const scriptKey = `builds/${buildId}/cad/v${version}/model.py`;
        writeObject(scriptKey, script, 'text/x-python');
        const textToCad = {
            prompt: response.prompt,
            engine: response.engine,
            scriptSha256: sha256(script),
            scriptKey,
            geometry: response.geometry,
            minWallMm,
            warnings: response.warnings,
            artifacts,
            attempts: 1,
            model: 'e2e-golden',
            promptVersion: 'make-it-3d/1',
            guideVersion: 'cadgen-0.7.20+b48ff49/dm-1',
            generatedAt: new Date().toISOString(),
        };
        await sql.begin(async (tx) => {
            await tx`insert into design_versions (id, build_id, version, status, summary, parent_version, created_by)
                     values (${`dv_${rid()}`}, ${buildId}, ${version}, ${'DRAFT'}, ${`Made in 3D with Make AI: ${response.prompt}`.slice(0, 300)}, ${from}, ${`buyer:guest:${buildId}`})`;
            await tx`insert into bg_nodes (id, build_id, design_version, key, type, label, data, confidence, source, provenance)
                     select 'bgn_' || substr(md5(random()::text || id), 1, 20), build_id, ${version}, key, type, label,
                            case when key = 'part:main' then (data - 'cad') || ${tx.json({ textToCad, dimensionsStatus: 'cad', partId: null } as never)} else data end,
                            confidence, source, provenance
                     from bg_nodes where build_id = ${buildId} and design_version = ${from}`;
            await tx`insert into bg_edges (id, build_id, design_version, type, from_key, to_key, data)
                     select 'bge_' || substr(md5(random()::text || id), 1, 20), build_id, ${version}, type, from_key, to_key, data
                     from bg_edges where build_id = ${buildId} and design_version = ${from}`;
            await tx`update builds set current_version = ${version}, updated_at = now() where id = ${buildId}`;
        });
        const planted = await sql`select 1 from bg_nodes where build_id = ${buildId} and design_version = ${version} and key = 'part:main' and data ? 'textToCad'`;
        expect(planted.length, 'the build has a part:main node to carry the model').toBe(1);
        return version;
    } finally {
        await sql.end();
    }
}
