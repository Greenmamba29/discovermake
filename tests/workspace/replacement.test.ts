/**
 * "Order a replacement" from a Product Passport (1000-3): a fresh quote for the same part design
 * (same verified file, material, thickness, finish; quantity 1) on a NEW build, traced back to
 * the passport, with nothing private about the original order reachable.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PassportSnapshot } from '@/contracts/passport';
import { ReplacementResponse } from '@/contracts/workspace';
import { createOrderAccessToken, hashOrderAccessToken } from '@/server/auth/order-link';
import { sha256Hex } from '@/server/auth/tokens';
import { builds, domainEvents, orders, parts, passportReplacements, passports, quotes } from '@/server/db/schema';
import { newId, newOrderNumber } from '@/server/ids';
import { hashSnapshot, signSnapshotHash } from '@/server/passport';
import { analyzePart, createPartUpload, createQuote, getQuote, uploadPartBytes } from '@/server/quote';
import { getStorage, LocalDiskStorage, setStorage } from '@/server/storage';
import { replacementLimiter } from '@/server/workspace/request';
import { POST as replacementRoute } from '@/app/api/passport/[passportId]/replacement/route';
import { sampleBracketDxf } from '@/lib/sample-dxf';
import { useTestDb as withTestDb } from '../support/db';

const BASE = 'http://localhost:3100';
let ip = 0;
const post = (passportId: string, body?: unknown, fixedIp?: string) =>
    new Request(`${BASE}/api/passport/${passportId}/replacement`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': fixedIp ?? `198.18.0.${++ip % 250}` },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
const params = (passportId: string) => ({ params: Promise.resolve({ passportId }) });

const ctx = withTestDb({ seed: true });
let storageDir = '';

beforeAll(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), 'dm-replace-'));
    setStorage(new LocalDiskStorage({ rootDir: storageDir, appUrl: BASE, signingSecret: process.env.STORAGE_SIGNING_SECRET ?? 'test-storage-secret' }));
});
afterAll(async () => {
    setStorage(null);
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
});
beforeEach(() => replacementLimiter.reset());

/** A real analyzed part + BINDING quote, a completed order and an ACTIVE signed passport for it. */
async function deliveredPassport(opts: { tamper?: boolean } = {}) {
    const dxf = new TextEncoder().encode(sampleBracketDxf());
    const created = await createPartUpload({ filename: 'mounting-plate.dxf', sizeBytes: dxf.byteLength, contentType: 'application/dxf' } as never);
    await uploadPartBytes(created.partId, dxf);
    const part = await analyzePart(created.partId);
    expect(part.status).toBe('READY');
    const quote = await createQuote({ partId: created.partId, materialId: 'mat_al_6061', thicknessOptionId: 'thk_al6061_090', finishServiceId: null, services: [], quantity: 12 });
    expect(quote.trustLevel).toBe('BINDING');

    const orderId = newId('order');
    const orderNumber = newOrderNumber();
    await ctx.db.insert(orders).values({
        id: orderId,
        orderNumber,
        buildId: created.buildId,
        quoteId: quote.id,
        orderType: 'SMALL_BATCH',
        status: 'COMPLETE',
        buyerEmail: 'private-buyer@example.com',
        buyerName: 'Private Buyer',
        shippingAddress: { name: 'Private Buyer', line1: '1 Secret Lane', city: 'Philadelphia', region: 'PA', postalCode: '19106', country: 'US' },
        shippingMethod: 'STANDARD',
        quantity: quote.config.quantity,
        unitPriceCents: quote.unitPriceCents,
        subtotalCents: quote.subtotalCents,
        shippingCents: 1500,
        taxCents: 0,
        totalCents: quote.subtotalCents + 1500,
        shopCostCents: 1,
        platformFeeCents: quote.subtotalCents - 1,
        promisedShipDate: quote.shipDate,
        accessTokenHash: hashOrderAccessToken(orderId, createOrderAccessToken()),
        correlationId: created.buildId,
        termsAcceptedAt: new Date(),
    });
    const passportId = newId('passport');
    const now = new Date().toISOString();
    const snapshot = PassportSnapshot.parse({
        snapshotVersion: 1,
        passportId,
        orderNumber,
        build: { id: created.buildId, displayId: created.buildDisplayId, name: 'Mounting plate' },
        designVersion: quote.designVersion,
        quoteId: quote.id,
        part: { filename: 'mounting-plate.dxf', fileSha256: sha256Hex(Buffer.from(dxf)), bboxWidthMm: 120, bboxHeightMm: 80 },
        material: { name: quote.summary.materialName, thicknessLabel: quote.summary.thicknessLabel, thicknessMm: 2.29 },
        process: quote.summary.processName,
        finish: null,
        services: [],
        quantity: quote.config.quantity,
        shop: { id: quote.route?.shopId ?? 'shop_dev', name: 'Dev shop', city: 'Philadelphia', region: 'PA' },
        manufacturedAt: now,
        milestones: [{ kind: 'CUTTING', at: now }],
        qa: { resultId: 'irs_x', outcome: 'PASS', inspectedAt: now, inspectorName: 'Sam', checks: [] },
        shipment: { carrier: 'UPS', trackingNumber: '••••1234', deliveredAt: now },
        lot: `${orderNumber}-L1`,
        rulesetVersion: quote.rulesetVersion,
    });
    const snapshotHash = hashSnapshot(snapshot);
    await ctx.db.insert(passports).values({
        id: passportId,
        orderId,
        buildId: created.buildId,
        status: 'ACTIVE',
        snapshot,
        snapshotHash,
        signature: opts.tamper ? 'f'.repeat(64) : signSnapshotHash(snapshotHash),
        activatedAt: new Date(),
    });
    return { passportId, quote, partId: created.partId, buildId: created.buildId };
}

