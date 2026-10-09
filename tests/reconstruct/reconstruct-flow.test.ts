/**
 * R6 Reconstruct end to end on the server (the Stage 5 G3 demo without a browser):
 * broken knob -> caliper readings -> planner -> CAD worker (the committed golden knob, served by
 * the golden worker stub) -> BINDING print quote from the manifest -> checkout (dev payment) ->
 * order -> dispatch to a printer with an STL job packet. Plus the confirmation gate and authz.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReconstructView } from '@/contracts/reconstruct';
import { POST as createRoute } from '@/app/api/reconstruct/route';
import { POST as dimensionsRoute } from '@/app/api/reconstruct/[buildId]/dimensions/route';
import { POST as generateRoute } from '@/app/api/reconstruct/[buildId]/generate/route';
import { GET as viewRoute } from '@/app/api/reconstruct/[buildId]/route';
import { bgNodes, domainEvents, manufacturingJobs, orders, parts, printQuoteDetails, quotes } from '@/server/db/schema';
import { packetForConsole } from '@/server/dispatch';
import { resetEnvCache } from '@/server/env';
import { createCheckout, handlePaymentSucceeded } from '@/server/orders';
import { getQuote } from '@/server/quote';
import { confirmDimensions, createReconstruct, generateReconstruct, getReconstructView, quoteReconstruct } from '@/server/reconstruct/sessions';
import { reconstructGenerateLimiter, reconstructWriteLimiter } from '@/server/reconstruct/request';
import { LocalDiskStorage, setStorage } from '@/server/storage';
import { checkoutBody } from '../orders/fixtures';
import { useTestDb as withTestDb } from '../support/db';
import { goldenDirWorker } from '../support/cad-golden-worker';

const KNOB_DIR = path.join(process.cwd(), 'tests', 'fixtures', 'cad', 'reconstruct-knob');
const BASE = 'http://localhost:3100';
const OWNER = 'dm_device=reconstructownerdevice00000000000000001';
const STRANGER = 'dm_device=reconstructstrangerdevice000000000000002';
let ip = 0;
const req = (url: string, method: string, cookie: string, body?: unknown) =>
    new Request(`${BASE}${url}`, { method, headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${++ip % 250}`, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
const params = (buildId: string) => ({ params: Promise.resolve({ buildId }) });

const ctx = withTestDb({ seed: true });
let storageDir = '';

beforeAll(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), 'dm-reconstruct-'));
    setStorage(new LocalDiskStorage({ rootDir: storageDir, appUrl: BASE, signingSecret: 'test-storage-secret' }));
    process.env.CAD_WORKER_URL = 'http://cad-worker.test';
    resetEnvCache();
});
afterAll(async () => {
    delete process.env.CAD_WORKER_URL;
    resetEnvCache();
    setStorage(null);
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
});
beforeEach(async () => {
    await reconstructWriteLimiter.reset();
    await reconstructGenerateLimiter.reset();
    vi.spyOn(console, 'info').mockImplementation(() => {});
});

const knobOptions = { shaft: '6mm-d' as const, gripRibs: 12, pointerNotch: true };

describe('Reconstruct: broken knob to a BINDING print quote and a printer job', () => {
    it('blocks generation until every critical dimension has a caliper reading', async () => {
        const { buildId } = await createReconstruct({ partType: 'knob', description: 'Stove knob snapped off', options: knobOptions }, { ownerUserId: null, deviceHash: null });
        const worker = goldenDirWorker(KNOB_DIR);
        const first = await generateReconstruct(buildId, { fetchImpl: worker });
        expect(first).toMatchObject({ status: 'needs_input', missing: ['diameter_mm', 'height_mm'] });

        await confirmDimensions(buildId, { readings: [{ param: 'diameter_mm', value: 1.5, unit: 'in' }] });
        const second = await generateReconstruct(buildId, { fetchImpl: worker });
        expect(second).toMatchObject({ status: 'needs_input', missing: ['height_mm'] });
        expect(worker.calls).toHaveLength(0);
    });

    it('caliper readings -> golden CAD -> BINDING print quote -> checkout -> printer job with the STL', async () => {
        const { buildId } = await createReconstruct({ partType: 'knob', description: 'Stove knob, 1.5 in across', options: knobOptions }, { ownerUserId: null, deviceHash: null });
        await confirmDimensions(buildId, { readings: [{ param: 'diameter_mm', value: 1.5, unit: 'in' }] });
        await confirmDimensions(buildId, { readings: [{ param: 'height_mm', value: 22, unit: 'mm' }] });

        // Caliper dims are buyer-stated graph nodes (the CAD agent's rule applies unchanged).
        const dims = await ctx.db.select().from(bgNodes).where(and(eq(bgNodes.buildId, buildId), eq(bgNodes.key, 'dim:diameter_mm')));
        const latestDim = dims.sort((a, b) => b.designVersion - a.designVersion)[0]!;
        expect(latestDim).toMatchObject({ type: 'REQUIREMENT', source: 'user' });
        expect(latestDim.data).toMatchObject({ source: 'caliper', requirementSource: 'user', valueMm: 38.1, enteredValue: 1.5, enteredUnit: 'in' });
        expect(typeof latestDim.data.confirmedAt).toBe('string');

        const worker = goldenDirWorker(KNOB_DIR);
        const generated = await generateReconstruct(buildId, { fetchImpl: worker });
        expect(generated.status).toBe('generated');
        if (generated.status !== 'generated') return;
        expect(generated.family).toBe('round_knob');
        expect(worker.calls).toHaveLength(1);

        const quote = (await getQuote(generated.quoteId!))!;
        expect(quote).toMatchObject({ status: 'READY', trustLevel: 'BINDING', orderable: true });
        expect(quote.config.process).toBe('print');
        expect(quote.config.materialId).toBe('mat_print_asa'); // knobs default to heat-resistant ASA
        expect(quote.ladder.map((r) => r.quantity)).toEqual([1, 10, 25, 50, 100]);
        expect(quote.route.machineLabel).toMatch(/FDM farm/);
        expect(quote.lineItems.reduce((s, l) => s + l.totalCents, 0)).toBe(quote.subtotalCents);
        const [details] = await ctx.db.select().from(printQuoteDetails).where(eq(printQuoteDetails.quoteId, quote.id));
        expect(details!.criticalDims.map((d) => d.param).sort()).toEqual(['diameter_mm', 'height_mm']);
        const [printed] = await ctx.db.select().from(parts).where(eq(parts.id, quote.partId));
        expect(printed).toMatchObject({ format: 'stl', status: 'READY' });

        // Re-quote: same printed part (one per CAD version), different material.
        const pla = await quoteReconstruct(buildId, { printMaterialSlug: 'pla', quantity: 10 });
        expect(pla.partId).toBe(quote.partId);
        expect(pla.unitPriceCents).toBeLessThan(quote.unitPriceCents);

        const view = await getReconstructView(buildId, { canEdit: true });
        expect(view.quoteId).toBe(pla.id);
        expect(view.cadVersion).toBe(generated.version);
        expect(view.allConfirmed).toBe(true);

        // Checkout and payment are the R1 path, unchanged.
        const checkout = await createCheckout(checkoutBody(quote.id));
        await handlePaymentSucceeded({ provider: 'dev', providerRef: checkout.payment.providerRef, providerPaymentId: null, amountCents: checkout.payment.amountCents ?? checkout.totals.totalCents, currency: 'usd', eventId: `evt_${checkout.orderId}` });
        const [order] = await ctx.db.select().from(orders).where(eq(orders.id, checkout.orderId));
        expect(['PAID', 'DISPATCHED']).toContain(order!.status);
        if (order!.status === 'PAID') {
            const { dispatchOrder } = await import('@/server/dispatch');
            await dispatchOrder(order!.id);
        }
        const [job] = await ctx.db.select().from(manufacturingJobs).where(eq(manufacturingJobs.orderId, checkout.orderId));
        expect(job).toBeDefined();
        expect(job!.packet.print).toMatchObject({ process: 'FDM', family: 'round_knob', stlSha256: details!.stlSha256 });
        expect(job!.packet.part.filename).toMatch(/\.stl$/);
        expect(job!.sourceFileSha256).toBe(details!.stlSha256);
        const forShop = await packetForConsole(job!.packet, 'ACCEPTED', { fileKey: job!.sourceFileKey!, filename: job!.packet.part.filename });
        expect(forShop.files).toEqual([expect.objectContaining({ kind: 'SOURCE_STL' })]);
        const [q] = await ctx.db.select({ status: quotes.status }).from(quotes).where(eq(quotes.id, quote.id));
        expect(q!.status).toBe('ORDERED');

        // My Builds "Reorder" re-quotes the printed part on the print engine.
        const { reorderBuild } = await import('@/server/accounts/my-builds');
        const again = await reorderBuild({ viewer: null, deviceHash: null }, buildId);
        const reordered = (await getQuote(again.quoteId))!;
        expect(reordered).toMatchObject({ trustLevel: 'BINDING', orderable: true, partId: quote.partId });
        expect(reordered.config.process).toBe('print');

        const types = (await ctx.db.select({ type: domainEvents.eventType }).from(domainEvents).where(eq(domainEvents.buildId, buildId))).map((e) => e.type);
        expect(types).toEqual(expect.arrayContaining(['reconstruct.started', 'reconstruct.dimension_confirmed', 'reconstruct.cad_generated', 'quote.created']));
    });

    it('answers 503 "CAD service unavailable" without a worker and writes nothing', async () => {
        const { buildId } = await createReconstruct({ partType: 'spacer', options: { flanged: false } }, { ownerUserId: null, deviceHash: null });
        await confirmDimensions(buildId, {
            readings: [
                { param: 'outer_diameter_mm', value: 12, unit: 'mm' },
                { param: 'inner_diameter_mm', value: 6.5, unit: 'mm' },
                { param: 'length_mm', value: 10, unit: 'mm' },
            ],
        });
        delete process.env.CAD_WORKER_URL;
        resetEnvCache();
        try {
            await expect(generateReconstruct(buildId)).rejects.toMatchObject({ status: 503, details: { reason: 'CAD_UNAVAILABLE' } });
            const view = await getReconstructView(buildId, { canEdit: true });
            expect(view.cadAvailable).toBe(false);
            expect(view.cadVersion).toBeNull();
            expect(view.plan.status).toBe('ready');
        } finally {
            process.env.CAD_WORKER_URL = 'http://cad-worker.test';
            resetEnvCache();
        }
    });
});

describe('Reconstruct routes: ownership', () => {
    it('only the device that started it may confirm or generate (403 for anyone else)', async () => {
        const created = await createRoute(req('/api/reconstruct', 'POST', OWNER, { partType: 'knob', options: knobOptions }), { params: Promise.resolve({}) });
        expect(created.status).toBe(201);
        const { buildId } = (await created.json()) as { buildId: string };

        const theirs = await dimensionsRoute(req(`/api/reconstruct/${buildId}/dimensions`, 'POST', STRANGER, { readings: [{ param: 'diameter_mm', value: 38.1, unit: 'mm' }] }), params(buildId));
        expect(theirs.status).toBe(403);
        expect((await generateRoute(req(`/api/reconstruct/${buildId}/generate`, 'POST', STRANGER), params(buildId))).status).toBe(403);

        const mine = await dimensionsRoute(req(`/api/reconstruct/${buildId}/dimensions`, 'POST', OWNER, { readings: [{ param: 'diameter_mm', value: 38.1, unit: 'mm' }] }), params(buildId));
        expect(mine.status).toBe(200);
        const view = ReconstructView.parse(await mine.json());
        expect(view.dimensions.find((d) => d.param === 'diameter_mm')).toMatchObject({ caliperMm: 38.1, source: 'caliper' });

        // Viewing is open (unguessable id), but the stranger is told they cannot edit.
        const seen = await viewRoute(req(`/api/reconstruct/${buildId}`, 'GET', STRANGER), params(buildId));
        expect(seen.status).toBe(200);
        expect(((await seen.json()) as { canEdit: boolean }).canEdit).toBe(false);
    });

    it('rejects a reading for a dimension the part does not need', async () => {
        const created = await createRoute(req('/api/reconstruct', 'POST', OWNER, { partType: 'spacer' }), { params: Promise.resolve({}) });
        const { buildId } = (await created.json()) as { buildId: string };
        const res = await dimensionsRoute(req(`/api/reconstruct/${buildId}/dimensions`, 'POST', OWNER, { readings: [{ param: 'flange_diameter_mm', value: 18, unit: 'mm' }] }), params(buildId));
        expect(res.status).toBe(400);
    });
});
