/**
 * E2E seam for R6 Reconstruct. The CAD worker does not run in e2e (CAD_WORKER_URL is unset, so
 * Generate shows the honest "CAD service unavailable" state). Like `cad-build.ts`, this plants
 * exactly what `generateBuildCad` stores, from the worker's committed golden output for the spec
 * the Reconstruct planner made (`tests/fixtures/cad/reconstruct-knob`, written by
 * `python -m cad_worker.golden`):
 *   - every artifact (STEP, STL, GLB, BOM, drawing, manifest) in the e2e local storage at
 *     `builds/<id>/cad/v<N+1>/<file>`, with its sha256;
 *   - design version N+1 = version N copied, with the CAD record on `part:main`.
 * It refuses to plant unless the app's own plan (from the confirmed caliper readings) is the
 * golden spec. Nothing about the price is faked: the print quote engine then runs for real on
 * the planted manifest (POST /api/reconstruct/:id/quote).
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type APIRequestContext } from '@playwright/test';
import postgres from 'postgres';
import { E2E_DATABASE_URL, E2E_ENV } from '../../../playwright.config';
import { sameSpec } from '../../support/cad-golden-worker';

export const KNOB_PHOTO = path.join(process.cwd(), 'tests', 'fixtures', 'reconstruct', 'broken-knob.jpg');
const GOLDEN = path.join(process.cwd(), 'tests', 'fixtures', 'cad', 'reconstruct-knob');
/** Pixel positions in broken-knob.jpg (1200 x 960, 0.1 mm/px). */
export const KNOB_PHOTO_PX = { width: 1200, height: 960, cardEdge: [{ x: 172, y: 400 }, { x: 1028, y: 400 }], knobDiameter: [{ x: 409.5, y: 200 }, { x: 790.5, y: 200 }] } as const;
export const KNOB_OPTIONS = { shaft: '6mm-d', gripRibs: 12, pointerNotch: true } as const;

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const rid = () => randomUUID().replace(/-/g, '').slice(0, 20);

type Recorded = { family: string; metrics: Record<string, unknown>; processes: string[]; warnings: string[]; artifacts: { kind: string; filename: string; content_type: string; bytes: number; sha256: string }[] };

function writeObject(key: string, body: Buffer, contentType: string) {
    const file = path.join(process.cwd(), E2E_ENV.STORAGE_LOCAL_DIR!, key);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body);
    writeFileSync(`${file}.__meta.json`, JSON.stringify({ contentType }));
}

/** Plant the golden knob CAD as the next design version. Returns that version. */
export async function plantGoldenKnobCad(request: APIRequestContext, buildId: string): Promise<number> {
    const view = await (await request.get(`/api/reconstruct/${buildId}`)).json();
    const response = JSON.parse(readFileSync(path.join(GOLDEN, 'response.json'), 'utf8')) as Recorded;
    const manifest = JSON.parse(readFileSync(path.join(GOLDEN, 'manifest.json'), 'utf8')) as { spec: Record<string, unknown> };
    expect(view.plan.status, 'every critical dimension is caliper-confirmed').toBe('ready');
    expect(sameSpec(view.plan.spec, manifest.spec), `the planner's spec ${JSON.stringify(view.plan.spec)} is the golden knob spec`).toBe(true);

    const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
    try {
        const [latest] = await sql<{ version: number }[]>`select max(version)::int as version from design_versions where build_id = ${buildId}`;
        const from = latest!.version;
        const version = from + 1;
        const artifacts = response.artifacts.map((a) => {
            const body = readFileSync(path.join(GOLDEN, a.filename));
            expect(sha256(body)).toBe(a.sha256);
            const key = `builds/${buildId}/cad/v${version}/${a.filename}`;
            writeObject(key, body, a.content_type);
            return { kind: a.kind, key, filename: a.filename, bytes: a.bytes, sha256: a.sha256 };
        });
        const bom = JSON.parse(readFileSync(path.join(GOLDEN, 'bom.json'), 'utf8')).items;
        const cad = {
            family: response.family,
            spec: manifest.spec,
            metrics: response.metrics,
            processes: response.processes,
            warnings: response.warnings,
            dropped: [],
            artifacts,
            partId: null,
            parts: [],
            estimate: null,
            specSource: 'buyer',
            generatedAt: new Date().toISOString(),
        };
        await sql.begin(async (tx) => {
            await tx`insert into design_versions (id, build_id, version, status, summary, parent_version, created_by)
                     values (${`dv_${rid()}`}, ${buildId}, ${version}, ${'DRAFT'}, ${'Generated CAD (round knob)'}, ${from}, ${`buyer:guest:${buildId}`})`;
            await tx`insert into bg_nodes (id, build_id, design_version, key, type, label, data, confidence, source, provenance)
                     select 'bgn_' || substr(md5(random()::text || id), 1, 20), build_id, ${version}, key, type, label,
                            case when key = 'part:main' then data || ${tx.json({ cad, partId: null, dimensionsStatus: 'cad', bom, processes: response.processes } as never)} else data end,
                            confidence, source, provenance
                     from bg_nodes where build_id = ${buildId} and design_version = ${from}`;
            await tx`insert into bg_edges (id, build_id, design_version, type, from_key, to_key, data)
                     select 'bge_' || substr(md5(random()::text || id), 1, 20), build_id, ${version}, type, from_key, to_key, data
                     from bg_edges where build_id = ${buildId} and design_version = ${from}`;
            await tx`update builds set current_version = ${version}, updated_at = now() where id = ${buildId}`;
        });
        return version;
    } finally {
        await sql.end();
    }
}

