/**
 * Fixtures for shop suites: an analyzed part + READY/BINDING quote built directly in the
 * test database (the quote engine is exercised by tests/quote), PAID orders, extra shops,
 * and helpers that drive a job through the Shop Console module functions.
 */
import { eq } from 'drizzle-orm';
import { vi } from 'vitest';
import type { Address } from '@/contracts/common';
import type { InspectionMeasurement } from '@/contracts/shop';
import type { PartFeatures, PartPreview } from '@/contracts/parts';
import { createOrderAccessToken, hashOrderAccessToken } from '@/server/auth/order-link';
import { generateToken, sha256Hex } from '@/server/auth/tokens';
import type { Db } from '@/server/db';
import { DEV_RATE_CARD_ID, DEV_SHOP_ID, R1_RULESET_VERSION } from '@/server/db/seed';
import { builds, inspectionPlans, orders, parts, quotes, shopAccessTokens, shopCapabilities, shopRateCards, shops } from '@/server/db/schema';
import { newBuildDisplayId, newId, newOrderNumber } from '@/server/ids';
import { recordPaymentSplit } from '@/server/ledger';
import { advanceOrder } from '@/server/orders';
import { getStorage } from '@/server/storage';

export const THK = 'thk_al5052_063';
export const FIBER = 'prc_fiber_laser';
export const BRAKE = 'prc_press_brake';

export const BUYER_ADDRESS: Address = { name: 'Ada Maker', line1: '100 Market St', city: 'Philadelphia', region: 'PA', postalCode: '19106', country: 'US' };

export function plateFeatures(opts: { bend?: boolean; widthMm?: number; heightMm?: number } = {}): PartFeatures {
    const w = opts.widthMm ?? 120;
    const h = opts.heightMm ?? 80;
    const holes = [
        [10, 10],
        [w - 10, 10],
        [10, h - 10],
        [w - 10, h - 10],
    ].map(([x, y]) => ({ center: [x, y] as [number, number], diameterMm: 6.35, circular: true, edgeDistanceMm: 6.8 }));
    const bendLines = opts.bend ? [{ from: [0, h / 2] as [number, number], to: [w, h / 2] as [number, number], lengthMm: w, angleDeg: 90 }] : [];
    return {
        sourceUnits: 'mm',
        unitsFromFile: true,
        bboxWidthMm: w,
        bboxHeightMm: h,
        outerContourCount: 1,
        innerContourCount: 4,
        openContourCount: 0,
        cutLengthMm: 2 * (w + h) + 4 * Math.PI * 6.35,
        pierceCount: 5,
        netAreaMm2: w * h - 4 * Math.PI * 3.175 ** 2,
        grossAreaMm2: w * h,
        smallestFeatureMm: 6.35,
        smallestHoleMm: 6.35,
        minHoleToEdgeMm: 6.8,
        holes,
        bendLines,
        bendCount: bendLines.length,
        textEntityCount: 0,
        entityCounts: { LWPOLYLINE: 1, CIRCLE: 4, ...(opts.bend ? { LINE: 1 } : {}) },
    };
}

function previewFor(f: PartFeatures): PartPreview {
    const w = f.bboxWidthMm;
    const h = f.bboxHeightMm;
    return {
        outer: [
            [
                [0, 0],
                [w, 0],
                [w, h],
                [0, h],
            ],
        ],
        holes: [],
        bendLines: f.bendLines.map((b) => [b.from, b.to] as [[number, number], [number, number]]),
        widthMm: w,
        heightMm: h,
        svgPath: `M0 0 L${w} 0 L${w} ${h} L0 ${h} Z`,
    };
}

export type QuoteFixtureOptions = { quantity?: number; bend?: boolean; finish?: boolean; widthMm?: number; heightMm?: number; unitPriceCents?: number };

