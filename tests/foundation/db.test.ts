import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { advanceOrder } from '@/server/orders';
import { emitEvent, publishPendingEvents } from '@/server/events/outbox';
import { seed, DEV_SHOP_ID } from '@/server/db/seed';
import { builds, domainEvents, orders, orderStatusHistory, parts, quotes, shopAccessTokens, shops, thicknessOptions } from '@/server/db/schema';
import { sha256Hex } from '@/server/auth/tokens';
import { hashOrderAccessToken, verifyOrderAccessToken } from '@/server/auth/order-link';
import { newBuildDisplayId, newOrderNumber } from '@/server/ids';
import { useTestDb } from '../support/db';

const SHOP_TOKEN = 'dmshop_test_token_0123456789abcdefghijklmnop';

describe('foundation database', () => {
    const ctx = useTestDb({ seed: { shopToken: SHOP_TOKEN } });

    it('seeds the catalog idempotently with a hashed shop token', async () => {
        const again = await seed(ctx.db, { shopToken: SHOP_TOKEN });
        expect(again.materials).toBe(8);
        const thk = await ctx.db.select().from(thicknessOptions);
        expect(thk.length).toBe(again.thicknessOptions);
        const [tok] = await ctx.db.select().from(shopAccessTokens).where(eq(shopAccessTokens.shopId, DEV_SHOP_ID));
        expect(tok.tokenHash).toBe(sha256Hex(SHOP_TOKEN));
        expect(tok.tokenHash).not.toContain(SHOP_TOKEN);
    });
});

describe('catalog-only seed (production)', () => {
    const ctx = useTestDb();

    it('seeds the catalog without creating the fictional dev shop', async () => {
        const r = await seed(ctx.db, { catalogOnly: true });
        expect(r).toMatchObject({ materials: 8, shopId: null, rateCardId: null, shopToken: null });
        expect((await ctx.db.select().from(thicknessOptions)).length).toBe(r.thicknessOptions);
        expect(await ctx.db.select().from(shops)).toEqual([]);
        expect(await ctx.db.select().from(shopAccessTokens)).toEqual([]);
    });
});

