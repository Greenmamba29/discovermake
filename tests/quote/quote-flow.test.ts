/**
 * Integration: signed upload -> analyze -> quote through the real route handlers,
 * against a throwaway seeded Postgres database and an isolated local storage dir.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiErrorBody, BuildView, CatalogResponse, CreatePartResponse, PartView, QuoteView, type CreateQuoteRequest } from '@/contracts';
import { domainEvents, orders, parts, quotes, shopCapabilities } from '@/server/db/schema';
import { LocalDiskStorage, getStorage, setStorage } from '@/server/storage';
import { analyzePart, createPartUpload, createQuote, getBuild, getCatalog, getQuote, markQuoteOrdered } from '@/server/quote';
import { POST as postParts } from '@/app/api/parts/route';
import { GET as getPartRoute } from '@/app/api/parts/[partId]/route';
import { POST as postAnalyze } from '@/app/api/parts/[partId]/analyze/route';
import { POST as postUpload } from '@/app/api/parts/[partId]/upload/route';
import { GET as getBuildRoute } from '@/app/api/builds/[buildId]/route';
import { GET as getCatalogRoute } from '@/app/api/catalog/route';
import { POST as postQuotes } from '@/app/api/quotes/route';
import { GET as getQuoteRoute } from '@/app/api/quotes/[quoteId]/route';
import { PUT as putLocalStorage } from '@/app/api/storage/local/[...key]/route';
import { createCheckout } from '@/server/orders';
import { useTestDb as withTestDb } from '../support/db';
import { fixture } from './fixtures/fixtures';

const ctx = withTestDb({ seed: true });
let storageDir = '';

beforeAll(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), 'dm-quote-'));
    setStorage(new LocalDiskStorage({ rootDir: storageDir, appUrl: 'http://localhost:3100', signingSecret: process.env.STORAGE_SIGNING_SECRET ?? 'test-storage-secret' }));
});
afterAll(async () => {
    setStorage(null);
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
});

const BASE = 'http://localhost:3100';
const params = <P>(p: P) => ({ params: Promise.resolve(p) });
/** One guest browser for the whole suite: builds created through POST /api/parts belong to this device (ADR-0009). */
const DEVICE_COOKIE_HEADER = 'dm_device=quoteflowsuitedevicecookie000000000';
const jsonReq = (url: string, body: unknown, method = 'POST') =>
    new Request(`${BASE}${url}`, { method, headers: { 'content-type': 'application/json', cookie: DEVICE_COOKIE_HEADER }, body: typeof body === 'string' ? body : JSON.stringify(body) });

async function uploadViaSignedUrl(name: string, content = fixture(name).build()) {
    const bytes = new TextEncoder().encode(content);
    const res = await postParts(jsonReq('/api/parts', { filename: `${name}.dxf`, sizeBytes: bytes.byteLength, contentType: 'application/dxf' }), params({}));
    expect(res.status).toBe(201);
    const created = CreatePartResponse.parse(await res.json());
    // PUT the bytes exactly as instructed by the signed upload target.
    const url = new URL(created.upload.url);
    const key = url.pathname.replace('/api/storage/local/', '').split('/');
    const put = await putLocalStorage(new Request(created.upload.url, { method: 'PUT', headers: created.upload.headers, body: bytes }), params({ key }));
    expect(put.status).toBe(200);
    return created;
}

async function analyze(partId: string, body: unknown = {}) {
    const res = await postAnalyze(jsonReq(`/api/parts/${partId}/analyze`, body), params({ partId }));
    expect(res.status).toBe(200);
    return PartView.parse(await res.json());
}

async function quote(body: CreateQuoteRequest) {
    const res = await postQuotes(jsonReq('/api/quotes', body), params({}));
    return { status: res.status, body: (await res.json()) as unknown };
}

const STEEL_16GA = { materialId: 'mat_steel_crs', thicknessOptionId: 'thk_crs_16ga' };