export async function createQuoteFixture(db: Db, opts: QuoteFixtureOptions = {}) {
    const quantity = opts.quantity ?? 10;
    const unit = opts.unitPriceCents ?? 900;
    const subtotal = unit * quantity;
    const fee = Math.round(subtotal * 0.26);
    const shopCost = subtotal - fee;
    const features = plateFeatures({ bend: opts.bend, widthMm: opts.widthMm, heightMm: opts.heightMm });
    const [build] = await db.insert(builds).values({ displayId: newBuildDisplayId(), name: 'Mounting bracket', status: 'READY' }).returning();
    const partId = newId('part');
    const fileKey = `parts/${partId}/source.dxf`;
    const dxf = '0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n';
    await getStorage().putObject(fileKey, dxf, { contentType: 'application/dxf' });
    const [part] = await db
        .insert(parts)
        .values({
            id: partId,
            buildId: build.id,
            fileKey,
            filename: 'bracket.dxf',
            sizeBytes: dxf.length,
            fileSha256: sha256Hex(dxf),
            status: 'READY',
            units: 'mm',
            designVersion: 1,
            features,
            preview: previewFor(features),
            rulesetVersion: R1_RULESET_VERSION,
            analyzedAt: new Date(),
        })
        .returning();
    const services = opts.bend ? [{ serviceId: 'svc_bending' }] : [];
    const [quote] = await db
        .insert(quotes)
        .values({
            partId: part.id,
            buildId: build.id,
            designVersion: 1,
            shopId: DEV_SHOP_ID,
            rateCardId: DEV_RATE_CARD_ID,
            config: { partId: part.id, materialId: 'mat_al_5052', thicknessOptionId: THK, finishServiceId: opts.finish ? 'svc_powder_black' : null, services, quantity },
            summary: {
                materialName: 'Aluminum 5052-H32',
                thicknessLabel: '.063" (1.6 mm)',
                processName: 'Fiber laser cutting',
                finishName: opts.finish ? 'Powder coat · Black' : null,
                serviceNames: opts.bend ? ['Bending'] : [],
                quantity,
                partFilename: 'bracket.dxf',
                bboxWidthMm: features.bboxWidthMm,
                bboxHeightMm: features.bboxHeightMm,
                unitMassG: 41,
            },
            quantity,
            tier: quantity < 10 ? 'PROTOTYPE' : quantity < 250 ? 'SMALL_BATCH' : 'PRODUCTION_RUN',
            lineItems: [
                { code: 'CUTTING', label: 'Cutting', explainer: 'Laser time.', unitCents: Math.round(shopCost / quantity), quantity, totalCents: shopCost },
                { code: 'PLATFORM_FEE', label: 'Platform fee', explainer: 'DiscoverMake.', unitCents: fee, quantity: 1, totalCents: fee },
            ],
            ladder: [],
            shippingOptions: [{ method: 'STANDARD', label: 'Standard (UPS Ground)', priceCents: 1500, deliveryDate: '2026-10-16', transitDays: 4 }],
            dfm: { rulesetVersion: R1_RULESET_VERSION, makeabilityScore: 96, blocking: false, violations: [], materialId: 'mat_al_5052', thicknessOptionId: THK, checkedAt: new Date().toISOString() },
            unitPriceCents: unit,
            subtotalCents: subtotal,
            shopCostCents: shopCost,
            platformFeeCents: fee,
            trustLevel: 'BINDING',
            status: 'READY',
            shipDate: '2026-10-12',
            leadTimeDays: 4,
            validUntil: new Date(Date.now() + 7 * 86400_000),
            rulesetVersion: R1_RULESET_VERSION,
            pricingVersion: 'test-pricing',
            makeabilityScore: 96,
        })
        .returning();
    return { build, part, quote };
}

/** A PAID order (payment split posted) for a fresh quote fixture. Not dispatched yet. */
export async function createPaidOrder(db: Db, opts: QuoteFixtureOptions = {}) {
    const { build, part, quote } = await createQuoteFixture(db, opts);
    const orderId = newId('order');
    const token = createOrderAccessToken();
    await db.insert(orders).values({
        id: orderId,
        orderNumber: newOrderNumber(),
        buildId: build.id,
        quoteId: quote.id,
        orderType: 'SMALL_BATCH',
        status: 'PENDING_PAYMENT',
        buyerEmail: 'maker@example.com',
        buyerName: 'Ada Maker',
        shippingAddress: BUYER_ADDRESS,
        shippingMethod: 'STANDARD',
        quantity: quote.quantity,
        unitPriceCents: quote.unitPriceCents,
        subtotalCents: quote.subtotalCents,
        shippingCents: 1500,
        taxCents: 0,
        totalCents: quote.subtotalCents + 1500,
        shopCostCents: quote.shopCostCents,
        platformFeeCents: quote.platformFeeCents,
        promisedShipDate: quote.shipDate,
        accessTokenHash: hashOrderAccessToken(orderId, token),
        correlationId: build.id,
        termsAcceptedAt: new Date(),
    });
    await advanceOrder(orderId, 'PAID', { kind: 'payment_provider', id: 'dev' });
    await recordPaymentSplit(orderId);
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    return { build, part, quote, order, token };
}

export type ShopFixtureOptions = {
    name: string;
    fiberCentsPerHour?: number;
    bed?: { w: number; h: number };
    brake?: boolean;
    queueDays?: number;
    rating?: number | null;
    status?: 'ACTIVE' | 'PENDING' | 'SUSPENDED';
};

