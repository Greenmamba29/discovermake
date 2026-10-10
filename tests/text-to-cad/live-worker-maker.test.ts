/**
 * LIVE "text to CAD to maker" against the REAL CAD worker (opt-in).
 *
 *   CAD_WORKER_URL=http://localhost:8080 CAD_WORKER_TOKEN=... \
 *     [LIVE_MAKER_OUT_DIR=/some/dir] bunx vitest run tests/text-to-cad/live-worker-maker.test.ts
 *
 * Skips unless CAD_WORKER_URL answers GET /healthz. The worker must have cadgen
 * (CADGEN_PYTHON, CADGEN_NODE; see services/cad-worker/README.md).
 *
 * The only stand-in is the script writer: no model key exists in CI, so `getMakeAiModel()` returns a
 * mock LanguageModel that answers with a fixed cadgen script (tests/fixtures/text-to-cad-live/bracket.py,
 * written to the guide in src/server/text-to-cad/guide). Everything after that is real and goes
 * through the route handlers:
 *   POST /api/text-to-cad                                buyer describes the part (new build)
 *   POST /api/builds/:id/text-to-cad                     makeIn3D -> live worker gate + sandbox -> STEP/GLB/STL
 *   POST /api/builds/:id/versions/:v/approve             buyer approves the design version
 *   POST /api/builds/:id/text-to-cad/quote               BINDING print quote from the measured geometry
 *   POST /api/checkout + /api/checkout/dev-confirm       checkout, dev payment provider -> auto dispatch
 *   /api/shop/session, /api/shop/jobs/...                the seeded maker accepts, makes, inspects, ships
 *   POST /api/admin/orders/:id/delivered                 ops confirms delivery -> COMPLETE
 *   GET  /api/orders/:id?t=...                           the buyer's tracker
 * With LIVE_MAKER_OUT_DIR set, the STL, GLB, STEP, script and a summary.json are written there.
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MockLanguageModelV4 } from 'ai/test';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CheckoutResponse, DevPaymentConfirmResponse } from '@/contracts/checkout';
import { MakeIt3dResponse, MakeIt3dStatus } from '@/contracts/make-it-3d';
import { QuoteView } from '@/contracts/quotes';
import { ShopJobDetail, ShopJobListResponse } from '@/contracts/shop';
import { POST as createRoute } from '@/app/api/text-to-cad/route';
import { GET as statusRoute, POST as makeRoute } from '@/app/api/builds/[buildId]/text-to-cad/route';
import { POST as quoteRoute } from '@/app/api/builds/[buildId]/text-to-cad/quote/route';
import { POST as approveRoute } from '@/app/api/builds/[buildId]/versions/[version]/approve/route';
import { POST as checkoutRoute } from '@/app/api/checkout/route';
import { POST as devConfirmRoute } from '@/app/api/checkout/dev-confirm/route';
import { POST as loginRoute } from '@/app/api/shop/session/route';
import { GET as listJobsRoute } from '@/app/api/shop/jobs/route';
import { GET as jobRoute } from '@/app/api/shop/jobs/[jobId]/route';
import { POST as acceptRoute } from '@/app/api/shop/jobs/[jobId]/accept/route';
import { POST as milestoneRoute } from '@/app/api/shop/jobs/[jobId]/milestones/route';
import { POST as uploadRoute } from '@/app/api/shop/jobs/[jobId]/uploads/route';
import { POST as inspectionRoute } from '@/app/api/shop/jobs/[jobId]/inspection/route';
import { POST as shipmentRoute } from '@/app/api/shop/jobs/[jobId]/shipment/route';
import { POST as deliveredRoute } from '@/app/api/admin/orders/[orderId]/delivered/route';
import { GET as orderRoute } from '@/app/api/orders/[orderId]/route';
import { DEV_SHOP_ID } from '@/server/db/seed';
import { manufacturingJobs, printQuoteDetails } from '@/server/db/schema';
import { resetEnvCache } from '@/server/env';
import { LocalDiskStorage, setStorage } from '@/server/storage';
import { parseStl } from '@/server/text-to-cad/mesh';
import { textResult } from '../build-graph/fixtures';
import { measurementsFor } from '../shop/fixtures';
import { useTestDb } from '../support/db';

const WORKER = process.env.CAD_WORKER_URL?.trim() ?? '';
const OUT_DIR = process.env.LIVE_MAKER_OUT_DIR?.trim() ?? '';

async function workerIsLive(): Promise<boolean> {
    if (!WORKER) return false;
    try {
        const res = await fetch(new URL('/healthz', WORKER), { signal: AbortSignal.timeout(3000) });
        return res.ok;
    } catch {
        console.warn(`[live-worker-maker] CAD_WORKER_URL=${WORKER} is not answering /healthz; skipping`);
        return false;
    }
}
const LIVE = await workerIsLive();

const SCRIPT = readFileSync(path.join(process.cwd(), 'tests', 'fixtures', 'text-to-cad-live', 'bracket.py'), 'utf8');
const PROMPT = 'A flat mounting bracket, 60 x 40 x 5 mm, with two 5 mm screw holes 40 mm apart, to screw a sensor to a wall.';
const BASE = 'http://localhost:3100';
const OWNER = 'dm_device=livemakerownerdevice000000000000000001';
const SHOP_TOKEN = 'dmshop_live_maker_test_token_0123456789';
const ADMIN = { authorization: 'Bearer test-admin-token' };

// The one stand-in: Make AI's model writes a fixed script. The guide still goes to it as instructions.
const modelPrompts: string[] = [];
const standInModel = new MockLanguageModelV4({
    modelId: 'stand-in-script-writer',
    doGenerate: async (options) => {
        modelPrompts.push(JSON.stringify(options.prompt));
        return textResult(`\`\`\`python\n${SCRIPT}\`\`\`\n`);
    },
});
vi.mock('@/server/make-ai', async (orig) => ({ ...(await orig<typeof import('@/server/make-ai')>()), getMakeAiModel: () => standInModel }));

let ip = 0;
function req(url: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
    return new Request(`${BASE}${url}`, {
        method: init.method ?? 'GET',
        headers: { origin: BASE, 'x-forwarded-for': `198.51.100.${(++ip % 250) + 1}`, ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
}
const p = <P>(v: P) => ({ params: Promise.resolve(v) });
async function ok<T>(res: Response, status: number, what: string): Promise<T> {
    const text = await res.text();
    if (res.status !== status) throw new Error(`${what}: HTTP ${res.status} (wanted ${status}): ${text.slice(0, 800)}`);
    return JSON.parse(text) as T;
}

/** Bounding box and enclosed volume (divergence theorem) of a closed STL, measured here. */
function stlMetrics(bytes: Uint8Array) {
    const tris = parseStl(bytes);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    let vol = 0;
    for (const t of tris) {
        for (const v of [t.a, t.b, t.c]) for (let i = 0; i < 3; i++) (min[i] = Math.min(min[i]!, v[i]!)), (max[i] = Math.max(max[i]!, v[i]!));
        vol += (t.a[0] * (t.b[1] * t.c[2] - t.b[2] * t.c[1]) - t.a[1] * (t.b[0] * t.c[2] - t.b[2] * t.c[0]) + t.a[2] * (t.b[0] * t.c[1] - t.b[1] * t.c[0])) / 6;
    }
    return { triangles: tris.length, bboxMm: [0, 1, 2].map((i) => Math.round((max[i]! - min[i]!) * 1000) / 1000), volumeMm3: Math.round(Math.abs(vol) * 10) / 10 };
}