/** Upload a photo through the attachment routes (create -> signed PUT -> verify). */
export async function uploadPhoto(request: APIRequestContext, buildId: string, file = KNOB_PHOTO): Promise<string> {
    const body = readFileSync(file);
    const created = await request.post(`/api/builds/${buildId}/attachments`, { data: { filename: path.basename(file), contentType: 'image/jpeg', sizeBytes: body.byteLength } });
    expect(created.status()).toBe(201);
    const { attachment, upload } = await created.json();
    const headers = Object.fromEntries(Object.entries(upload.headers as Record<string, string>).filter(([k]) => !/^(content-length|host)$/i.test(k)));
    const put = await request.fetch(upload.url, { method: 'PUT', headers, data: body });
    expect(put.ok(), 'signed PUT').toBe(true);
    expect((await request.post(`/api/builds/${buildId}/attachments/${attachment.id}/complete`)).status()).toBe(200);
    return attachment.id as string;
}

/**
 * A Reconstruct build through the real APIs: knob + photo + photo measurements + the two caliper
 * readings; with `cad`, the golden CAD planted and a real print quote. For the page sweep.
 */
export async function createReconstructState(request: APIRequestContext, opts: { cad: boolean }): Promise<{ buildId: string; quoteId: string | null }> {
    const created = await request.post('/api/reconstruct', { data: { partType: 'knob', description: 'Stove knob cracked off its shaft', options: KNOB_OPTIONS } });
    expect(created.status()).toBe(201);
    const { buildId } = await created.json();
    const attachmentId = await uploadPhoto(request, buildId);
    const [r0, r1] = KNOB_PHOTO_PX.cardEdge;
    const [k0, k1] = KNOB_PHOTO_PX.knobDiameter;
    const measured = await request.put(`/api/reconstruct/${buildId}/measurements`, {
        data: { photos: [{ attachmentId, imageWidth: 1200, imageHeight: 960, reference: { preset: 'credit_card', a: r0, b: r1, lengthMm: 85.6 }, lines: [{ id: 'l1', kind: 'diameter', param: 'diameter_mm', a: k0, b: k1 }] }] },
    });
    expect(measured.status()).toBe(200);
    if (!opts.cad) return { buildId, quoteId: null };
    expect((await request.post(`/api/reconstruct/${buildId}/dimensions`, { data: { readings: [{ param: 'diameter_mm', value: 1.5, unit: 'in' }, { param: 'height_mm', value: 22, unit: 'mm' }] } })).status()).toBe(200);
    await plantGoldenKnobCad(request, buildId);
    const quote = await request.post(`/api/reconstruct/${buildId}/quote`, { data: { printMaterialSlug: 'asa', quantity: 1 } });
    expect(quote.status()).toBe(201);
    const q = await quote.json();
    expect(q.trustLevel).toBe('BINDING');
    return { buildId, quoteId: q.id };
}