describe('foundation database (orders)', () => {
    const ctx = useTestDb({ seed: { shopToken: SHOP_TOKEN } });

    it('advances an order with history + outbox event in one transaction', async () => {
        const [build] = await ctx.db.insert(builds).values({ displayId: newBuildDisplayId(), name: 'Test bracket' }).returning();
        const [part] = await ctx.db
            .insert(parts)
            .values({ buildId: build.id, fileKey: 'parts/x/source.dxf', filename: 'bracket.dxf', sizeBytes: 100, status: 'READY', units: 'mm' })
            .returning();
        const [quote] = await ctx.db
            .insert(quotes)
            .values({
                partId: part.id,
                buildId: build.id,
                designVersion: 1,
                shopId: DEV_SHOP_ID,
                rateCardId: 'rc_philadelphia_precision_v1',
                config: { partId: part.id, materialId: 'mat_al_5052', thicknessOptionId: 'thk_al5052_063', finishServiceId: null, services: [], quantity: 10 },
                summary: { materialName: 'Al', thicknessLabel: '.063"', processName: 'Fiber', finishName: null, serviceNames: [], quantity: 10, partFilename: 'bracket.dxf', bboxWidthMm: 50, bboxHeightMm: 30, unitMassG: 6 },
                quantity: 10,
                tier: 'SMALL_BATCH',
                lineItems: [],
                ladder: [],
                shippingOptions: [],
                dfm: { rulesetVersion: 'dfm-2026.10-r1', makeabilityScore: 100, blocking: false, violations: [], materialId: null, thicknessOptionId: null, checkedAt: new Date().toISOString() },
                unitPriceCents: 500,
                subtotalCents: 5000,
                shopCostCents: 3700,
                platformFeeCents: 1300,
                trustLevel: 'BINDING',
                status: 'READY',
                shipDate: '2026-10-12',
                leadTimeDays: 4,
                validUntil: new Date(Date.now() + 86400000),
                rulesetVersion: 'dfm-2026.10-r1',
                pricingVersion: 'test',
                makeabilityScore: 100,
            })
            .returning();
        const [order] = await ctx.db
            .insert(orders)
            .values({
                orderNumber: newOrderNumber(),
                buildId: build.id,
                quoteId: quote.id,
                orderType: 'SMALL_BATCH',
                buyerEmail: 'buyer@example.com',
                buyerName: 'Buyer',
                shippingAddress: { name: 'Buyer', line1: '1 Main St', city: 'Philadelphia', region: 'PA', postalCode: '19103', country: 'US' },
                shippingMethod: 'STANDARD',
                quantity: 10,
                unitPriceCents: 500,
                subtotalCents: 5000,
                shippingCents: 1200,
                taxCents: 0,
                totalCents: 6200,
                shopCostCents: 3700,
                platformFeeCents: 1300,
                promisedShipDate: '2026-10-12',
                accessTokenHash: 'pending',
                correlationId: 'corr_test',
                termsAcceptedAt: new Date(),
            })
            .returning();

        const token = 'dmo_test';
        await ctx.db.update(orders).set({ accessTokenHash: hashOrderAccessToken(order.id, token) }).where(eq(orders.id, order.id));
        const [stored] = await ctx.db.select().from(orders).where(eq(orders.id, order.id));
        expect(verifyOrderAccessToken(order.id, token, stored.accessTokenHash)).toBe(true);
        expect(verifyOrderAccessToken(order.id, 'wrong', stored.accessTokenHash)).toBe(false);

        const updated = await advanceOrder(order.id, 'PAID', { kind: 'payment_provider', id: 'dev' });
        expect(updated.status).toBe('PAID');
        expect(updated.paidAt).toBeInstanceOf(Date);
        expect(updated.version).toBe(2);

        await expect(advanceOrder(order.id, 'SHIPPED', { kind: 'system', id: 'test' })).rejects.toThrow(/Illegal order transition/);

        const history = await ctx.db.select().from(orderStatusHistory).where(eq(orderStatusHistory.orderId, order.id));
        expect(history).toHaveLength(1);
        const events = await ctx.db.select().from(domainEvents).where(eq(domainEvents.orderId, order.id));
        expect(events.map((e) => e.eventType)).toEqual(['order.status_changed']);
        expect(events[0].actorId).toBe('payment_provider:dev');
        expect(history[0].eventId).toBe(events[0].eventId);

        // rollback: event + state change are atomic
        await expect(
            ctx.db.transaction(async (tx) => {
                await advanceOrder(order.id, 'DISPATCHED', { kind: 'system', id: 'test' }, {}, tx);
                throw new Error('boom');
            }),
        ).rejects.toThrow('boom');
        const [after] = await ctx.db.select().from(orders).where(eq(orders.id, order.id));
        expect(after.status).toBe('PAID');
        expect(await ctx.db.select().from(domainEvents).where(eq(domainEvents.orderId, order.id))).toHaveLength(1);
    });

    it('validates payloads and relays events', async () => {
        await expect(
            ctx.db.transaction((tx) =>
                // @ts-expect-error invalid payload on purpose
                emitEvent(tx, { type: 'quote.created', payload: { quoteId: 1 }, actor: { kind: 'system', id: 't' }, correlationId: 'c' }),
            ),
        ).rejects.toThrow();

        const seen: string[] = [];
        const res = await publishPendingEvents({ handlers: [(e) => void seen.push(e.event_type)] });
        expect(res.failed).toBe(0);
        expect(res.published).toBeGreaterThan(0);
        const again = await publishPendingEvents({ handlers: [] });
        expect(again.published).toBe(0);
    });
});