describe.skipIf(!LIVE)('LIVE: text to CAD to maker on the real CAD worker', () => {
    const ctx = useTestDb({ seed: { shopToken: SHOP_TOKEN } });
    let storageDir = '';

    beforeAll(async () => {
        storageDir = await mkdtemp(path.join(os.tmpdir(), 'dm-live-maker-'));
        setStorage(new LocalDiskStorage({ rootDir: storageDir, appUrl: BASE, signingSecret: 'test-storage-secret' }));
        process.env.MAKE_AI_ENABLED = 'true';
        // Only so the availability check passes; getMakeAiModel() is the stand-in, nothing calls Google.
        process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'stand-in-not-a-real-key';
        resetEnvCache();
        vi.spyOn(console, 'info').mockImplementation(() => {});
    });
    afterAll(async () => {
        delete process.env.MAKE_AI_ENABLED;
        delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        resetEnvCache();
        setStorage(null);
        if (storageDir) await rm(storageDir, { recursive: true, force: true });
    });

    it('a described bracket is built by the worker, quoted BINDING, paid, made, shipped and delivered', { timeout: 600_000 }, async () => {
        const steps: Record<string, unknown> = {};

        // 1. The buyer describes the part.
        const created = await ok<{ buildId: string; url: string }>(await createRoute(req('/api/text-to-cad', { method: 'POST', headers: { cookie: OWNER }, body: { prompt: PROMPT } }), p({})), 201, 'create build');
        const buildId = created.buildId;
        steps.buildId = buildId;

        // 2-3. Make AI (stand-in) writes the script; the REAL worker gates and builds it.
        const t0 = Date.now();
        const made = MakeIt3dResponse.parse(await ok(await makeRoute(req(`/api/builds/${buildId}/text-to-cad`, { method: 'POST', headers: { cookie: OWNER }, body: { prompt: PROMPT } }), p({ buildId })), 201, 'make it in 3D'));
        const makeMs = Date.now() - t0;
        if (made.status !== 'generated') throw new Error(`makeIn3D: ${JSON.stringify(made)}`);
        expect(modelPrompts).toHaveLength(1);
        expect(modelPrompts[0]).toContain('DiscoverMake rules');
        expect(modelPrompts[0]).toContain(PROMPT);
        const rec = made.record;
        expect(rec.attempts).toBe(1);
        expect(rec.engine.name).toBe('cadgen');
        expect(rec.scriptSha256).toBe(createHash('sha256').update(SCRIPT).digest('hex'));
        expect(rec.geometry).toMatchObject({ solids: 1, sound: true });
        expect(rec.geometry.bbox_mm.map((v) => Math.round(v * 100) / 100)).toEqual([60, 40, 5]);
        // 60x40x5 slab, minus two Ø5 through holes, rounded corners and edges: ~11.7 cm³.
        expect(rec.geometry.volume_mm3).toBeGreaterThan(11_500);
        expect(rec.geometry.volume_mm3).toBeLessThan(11_850);
        expect(rec.minWallMm).not.toBeNull();
        expect(rec.minWallMm!).toBeGreaterThan(4);
        expect(rec.artifacts.map((a) => a.kind)).toEqual(['STEP', 'GLB', 'STL']);

        // The artifacts in storage are the worker's bytes; measure the STL independently.
        const files: Record<string, Buffer> = {};
        for (const kind of ['STEP', 'GLB', 'STL'] as const) {
            const a = rec.artifacts.find((x) => x.kind === kind)!;
            const buf = await readFile(path.join(storageDir, `builds/${buildId}/cad/v${made.version}/${a.filename}`));
            expect(createHash('sha256').update(buf).digest('hex')).toBe(a.sha256);
            files[kind] = buf;
        }
        expect(files.GLB!.subarray(0, 4).toString('latin1')).toBe('glTF');
        expect(files.STEP!.subarray(0, 13).toString('latin1')).toBe('ISO-10303-21;');
        const measured = stlMetrics(new Uint8Array(files.STL!));
        expect(measured.bboxMm).toEqual([60, 40, 5]);
        expect(Math.abs(measured.volumeMm3 - rec.geometry.volume_mm3) / rec.geometry.volume_mm3).toBeLessThan(0.01);

        // 4. The buyer approves the version, then gets a BINDING print quote.
        const before = MakeIt3dStatus.parse(await ok(await statusRoute(req(`/api/builds/${buildId}/text-to-cad`), p({ buildId })), 200, 'status'));
        expect(before).toMatchObject({ latestVersion: made.version, latestApproved: false, quotable: false });
        expect((await quoteRoute(req(`/api/builds/${buildId}/text-to-cad/quote`, { method: 'POST', headers: { cookie: OWNER }, body: { printMaterialSlug: 'petg', quantity: 4 } }), p({ buildId }))).status).toBe(409);
        await ok(await approveRoute(req(`/api/builds/${buildId}/versions/${made.version}/approve`, { method: 'POST', headers: { cookie: OWNER } }), p({ buildId, version: String(made.version) })), 200, 'approve');
        const quote = QuoteView.parse(await ok(await quoteRoute(req(`/api/builds/${buildId}/text-to-cad/quote`, { method: 'POST', headers: { cookie: OWNER }, body: { printMaterialSlug: 'petg', quantity: 4 } }), p({ buildId })), 201, 'quote'));
        expect(quote).toMatchObject({ trustLevel: 'BINDING', status: 'READY', orderable: true, designVersion: made.version });
        expect(quote.config.quantity).toBe(4);
        expect(quote.config.process).toBe('print');
        expect(quote.lineItems.reduce((s, l) => s + l.totalCents, 0)).toBe(quote.subtotalCents);
        const [details] = await ctx.db.select().from(printQuoteDetails).where(eq(printQuoteDetails.quoteId, quote.id));
        expect(details).toMatchObject({ family: 'text_to_cad', stlSha256: rec.artifacts.find((a) => a.kind === 'STL')!.sha256 });
        expect((details!.geometry as { bboxMm: number[] }).bboxMm).toEqual(rec.geometry.bbox_mm);
        const after = MakeIt3dStatus.parse(await ok(await statusRoute(req(`/api/builds/${buildId}/text-to-cad`), p({ buildId })), 200, 'status'));
        expect(after.quoteId).toBe(quote.id);

        // 5. Checkout with the dev payment provider; payment confirmation dispatches the order.
        const checkout = CheckoutResponse.parse(
            await ok(
                await checkoutRoute(
                    req('/api/checkout', {
                        method: 'POST',
                        headers: { cookie: OWNER },
                        body: {
                            quoteId: quote.id,
                            shippingMethod: quote.shippingOptions[0]!.method,
                            buyer: { email: 'live-maker@example.com', name: 'Ada Maker' },
                            shippingAddress: { name: 'Ada Maker', line1: '100 Market St', city: 'Philadelphia', region: 'PA', postalCode: '19106', country: 'US' },
                            acceptTerms: true,
                        },
                    }),
                    p({}),
                ),
                201,
                'checkout',
            ),
        );
        expect(checkout).toMatchObject({ status: 'PENDING_PAYMENT', payment: { provider: 'dev' } });
        expect(checkout.totals.subtotalCents).toBe(quote.subtotalCents);
        const orderId = checkout.orderId;
        const orderToken = new URL(checkout.orderUrl).searchParams.get('t')!;
        const confirmed = DevPaymentConfirmResponse.parse(await ok(await devConfirmRoute(req('/api/checkout/dev-confirm', { method: 'POST', body: { providerRef: checkout.payment.providerRef, outcome: 'succeeded' } }), p({})), 200, 'dev payment'));
        expect(confirmed.orderId).toBe(orderId);
        expect(['PAID', 'DISPATCHED']).toContain(confirmed.status);

        // 6. The seeded maker logs in, finds the job, accepts it, makes it, inspects it and ships it.
        const login = await loginRoute(req('/api/shop/session', { method: 'POST', body: { token: SHOP_TOKEN } }), p({}));
        expect(login.status).toBe(200);
        const cookie = /dm_shop_session=[^;]+/.exec(login.headers.get('set-cookie') ?? '')![0];
        const shop = { cookie };
        const inbox = ShopJobListResponse.parse(await ok(await listJobsRoute(req('/api/shop/jobs?status=OFFERED', { headers: shop }), p({})), 200, 'inbox'));
        const offered = inbox.jobs.find((j) => j.orderId === orderId);
        expect(offered, 'the seeded maker got the job').toBeDefined();
        const jobId = offered!.id;
        const accepted = ShopJobDetail.parse(await ok(await acceptRoute(req(`/api/shop/jobs/${jobId}/accept`, { method: 'POST', headers: shop }), p({ jobId })), 200, 'accept'));
        expect(accepted.status).toBe('ACCEPTED');
        const stlFile = accepted.packet.files.find((f) => f.kind === 'SOURCE_STL');
        expect(stlFile, 'the job packet carries the STL').toBeDefined();
        const [jobRow] = await ctx.db.select().from(manufacturingJobs).where(eq(manufacturingJobs.id, jobId));
        expect(jobRow!.shopId).toBe(DEV_SHOP_ID);
        expect(jobRow!.sourceFileSha256).toBe(details!.stlSha256);
        expect(jobRow!.packet.print).toMatchObject({ family: 'text_to_cad', stlSha256: details!.stlSha256 });

        for (const kind of ['MATERIAL_STAGED', 'FINISHING'] as const) {
            expect((await milestoneRoute(req(`/api/shop/jobs/${jobId}/milestones`, { method: 'POST', headers: shop, body: { kind } }), p({ jobId }))).status).toBe(201);
        }
        const up = await ok<{ key: string }>(await uploadRoute(req(`/api/shop/jobs/${jobId}/uploads`, { method: 'POST', headers: shop, body: { filename: 'qa.jpg', contentType: 'image/jpeg', sizeBytes: 4 } }), p({ jobId })), 201, 'upload');
        const { getStorage } = await import('@/server/storage');
        await getStorage().putObject(up.key, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { contentType: 'image/jpeg' });
        const qa = await ok<{ outcome: string }>(
            await inspectionRoute(req(`/api/shop/jobs/${jobId}/inspection`, { method: 'POST', headers: shop, body: { measurements: await measurementsFor(ctx.db, jobId), photoKeys: [up.key], inspectorName: 'Pat Printer' } }), p({ jobId })),
            201,
            'inspection',
        );
        expect(qa.outcome).toBe('PASS');
        expect((await milestoneRoute(req(`/api/shop/jobs/${jobId}/milestones`, { method: 'POST', headers: shop, body: { kind: 'PACKED' } }), p({ jobId }))).status).toBe(201);
        await ok(
            await shipmentRoute(req(`/api/shop/jobs/${jobId}/shipment`, { method: 'POST', headers: shop, body: { parcel: { lengthIn: 6, widthIn: 4, heightIn: 2, weightOz: 6 }, manual: { carrier: 'UPS', service: 'Ground', trackingNumber: '1ZLIVEMAKER0001' } } }), p({ jobId })),
            201,
            'shipment',
        );

        // Ops confirms delivery (manual carrier) -> DELIVERED -> COMPLETE.
        await ok(await deliveredRoute(req(`/api/admin/orders/${orderId}/delivered`, { method: 'POST', headers: ADMIN, body: {} }), p({ orderId })), 200, 'delivered');
        const finalJob = ShopJobDetail.parse(await ok(await jobRoute(req(`/api/shop/jobs/${jobId}`, { headers: shop }), p({ jobId })), 200, 'job'));
        expect(finalJob.status).toBe('DELIVERED');
        const tracker = await ok<{ status: string; universalStatus: string; orderNumber: string; totals: { totalCents: number }; passport: { id: string } | null }>(
            await orderRoute(req(`/api/orders/${orderId}?t=${encodeURIComponent(orderToken)}`), p({ orderId })),
            200,
            'buyer tracker',
        );
        expect(tracker.status).toBe('COMPLETE');
        expect(tracker.universalStatus).toBe('COMPLETE');
        expect(tracker.passport?.id).toBeTruthy();
        const history = (await ctx.db.execute(sql`select to_status from order_status_history where order_id = ${orderId} order by created_at, id`)) as unknown as { to_status: string }[];
        expect(history.map((r) => r.to_status)).toEqual(['PAID', 'DISPATCHED', 'ACCEPTED', 'IN_PRODUCTION', 'QA_PASSED', 'SHIPPED', 'DELIVERED', 'COMPLETE']);

        if (OUT_DIR) {
            await mkdir(OUT_DIR, { recursive: true });
            await writeFile(path.join(OUT_DIR, 'model.stl'), files.STL!);
            await writeFile(path.join(OUT_DIR, 'model.glb'), files.GLB!);
            await writeFile(path.join(OUT_DIR, 'model.step'), files.STEP!);
            await writeFile(path.join(OUT_DIR, 'model.py'), SCRIPT);
            const summary = {
                ranAt: new Date().toISOString(),
                worker: WORKER,
                standIn: 'script writer only (MockLanguageModelV4 returning tests/fixtures/text-to-cad-live/bracket.py)',
                prompt: PROMPT,
                buildId,
                designVersion: made.version,
                makeIn3dMs: makeMs,
                engine: rec.engine,
                worker_geometry: rec.geometry,
                stl_measured_here: measured,
                minWallMm: rec.minWallMm,
                artifacts: rec.artifacts.map((a) => ({ kind: a.kind, filename: a.filename, bytes: a.bytes, sha256: a.sha256 })),
                quote: { id: quote.id, trustLevel: quote.trustLevel, status: quote.status, material: quote.summary.materialName, process: quote.summary.processName, quantity: quote.config.quantity, unitPriceCents: quote.unitPriceCents, subtotalCents: quote.subtotalCents, leadTimeDays: quote.leadTimeDays },
                order: { id: orderId, orderNumber: tracker.orderNumber, totals: checkout.totals, paymentProvider: checkout.payment.provider, statusAfterPayment: confirmed.status, finalStatus: tracker.status, universalStatus: tracker.universalStatus, statusHistory: history.map((r) => r.to_status), passportId: tracker.passport?.id ?? null },
                maker: { shopId: jobRow!.shopId, jobId, finalJobStatus: finalJob.status, inspection: qa.outcome },
            };
            await writeFile(path.join(OUT_DIR, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
            console.warn(`[live-worker-maker] wrote ${OUT_DIR}/summary.json`);
        }
    });
});