describe('catalog', () => {
    it('serves the buyer-safe seeded catalog', async () => {
        const res = await getCatalogRoute(new Request(`${BASE}/api/catalog`), params({}));
        expect(res.status).toBe(200);
        const raw = await res.json();
        const catalog = CatalogResponse.parse(raw);
        expect(catalog.materials).toHaveLength(8);
        expect(catalog.ladderQuantities).toEqual([1, 10, 25, 50, 100, 250]);
        expect(catalog.rulesetVersion).toBe('dfm-2026.10-r1');
        const steel = catalog.materials.find((m) => m.id === 'mat_steel_crs')!;
        expect(steel.compatibleServiceIds).toContain('svc_bending');
        expect(steel.compatibleServiceIds).not.toContain('svc_anodize_black');
        const t16 = steel.thicknessOptions.find((t) => t.id === 'thk_crs_16ga')!;
        expect(t16).toMatchObject({ minHoleDiameterMm: 1.52, minFeatureMm: 1.52, minHoleToEdgeMm: 1.52, bendable: true, maxPartWidthMm: 1143, maxPartHeightMm: 762 });
        // No shop cost coefficients leak to buyers.
        const text = JSON.stringify(raw);
        for (const leak of ['unitPriceCents', 'feedRate', 'priceCentsPerKg', 'sheetPriceCents', 'platformMargin']) expect(text).not.toContain(leak);
        expect(await getCatalog()).toEqual(catalog);
    });
});

