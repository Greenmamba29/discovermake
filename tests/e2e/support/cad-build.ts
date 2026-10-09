/**
 * E2E server fixture: a Make AI build with generated CAD, without the CAD worker (it does not
 * run in e2e). Everything up to the approved version goes through the real APIs; the CAD step
 * is reproduced the way `generateBuildCad` stores it:
 *   - artifacts written to the e2e local storage at `builds/<id>/cad/v2/<file>`
 *     (the committed GLB fixture, the worker's golden L-bracket DXF, a small STEP);
 *   - the DXF flat pattern attached as a part on the same build and analyzed through the API;
 *   - design version 2 = version 1 copied, with `data.cad` on `part:main`.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type APIRequestContext } from '@playwright/test';
import postgres from 'postgres';
import { E2E_DATABASE_URL, E2E_ENV } from '../../../playwright.config';

const FIXTURES = path.join(process.cwd(), 'tests', 'fixtures', 'cad');
export const OBJECT_VIEW_BBOX_MM = [80, 40, 50] as const;

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const rid = () => randomUUID().replace(/-/g, '').slice(0, 20);

const INTENT = {
    intent: 'create',
    product_type: 'wall shelf bracket',
    summary: 'A bent steel L-bracket for a wall shelf.',
    requirements: [
        { id: 'R1', text: 'Holds a 10 kg shelf', category: 'function', source: 'user', confidence: 0.9 },
        { id: 'R2', text: 'Legs 50 mm and 80 mm, 40 mm wide', category: 'dimension', source: 'user', confidence: 1 },
    ],
    constraints: [],
    unknowns: [],
    materials_suggested: [{ material: 'Mild steel', why: 'Strong and bends well.' }],
    processes_suggested: ['Laser cutting', 'Bending'],
    risk_class: 'standard',
    required_specialists: [],
};

function writeObject(key: string, body: Buffer, contentType: string) {
    const file = path.join(process.cwd(), E2E_ENV.STORAGE_LOCAL_DIR!, key);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body);
    writeFileSync(`${file}.__meta.json`, JSON.stringify({ contentType }));
}

/** Creates the build and returns its id and workspace URL. */
export async function createBuildWithCad(request: APIRequestContext): Promise<{ buildId: string; partId: string; workspaceUrl: string }> {
    const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
    try {
        const intentId = randomUUID();
        await sql`insert into make_intents (id, intent, model, prompt_sha256, prompt_chars) values (${intentId}, ${sql.json(INTENT)}, ${'e2e'}, ${'0'.repeat(64)}, ${33})`;
        const made = await request.post('/api/make-ai/builds', { data: { intentId } });
        expect(made.status()).toBe(201);
        const { buildId } = (await made.json()) as { buildId: string };
        expect((await request.post(`/api/builds/${buildId}/versions/1/approve`)).status()).toBe(200);

        // The flat pattern becomes a quotable part on the same build (as the CAD pipeline does).
        const dxf = readFileSync(path.join(FIXTURES, 'cad-worker-l-bracket.dxf'));
        const partId = `prt_${rid()}`;
        await sql`insert into parts (id, build_id, design_version, file_key, filename, format, size_bytes, status)
                  values (${partId}, ${buildId}, ${2}, ${`parts/${partId}/source.dxf`}, ${'wall-shelf-bracket-v2.dxf'}, ${'dxf'}, ${dxf.byteLength}, ${'AWAITING_UPLOAD'})`;
        expect((await request.post(`/api/parts/${partId}/upload`, { data: dxf, headers: { 'content-type': 'application/dxf' } })).status()).toBe(200);
        const analyzed = await request.post(`/api/parts/${partId}/analyze`, { data: {} });
        expect(analyzed.status()).toBe(200);

        const glb = readFileSync(path.join(FIXTURES, 'object-view-bracket.glb'));
        const step = Buffer.from("ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('wall shelf bracket'),'2;1');\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n");
        const files = [
            { kind: 'STEP', filename: 'bracket.step', body: step, contentType: 'application/step' },
            { kind: 'DXF', filename: 'bracket_flat.dxf', body: dxf, contentType: 'application/dxf' },
            { kind: 'GLB', filename: 'bracket.glb', body: glb, contentType: 'model/gltf-binary' },
        ];
        const artifacts = files.map((f) => {
            const key = `builds/${buildId}/cad/v2/${f.filename}`;
            writeObject(key, f.body, f.contentType);
            return { kind: f.kind, key, filename: f.filename, bytes: f.body.byteLength, sha256: sha256(f.body) };
        });
        const cad = {
            family: 'l_bracket',
            spec: { family: 'l_bracket', leg_a_mm: 50, leg_b_mm: 80, width_mm: 40, thickness_mm: 2, inside_bend_radius_mm: 2, k_factor: 0.44, holes_a: [], holes_b: [] },
            metrics: { bbox_mm: [...OBJECT_VIEW_BBOX_MM], volume_mm3: 9840, thickness_mm: 2, bend_count: 1, flat_size_mm: [126.5, 40] },
            processes: ['laser cutting', 'press brake bending'],
            warnings: [],
            dropped: [],
            artifacts,
            partId,
            specSource: 'buyer',
            generatedAt: new Date().toISOString(),
        };

        await sql.begin(async (tx) => {
            await tx`insert into design_versions (id, build_id, version, status, summary, parent_version, created_by)
                     values (${`dv_${rid()}`}, ${buildId}, ${2}, ${'DRAFT'}, ${'Generated CAD (l bracket)'}, ${1}, ${`buyer:guest:${buildId}`})`;
            await tx`insert into bg_nodes (id, build_id, design_version, key, type, label, data, confidence, source, provenance)
                     select 'bgn_' || substr(md5(random()::text || id), 1, 20), build_id, 2, key, type, label,
                            case when key = 'part:main' then data || ${tx.json({ cad, partId, dimensionsStatus: 'cad' })} else data end,
                            confidence, source, provenance
                     from bg_nodes where build_id = ${buildId} and design_version = 1`;
            await tx`insert into bg_edges (id, build_id, design_version, type, from_key, to_key, data)
                     select 'bge_' || substr(md5(random()::text || id), 1, 20), build_id, 2, type, from_key, to_key, data
                     from bg_edges where build_id = ${buildId} and design_version = 1`;
            await tx`update builds set current_version = 2, updated_at = now() where id = ${buildId}`;
        });
        const hasCad = await sql`select 1 from bg_nodes where build_id = ${buildId} and design_version = 2 and key = 'part:main' and data ? 'cad'`;
        expect(hasCad.length, 'the intent graph has a part:main node to carry CAD').toBe(1);
        return { buildId, partId, workspaceUrl: `/build/${buildId}/workspace` };
    } finally {
        await sql.end();
    }
}