/** Insert a partner shop with a rate card, a fiber capability for THK (and optionally a brake) plus a console token. */
export async function createShopFixture(db: Db, opts: ShopFixtureOptions) {
    const shopId = newId('shop');
    await db.insert(shops).values({
        id: shopId,
        slug: `${opts.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${shopId.slice(-6)}`,
        name: opts.name,
        status: opts.status ?? 'ACTIVE',
        contactEmail: `${shopId}@shops.example.com`,
        address: { name: opts.name, line1: '1 Industrial Way', city: 'Camden', region: 'NJ', postalCode: '08102', country: 'US' },
        city: 'Camden',
        region: 'NJ',
        queueDays: opts.queueDays ?? 2,
        rating: opts.rating ?? null,
    });
    await db.insert(shopRateCards).values({
        id: newId('rateCard'),
        shopId,
        fiberLaserCentsPerHour: opts.fiberCentsPerHour ?? 15000,
        co2LaserCentsPerHour: 9000,
        brakeCentsPerBend: 250,
        brakeSetupCents: 2000,
        orderSetupCents: 1500,
        partHandlingCents: 50,
        finishingCentsPerFt2: 350,
        finishBatchSetupCents: 3500,
        qaCentsPerPart: 25,
        packagingBaseCents: 400,
        platformMarginPct: 0.35,
        minimumOrderCents: 2900,
    });
    const bed = opts.bed ?? { w: 1524, h: 3048 };
    await db.insert(shopCapabilities).values({ shopId, materialId: 'mat_al_5052', thicknessOptionId: THK, processId: FIBER, bedWidthMm: bed.w, bedHeightMm: bed.h, machineLabel: 'Fiber 01' });
    if (opts.brake) {
        await db.insert(shopCapabilities).values({ shopId, materialId: 'mat_al_5052', thicknessOptionId: THK, processId: BRAKE, bedWidthMm: 1250, bedHeightMm: 1250, maxBendLengthMm: 1250 });
    }
    const token = generateToken('dmshop');
    await db.insert(shopAccessTokens).values({ shopId, tokenHash: sha256Hex(token), label: 'console' });
    return { shopId, token };
}

/** Put a QA photo in storage the way the console would (signed PUT), returning its key. */
export async function uploadQaPhoto(jobId: string, n = 1): Promise<string> {
    const key = `qa/${jobId}/photo${n}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    await getStorage().putObject(key, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { contentType: 'image/jpeg' });
    return key;
}

/** Measurements that pass (or fail, for the listed check ids) every check in the job's plan. */
export async function measurementsFor(db: Db, jobId: string, failIds: string[] = []): Promise<InspectionMeasurement[]> {
    const [plan] = await db.select().from(inspectionPlans).where(eq(inspectionPlans.jobId, jobId));
    if (!plan) throw new Error(`no plan for ${jobId}`);
    return plan.checks.map((c) => {
        const fail = failIds.includes(c.id);
        if (c.nominalMm !== null && ['DIMENSION', 'HOLE_DIAMETER', 'FLATNESS', 'BEND_ANGLE'].includes(c.kind)) {
            const measuredValue = fail ? c.nominalMm + (c.tolPlusMm ?? 0) + 1 : c.nominalMm + (c.kind === 'FLATNESS' ? 0.1 : 0.02);
            // The shop claims pass either way: the server recomputes measured checks.
            return { checkId: c.id, measuredValue, pass: true };
        }
        return { checkId: c.id, pass: !fail };
    });
}

/** Silence console noise from the console notify adapter. */
export function quietConsole() {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
}

/** PAID order -> dispatched -> accepted by whichever shop dispatch picked. */
export async function createAcceptedJob(db: Db, opts: QuoteFixtureOptions = {}) {
    const { dispatchOrder } = await import('@/server/dispatch');
    const { acceptJob } = await import('@/server/shops');
    const paid = await createPaidOrder(db, opts);
    const d = await dispatchOrder(paid.order.id);
    if (!d) throw new Error('fixture: dispatch found no shop');
    await acceptJob(d.shopId, d.jobId);
    return { ...paid, jobId: d.jobId, shopId: d.shopId };
}

/** Accepted job -> first milestone -> passing inspection (order QA_PASSED). */
export async function createQaPassedJob(db: Db, opts: QuoteFixtureOptions = {}) {
    const { recordMilestone, submitInspection } = await import('@/server/shops');
    const job = await createAcceptedJob(db, opts);
    await recordMilestone(job.shopId, job.jobId, { kind: 'CUTTING' });
    const photo = await uploadQaPhoto(job.jobId);
    const result = await submitInspection(job.shopId, job.jobId, { measurements: await measurementsFor(db, job.jobId), photoKeys: [photo], inspectorName: 'Sam Inspector' });
    if (result.outcome !== 'PASS') throw new Error('fixture: inspection did not pass');
    return { ...job, inspection: result };
}