describe('upload -> analyze -> quote', () => {
    it('runs the full flow with events, invariants and an orderable BINDING quote', async () => {
        const created = await uploadViaSignedUrl('plate-holes-mm');
        expect(created.buildDisplayId).toMatch(/^DM-[0-9A-Z]{5}$/);
        expect(created.upload).toMatchObject({ method: 'PUT', headers: { 'content-type': 'application/dxf' }, maxBytes: 25 * 1024 * 1024, key: `parts/${created.partId}/source.dxf` });

        const part = await analyze(created.partId);
        expect(part).toMatchObject({ status: 'READY', universalStatus: 'READY', units: 'mm', designVersion: 1, rulesetVersion: 'dfm-2026.10-r1', error: null });
        expect(part.features?.holes).toHaveLength(4);
        expect(part.dfm).toMatchObject({ blocking: false, violations: [], makeabilityScore: 100 });
        expect(part.preview?.outer).toHaveLength(1);

        // Immutable copy of the analyzed bytes.
        const [row] = await ctx.db.select().from(parts).where(eq(parts.id, created.partId));
        expect(row.fileKey).toMatch(new RegExp(`^parts/${created.partId}/v1-[0-9a-f]{12}\\.dxf$`));
        expect(await getStorage().headObject(row.fileKey)).not.toBeNull();
        expect(row.fileSha256).toMatch(/^[0-9a-f]{64}$/);

        const partRes = await getPartRoute(new Request(`${BASE}/api/parts/${created.partId}`), params({ partId: created.partId }));
        expect(PartView.parse(await partRes.json())).toEqual(part);

        const q = await quote({ partId: created.partId, ...STEEL_16GA, finishServiceId: 'svc_powder_black_matte', services: [{ serviceId: 'svc_deburr' }], quantity: 10 });
        expect(q.status).toBe(201);
        const view = QuoteView.parse(q.body);
        expect(view).toMatchObject({ status: 'READY', trustLevel: 'BINDING', orderable: true, tier: 'SMALL_BATCH', designVersion: 1, currency: 'usd', pricingVersion: 'px-2026.10-r1' });
        expect(view.route).toMatchObject({ shopId: 'shop_philadelphia_precision', shopName: 'Philadelphia Precision Works', city: 'Philadelphia', region: 'PA', processName: 'Fiber laser cutting', machineLabel: 'Fiber laser 04 (4 kW)' });
        expect(view.summary).toMatchObject({ materialName: 'Mild steel (1008 cold rolled)', finishName: 'Powder coat · matte black', serviceNames: ['Deburring'], quantity: 10, partFilename: 'plate-holes-mm.dxf' });
        expect(view.lineItems.reduce((s, l) => s + l.totalCents, 0)).toBe(view.subtotalCents);
        expect(view.unitPriceCents * 10).toBe(view.subtotalCents);
        expect(view.lineItems.map((l) => l.code)).toEqual(['MATERIAL', 'CUTTING', 'SECONDARY', 'FINISHING', 'HANDLING', 'QA', 'SETUP']);
        expect(view.ladder.map((r) => r.quantity)).toEqual([1, 10, 25, 50, 100, 250]);
        expect(view.ladder.find((r) => r.quantity === 10)?.totalCents).toBe(view.subtotalCents);
        for (let i = 1; i < view.ladder.length; i++) {
            expect(view.ladder[i].unitPriceCents).toBeLessThanOrEqual(view.ladder[i - 1].unitPriceCents);
            expect(view.ladder[i].totalCents).toBeGreaterThanOrEqual(view.ladder[i - 1].totalCents);
        }
        expect(view.ladder[0].savingsPct).toBe(0);
        expect(view.ladder[5].tier).toBe('PRODUCTION_RUN');
        expect(view.shippingOptions.map((s) => s.method)).toEqual(['STANDARD', 'EXPEDITED', 'EXPRESS']);
        expect(view.leadTimeDays).toBeGreaterThanOrEqual(2 + 1 + 3 + 1); // queue + production + powder coat + QA
        expect(new Date(view.validUntil).getTime() - new Date(view.createdAt).getTime()).toBe(14 * 24 * 3600 * 1000);
        expect(view.dfm).toMatchObject({ materialId: 'mat_steel_crs', thicknessOptionId: 'thk_crs_16ga', blocking: false });

        // DB invariants: internal split is persisted and balanced, never exposed.
        const [qrow] = await ctx.db.select().from(quotes).where(eq(quotes.id, view.id));
        expect(qrow.shopCostCents + qrow.platformFeeCents).toBe(qrow.subtotalCents);
        expect(qrow.rateCardId).toBe('rc_philadelphia_precision_v1');
        expect(JSON.stringify(view)).not.toMatch(/shopCost|platformFee/);

        // Read paths.
        const got = await getQuoteRoute(new Request(`${BASE}/api/quotes/${view.id}`), params({ quoteId: view.id }));
        expect(QuoteView.parse(await got.json())).toEqual(view);
        const buildRes = await getBuildRoute(new Request(`${BASE}/api/builds/${created.buildId}`), params({ buildId: created.buildId }));
        const build = BuildView.parse(await buildRes.json());
        expect(build).toMatchObject({ id: created.buildId, displayId: created.buildDisplayId, name: 'plate-holes-mm', status: 'READY', latestQuoteId: view.id });

        // Events: same transaction as each state change, correlated by build.
        const events = await ctx.db.select().from(domainEvents).where(eq(domainEvents.buildId, created.buildId)).orderBy(asc(domainEvents.timestamp));
        expect(events.map((e) => e.eventType)).toEqual(['build.created', 'part.uploaded', 'part.analyzed', 'dfm.completed', 'dfm.completed', 'quote.created']);
        expect(new Set(events.map((e) => e.correlationId))).toEqual(new Set([created.buildId]));
        expect(events.at(-1)?.payload).toMatchObject({ quoteId: view.id, status: 'READY', trustLevel: 'BINDING', subtotalCents: view.subtotalCents });

        // Ordering (called by the orders module inside its payment transaction).
        await ctx.db.transaction(async (tx) => markQuoteOrdered(view.id, tx));
        await markQuoteOrdered(view.id); // idempotent
        const ordered = await getQuote(view.id);
        expect(ordered).toMatchObject({ status: 'ORDERED', orderable: false });

        // The ordered design is frozen: same-file re-analyze is a no-op, changes are refused.
        expect(await analyzePart(created.partId)).toMatchObject({ designVersion: 1, status: 'READY' });
        await expect(analyzePart(created.partId, { units: 'in' })).rejects.toMatchObject({ code: 'CONFLICT' });
        const reupload = await postUpload(new Request(`${BASE}/api/parts/${created.partId}/upload`, { method: 'PUT', headers: { cookie: DEVICE_COOKIE_HEADER }, body: fixture('l-bracket-flat').build() }), params({ partId: created.partId }));
        expect(reupload.status).toBe(409);
        await getStorage().putObject(created.upload.key, fixture('l-bracket-flat').build()); // signed-URL re-PUT
        await expect(analyzePart(created.partId)).rejects.toMatchObject({ code: 'CONFLICT' });
        const [frozen] = await ctx.db.select().from(parts).where(eq(parts.id, created.partId));
        expect(frozen.fileKey).toBe(row.fileKey);
    });

    it('freezes the design as soon as a checkout exists (before payment), so the shop gets what was paid for', async () => {
        const created = await uploadViaSignedUrl('plate-holes-mm');
        await analyze(created.partId);
        const view = QuoteView.parse((await quote({ partId: created.partId, ...STEEL_16GA, quantity: 5 })).body);
        const [before] = await ctx.db.select().from(parts).where(eq(parts.id, created.partId));
        const checkout = await createCheckout({
            quoteId: view.id,
            shippingMethod: 'STANDARD',
            buyer: { email: 'maker@example.com', name: 'Ada Maker' },
            shippingAddress: { name: 'Ada Maker', line1: '100 Market St', city: 'Philadelphia', region: 'PA', postalCode: '19106', country: 'US' },
            acceptTerms: true,
        });
        expect(checkout.status).toBe('PENDING_PAYMENT');

        // Units flip and re-uploads are refused while the payment is pending.
        expect(await analyzePart(created.partId)).toMatchObject({ designVersion: 1, status: 'READY' });
        await expect(analyzePart(created.partId, { units: 'in' })).rejects.toMatchObject({ code: 'CONFLICT' });
        const reupload = await postUpload(new Request(`${BASE}/api/parts/${created.partId}/upload`, { method: 'PUT', headers: { cookie: DEVICE_COOKIE_HEADER }, body: fixture('l-bracket-flat').build() }), params({ partId: created.partId }));
        expect(reupload.status).toBe(409);
        await getStorage().putObject(created.upload.key, fixture('l-bracket-flat').build()); // signed-URL re-PUT
        await expect(analyzePart(created.partId)).rejects.toMatchObject({ code: 'CONFLICT' });
        const [after] = await ctx.db.select().from(parts).where(eq(parts.id, created.partId));
        expect(after).toMatchObject({ designVersion: before.designVersion, fileKey: before.fileKey, fileSha256: before.fileSha256, status: 'READY' });
        expect(after.features).toEqual(before.features);

        // An abandoned (cancelled) checkout releases the design again.
        await ctx.db.update(orders).set({ status: 'CANCELLED' }).where(eq(orders.id, checkout.orderId));
        expect(await analyzePart(created.partId, { units: 'in' })).toMatchObject({ designVersion: 2 });
    });

    it('is deterministic for identical configurations', async () => {
        const created = await uploadViaSignedUrl('l-bracket-flat');
        await analyze(created.partId);
        const cfg = { partId: created.partId, ...STEEL_16GA, quantity: 25 };
        const a = QuoteView.parse((await quote(cfg)).body);
        const b = QuoteView.parse((await quote(cfg)).body);
        expect(a.id).not.toBe(b.id);
        for (const k of ['lineItems', 'ladder', 'unitPriceCents', 'subtotalCents', 'shippingOptions', 'shipDate', 'dfm'] as const) {
            if (k === 'dfm') expect({ ...a.dfm, checkedAt: '' }).toEqual({ ...b.dfm, checkedAt: '' });
            else expect(a[k]).toEqual(b[k]);
        }
    });

    it('asks for units, re-quotes on the new design version and stales older quotes', async () => {
        const created = await uploadViaSignedUrl('unitless-ambiguous');
        const ask = await analyze(created.partId);
        expect(ask).toMatchObject({ status: 'NEEDS_INPUT', universalStatus: 'NEEDS_INPUT', units: null, features: null });
        expect(ask.preview?.widthMm).toBeCloseTo(30, 3);
        const blocked = await quote({ partId: created.partId, ...STEEL_16GA, quantity: 1 });
        expect(blocked.status).toBe(409);
        expect(ApiErrorBody.parse(blocked.body).error.message).toMatch(/units/);

        const inches = await analyze(created.partId, { units: 'in' });
        expect(inches).toMatchObject({ status: 'READY', units: 'in', designVersion: 1 });
        expect(inches.features?.bboxWidthMm).toBeCloseTo(762, 3);
        const first = QuoteView.parse((await quote({ partId: created.partId, materialId: 'mat_al_5052', thicknessOptionId: 'thk_al5052_063', quantity: 1 })).body);
        expect(first.orderable).toBe(true);

        // A plain re-analyze keeps the buyer's units; switching units bumps the design version.
        expect((await analyze(created.partId)).designVersion).toBe(1);
        const mm = await analyze(created.partId, { units: 'mm' });
        expect(mm).toMatchObject({ units: 'mm', designVersion: 2 });
        expect(await getQuote(first.id)).toMatchObject({ status: 'EXPIRED', orderable: false, designVersion: 1 });
        const build = await getBuild(created.buildId);
        expect(build?.latestQuoteId).toBeNull(); // no quote for design v2 yet
    });

    it('blocks ordering on blocking DFM and suggests a fix; another material quotes clean', async () => {
        const created = await uploadViaSignedUrl('tiny-hole');
        await analyze(created.partId);
        const steel = QuoteView.parse((await quote({ partId: created.partId, ...STEEL_16GA, quantity: 5 })).body);
        expect(steel).toMatchObject({ status: 'NEEDS_INPUT', trustLevel: 'SUPPLIER_ESTIMATE', orderable: false });
        expect(steel.dfm.violations.map((v) => v.ruleId)).toEqual(['min_hole_diameter']);
        expect(steel.dfm.violations[0]).toMatchObject({ severity: 'BLOCKING', location: [25, 25], thresholdMm: 1.52 });
        expect(steel.subtotalCents).toBeGreaterThan(0); // still priced so the buyer sees the number while fixing
        await expect(markQuoteOrdered(steel.id)).rejects.toMatchObject({ code: 'CONFLICT' });
        expect((await getBuild(created.buildId))?.status).toBe('NEEDS_INPUT');

        const alu = QuoteView.parse((await quote({ partId: created.partId, materialId: 'mat_al_5052', thicknessOptionId: 'thk_al5052_040', quantity: 5 })).body);
        expect(alu).toMatchObject({ status: 'READY', trustLevel: 'BINDING', orderable: true });
    });

    it('prices bending from bend lines and requires it when the file has them', async () => {
        const created = await uploadViaSignedUrl('bent-bracket');
        await analyze(created.partId);
        const flat = QuoteView.parse((await quote({ partId: created.partId, ...STEEL_16GA, quantity: 2 })).body);
        expect(flat.status).toBe('NEEDS_INPUT');
        expect(flat.dfm.violations.map((v) => v.ruleId)).toEqual(['bend_not_supported']);
        const bent = QuoteView.parse((await quote({ partId: created.partId, ...STEEL_16GA, services: [{ serviceId: 'svc_bending' }], quantity: 2 })).body);
        expect(bent).toMatchObject({ status: 'READY', orderable: true });
        expect(bent.lineItems.find((l) => l.code === 'BENDING')?.explainer).toMatch(/1 bend per part/);
    });

    it('sends configurations no shop can run instantly to REVIEW', async () => {
        const created = await uploadViaSignedUrl('l-bracket-flat');
        await analyze(created.partId);
        await ctx.db.update(shopCapabilities).set({ active: false }).where(eq(shopCapabilities.thicknessOptionId, 'thk_ss304_16ga'));
        try {
            const review = QuoteView.parse((await quote({ partId: created.partId, materialId: 'mat_ss_304', thicknessOptionId: 'thk_ss304_16ga', quantity: 3 })).body);
            expect(review).toMatchObject({ status: 'REVIEW', trustLevel: 'SUPPLIER_ESTIMATE', orderable: false });
            expect(review.route.machineLabel).toBeNull();
            expect((await getBuild(created.buildId))?.status).toBe('REVIEW');
        } finally {
            await ctx.db.update(shopCapabilities).set({ active: true }).where(eq(shopCapabilities.thicknessOptionId, 'thk_ss304_16ga'));
        }
    });

    it('expires quotes after valid_until', async () => {
        const created = await uploadViaSignedUrl('l-bracket-flat');
        await analyze(created.partId);
        const q = QuoteView.parse((await quote({ partId: created.partId, ...STEEL_16GA, quantity: 1 })).body);
        await ctx.db.update(quotes).set({ validUntil: sql`now() - interval '1 minute'` }).where(eq(quotes.id, q.id));
        expect(await getQuote(q.id)).toMatchObject({ status: 'EXPIRED', orderable: false });
    });
});