describe('replacement quote from a passport', () => {
    it('quotes the same design on a fresh build, quantity 1, traced to the passport', async () => {
        const src = await deliveredPassport();
        const res = await replacementRoute(post(src.passportId), params(src.passportId));
        expect(res.status).toBe(201);
        const body = await res.json();
        const r = ReplacementResponse.parse(body);
        expect(r.url).toBe(`/parts/${r.partId}?from=${r.quoteId}`);
        expect(r).toMatchObject({ status: 'READY', trustLevel: 'BINDING' });
        // Nothing about the original order or build is returned.
        const text = JSON.stringify(body);
        for (const secret of [src.buildId, src.partId, src.quote.id, 'private-buyer', 'Secret Lane']) expect(text).not.toContain(secret);

        const q = (await getQuote(r.quoteId))!;
        expect(q.config).toMatchObject({ materialId: 'mat_al_6061', thicknessOptionId: 'thk_al6061_090', finishServiceId: null, services: [], quantity: 1 });
        expect(q.buildId).not.toBe(src.buildId);
        const [newPart] = await ctx.db.select().from(parts).where(eq(parts.id, r.partId));
        const [oldPart] = await ctx.db.select().from(parts).where(eq(parts.id, src.partId));
        expect(newPart!.fileSha256).toBe(oldPart!.fileSha256);
        expect(newPart!.buildId).toBe(q.buildId);
        const [newBuild] = await ctx.db.select().from(builds).where(eq(builds.id, q.buildId));
        expect(newBuild).toMatchObject({ name: 'Mounting plate (replacement)', origin: 'upload', ownerEmail: null, derivedFromBuildId: null });

        const [trace] = await ctx.db.select().from(passportReplacements).where(eq(passportReplacements.quoteId, r.quoteId));
        expect(trace).toMatchObject({ replacementOfPassportId: src.passportId, sourceQuoteId: src.quote.id, partId: r.partId, quantity: 1 });
        const events = await ctx.db.select().from(domainEvents).where(eq(domainEvents.eventType, 'passport.replacement_quoted'));
        expect(events.some((e) => (e.payload as { quoteId: string }).quoteId === r.quoteId)).toBe(true);

        // A second request reuses the replacement part and adds a quote (here for 3).
        const again = ReplacementResponse.parse(await (await replacementRoute(post(src.passportId, { quantity: 3 }), params(src.passportId))).json());
        expect(again.partId).toBe(r.partId);
        expect(again.quoteId).not.toBe(r.quoteId);
        expect((await getQuote(again.quoteId))!.config.quantity).toBe(3);
        const [orig] = await ctx.db.select().from(quotes).where(eq(quotes.id, src.quote.id));
        expect(orig!.quantity).toBe(12);
    });

    it('refuses unknown, tampered and unavailable passports, bad bodies, and floods', async () => {
        expect((await replacementRoute(post('pps_doesnotexist'), params('pps_doesnotexist'))).status).toBe(404);
        expect((await replacementRoute(post('not-a-passport'), params('not-a-passport'))).status).toBe(404);

        const tampered = await deliveredPassport({ tamper: true });
        expect((await replacementRoute(post(tampered.passportId), params(tampered.passportId))).status).toBe(409);

        const gone = await deliveredPassport();
        const [p] = await ctx.db.select().from(parts).where(eq(parts.id, gone.partId));
        await getStorage().putObject(p!.fileKey, 'different bytes', { contentType: 'application/dxf' });
        const missing = await replacementRoute(post(gone.passportId), params(gone.passportId));
        expect(missing.status).toBe(409);
        expect((await missing.json()).error.message).toMatch(/no longer available/);

        const ok = await deliveredPassport();
        expect((await replacementRoute(post(ok.passportId, { quantity: 0 }), params(ok.passportId))).status).toBe(400);
        expect((await replacementRoute(post(ok.passportId, { quantity: 101 }), params(ok.passportId))).status).toBe(400);

        const statuses: number[] = [];
        for (let i = 0; i < 7; i++) statuses.push((await replacementRoute(post('pps_flood', undefined, '198.18.9.9'), params('pps_flood'))).status);
        expect(statuses.slice(0, 6)).toEqual([404, 404, 404, 404, 404, 404]);
        expect(statuses[6]).toBe(429);
    });
});