describe('validation and errors', () => {
    let partId = '';
    beforeAll(async () => {
        const created = await createPartUpload({ filename: 'plate.dxf', sizeBytes: 1000 });
        await getStorage().putObject(created.upload.key, fixture('plate-holes-mm').build());
        partId = created.partId;
        await analyzePart(partId);
    });

    const expectError = async (body: CreateQuoteRequest, status: number, code: string, message?: RegExp) => {
        const r = await quote(body);
        expect(r.status).toBe(status);
        const err = ApiErrorBody.parse(r.body).error;
        expect(err.code).toBe(code);
        if (message) expect(err.message).toMatch(message);
    };

    it('rejects incompatible or incomplete configurations', async () => {
        await expectError({ partId, ...STEEL_16GA, finishServiceId: 'svc_anodize_black', quantity: 1 }, 400, 'VALIDATION_FAILED', /not available for Mild steel/);
        await expectError({ partId, materialId: 'mat_steel_crs', thicknessOptionId: 'thk_al5052_063', quantity: 1 }, 400, 'VALIDATION_FAILED', /Thickness/);
        await expectError({ partId, ...STEEL_16GA, services: [{ serviceId: 'svc_tapping', options: { thread: 'M4' } }], quantity: 1 }, 400, 'VALIDATION_FAILED', /featureCount/);
        await expectError({ partId, ...STEEL_16GA, services: [{ serviceId: 'svc_tapping', featureCount: 2 }], quantity: 1 }, 400, 'VALIDATION_FAILED', /thread/);
        await expectError({ partId, ...STEEL_16GA, services: [{ serviceId: 'svc_tapping', featureCount: 2, options: { thread: 'M99' } }], quantity: 1 }, 400, 'VALIDATION_FAILED', /not an available/);
        await expectError({ partId, ...STEEL_16GA, services: [{ serviceId: 'svc_deburr' }, { serviceId: 'svc_deburr' }], quantity: 1 }, 400, 'VALIDATION_FAILED', /once/);
        await expectError({ partId, ...STEEL_16GA, finishServiceId: 'svc_deburr', quantity: 1 }, 400, 'VALIDATION_FAILED', /finish/);
        await expectError({ partId, ...STEEL_16GA, quantity: 0 }, 400, 'VALIDATION_FAILED');
        await expectError({ partId: 'prt_doesnotexist0000000', ...STEEL_16GA, quantity: 1 }, 404, 'NOT_FOUND');
        // Clients can never send prices: unknown keys are stripped, price comes from the server.
        const r = await quote({ partId, ...STEEL_16GA, quantity: 1, unitPriceCents: 1 } as CreateQuoteRequest);
        expect(QuoteView.parse(r.body).unitPriceCents).toBeGreaterThan(1);
        // Valid tapping on the four Ø6 holes (M4 tap drill mismatch is a warning, not an error).
        const tapped = QuoteView.parse((await quote({ partId, ...STEEL_16GA, services: [{ serviceId: 'svc_tapping', featureCount: 4, options: { thread: 'M4' } }], quantity: 1 })).body);
        expect(tapped.dfm.violations.map((v) => `${v.ruleId}:${v.severity}`)).toEqual(['tap_drill_mismatch:WARNING']);
        expect(tapped.orderable).toBe(true);
    });

    it('rejects non-DXF uploads with specific messages', async () => {
        const step = await postParts(jsonReq('/api/parts', { filename: 'bracket.step', sizeBytes: 1000 }), params({}));
        expect(step.status).toBe(415);
        expect(ApiErrorBody.parse(await step.json()).error.message).toMatch(/STEP upload is coming in R1\.5/);
        const big = await postParts(jsonReq('/api/parts', { filename: 'big.dxf', sizeBytes: 30 * 1024 * 1024 }), params({}));
        expect(big.status).toBe(413);
        const bad = await postParts(jsonReq('/api/parts', '{not json'), params({}));
        expect(bad.status).toBe(400);
        const missing = await postParts(jsonReq('/api/parts', { filename: 'x.dxf' }), params({}));
        expect(ApiErrorBody.parse(await missing.json()).error.code).toBe('VALIDATION_FAILED');
    });

    it('caps request bodies by bytes streamed, not by Content-Length (chunked uploads cannot exhaust memory)', async () => {
        const created = await createPartUpload({ filename: 'chunked.dxf', sizeBytes: 100 });
        let pulled = 0;
        const chunk = new Uint8Array(1024 * 1024).fill(0x20);
        const endless = () =>
            new ReadableStream<Uint8Array>({
                pull(controller) {
                    pulled += chunk.byteLength;
                    if (pulled > 200 * 1024 * 1024) controller.close(); // safety net for the test itself
                    else controller.enqueue(chunk);
                },
            });
        const streamed = (url: string, headers: Record<string, string> = {}) =>
            new Request(url, { method: 'PUT', headers, body: endless(), duplex: 'half' } as RequestInit & { duplex: 'half' });
        expect(streamed(`${BASE}/x`).headers.get('content-length')).toBeNull();

        const direct = await postUpload(streamed(`${BASE}/api/parts/${created.partId}/upload`), params({ partId: created.partId }));
        expect(direct.status).toBe(413);
        expect(pulled).toBeLessThan(30 * 1024 * 1024);

        pulled = 0;
        const url = new URL(created.upload.url);
        const key = url.pathname.replace('/api/storage/local/', '').split('/');
        const signedPut = await putLocalStorage(streamed(created.upload.url, created.upload.headers), params({ key }));
        expect(signedPut.status).toBe(413);
        expect(pulled).toBeLessThan(30 * 1024 * 1024);

        pulled = 0;
        const json = await postParts(streamed(`${BASE}/api/parts`, { 'content-type': 'application/json' }), params({}));
        expect(json.status).toBe(413);
        expect(pulled).toBeLessThan(2 * 1024 * 1024);
    });

    it('analyze: 409 before upload, FAILED for unreadable content', async () => {
        const created = await createPartUpload({ filename: 'later.dxf', sizeBytes: 100 });
        const early = await postAnalyze(new Request(`${BASE}/api/parts/${created.partId}/analyze`, { method: 'POST' }), params({ partId: created.partId }));
        expect(early.status).toBe(409);

        await getStorage().putObject(created.upload.key, '%PDF-1.7 not a drawing');
        const failed = await analyze(created.partId);
        expect(failed).toMatchObject({ status: 'FAILED', universalStatus: 'FAILED', features: null });
        expect(failed.error).toMatch(/PDF/);
        const ev = await ctx.db.select().from(domainEvents).where(eq(domainEvents.buildId, created.buildId));
        expect(ev.map((e) => e.eventType).sort()).toEqual(['build.created', 'part.analyzed']);
        expect((await getBuild(created.buildId))?.status).toBe('FAILED');
        await expect(createQuote({ partId: created.partId, ...STEEL_16GA, quantity: 1 })).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('direct multipart upload: sniffs immediately, re-upload bumps the design version', async () => {
        const created = await createPartUpload({ filename: 'direct.dxf', sizeBytes: 100 });
        const form = (content: string, name = 'direct.dxf') => {
            const fd = new FormData();
            fd.set('file', new File([content], name, { type: 'application/dxf' }));
            return new Request(`${BASE}/api/parts/${created.partId}/upload`, { method: 'POST', body: fd });
        };
        const rejected = await postUpload(form('ISO-10303-21;\nHEADER;'), params({ partId: created.partId }));
        expect(rejected.status).toBe(415);
        expect(ApiErrorBody.parse(await rejected.json()).error.message).toMatch(/R1\.5/);

        const ok = await postUpload(form(fixture('d-shape-arcs').build()), params({ partId: created.partId }));
        expect(ok.status).toBe(200);
        expect(PartView.parse(await ok.json()).status).toBe('AWAITING_UPLOAD');
        const v1 = await analyze(created.partId);
        expect(v1).toMatchObject({ status: 'READY', designVersion: 1 });
        const q1 = QuoteView.parse((await quote({ partId: created.partId, ...STEEL_16GA, quantity: 1 })).body);

        // Raw-body re-upload of different geometry.
        const raw = await postUpload(new Request(`${BASE}/api/parts/${created.partId}/upload`, { method: 'PUT', headers: { cookie: DEVICE_COOKIE_HEADER }, body: fixture('rounded-rect-bulge').build() }), params({ partId: created.partId }));
        expect(raw.status).toBe(200);
        const v2 = await analyze(created.partId);
        expect(v2.designVersion).toBe(2);
        expect(v2.features?.holes).toHaveLength(0);
        expect((await getQuote(q1.id))?.orderable).toBe(false);
        const [row] = await ctx.db.select().from(parts).where(eq(parts.id, created.partId));
        expect(row.fileKey).toMatch(/\/v2-[0-9a-f]{12}\.dxf$/);
    });

    it('returns 404 for unknown or malformed ids', async () => {
        for (const [handler, p] of [
            [getPartRoute, { partId: 'prt_unknown000000000000' }],
            [getPartRoute, { partId: 'not-an-id' }],
            [getQuoteRoute, { quoteId: 'qte_unknown000000000000' }],
            [getBuildRoute, { buildId: '../etc' }],
        ] as const) {
            const res = await (handler as (r: Request, c: { params: Promise<unknown> }) => Promise<Response>)(new Request(`${BASE}/x`), params(p));
            expect(res.status).toBe(404);
            expect(ApiErrorBody.parse(await res.json()).error.code).toBe('NOT_FOUND');
        }
        await expect(analyzePart('prt_unknown000000000000')).rejects.toMatchObject({ code: 'NOT_FOUND' });
        await expect(markQuoteOrdered('qte_unknown000000000000')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
});
