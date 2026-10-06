/**
 * Ops/admin operations (auth: Bearer ADMIN_TOKEN, enforced in the route handlers).
 *
 * Order list/detail use AdminOrderRow / AdminOrderDetail from src/contracts/admin.ts.
 * Shop onboarding (create shop + rate card + capabilities + one-time console token) uses
 * the local schemas below; they are candidates for src/contracts/admin.ts (see open issues).
 */
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import type { AdminDispatchResponse, AdminOrderDetail, AdminOrderRow } from '../../contracts/admin';
import { Address, Email, IsoDateTime, ProcessId, ShopId, ThicknessOptionId, type Actor } from '../../contracts/common';
import type { OrderStatus } from '../../contracts/enums';
import type { ShipmentView } from '../../contracts/shipments';
import { generateToken, sha256Hex } from '../auth/tokens';
import { getDb, withTx } from '../db';
import {
    ledgerEntries,
    manufacturingJobs,
    orderStatusHistory,
    orders,
    payments,
    payouts,
    processes,
    shipments,
    shopAccessTokens,
    shopCapabilities,
    shopRateCards,
    shops,
    thicknessOptions,
} from '../db/schema';
import { dispatchOrder } from '../dispatch';
import { ApiError } from '../http';
import { newId } from '../ids';
import { toUniversalStatus } from '../orders';
import { markShipmentDelivered } from '../shipping';

export const SHOP_TOKEN_PREFIX = 'dmshop';

const iso = (d: Date) => d.toISOString();

type OrderRow = typeof orders.$inferSelect;

function toAdminRow(o: OrderRow, shopName: string | null): AdminOrderRow {
    return {
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        universalStatus: toUniversalStatus(o.status),
        orderType: o.orderType,
        buyerEmail: o.buyerEmail,
        totalCents: o.totalCents,
        currency: o.currency,
        shopName,
        createdAt: iso(o.createdAt),
        updatedAt: iso(o.updatedAt),
    };
}

export async function listAdminOrders(statuses?: OrderStatus[]): Promise<AdminOrderRow[]> {
    const rows = await getDb()
        .select({ order: orders, shopName: shops.name })
        .from(orders)
        .leftJoin(shops, eq(shops.id, orders.shopId))
        .where(statuses?.length ? inArray(orders.status, statuses) : undefined)
        .orderBy(desc(orders.createdAt))
        .limit(200);
    return rows.map((r) => toAdminRow(r.order, r.shopName));
}

export async function getAdminOrder(orderId: string): Promise<AdminOrderDetail | null> {
    const db = getDb();
    const [row] = await db.select({ order: orders, shopName: shops.name }).from(orders).leftJoin(shops, eq(shops.id, orders.shopId)).where(eq(orders.id, orderId));
    if (!row) return null;
    const [history, pays, jobs, ledger, outs] = await Promise.all([
        db.select().from(orderStatusHistory).where(eq(orderStatusHistory.orderId, orderId)).orderBy(asc(orderStatusHistory.createdAt)),
        db.select().from(payments).where(eq(payments.orderId, orderId)).orderBy(asc(payments.createdAt)),
        db.select().from(manufacturingJobs).where(eq(manufacturingJobs.orderId, orderId)).orderBy(asc(manufacturingJobs.createdAt)),
        db.select().from(ledgerEntries).where(eq(ledgerEntries.orderId, orderId)).orderBy(asc(ledgerEntries.txnKey), asc(ledgerEntries.lineNo)),
        db.select().from(payouts).where(eq(payouts.orderId, orderId)).orderBy(asc(payouts.createdAt)),
    ]);
    return {
        ...toAdminRow(row.order, row.shopName),
        statusHistory: history.map((h) => ({ from: h.fromStatus, to: h.toStatus, actorId: h.actorId, reason: h.reason, at: iso(h.createdAt) })),
        payments: pays.map((p) => ({ id: p.id, provider: p.provider, providerRef: p.providerRef, amountCents: p.amountCents, status: p.status, createdAt: iso(p.createdAt) })),
        jobs: jobs.map((j) => ({ id: j.id, shopId: j.shopId, status: j.status, isRework: !!j.reworkOfJobId, createdAt: iso(j.createdAt) })),
        ledger: ledger.map((l) => ({ txnKey: l.txnKey, account: l.account, direction: l.direction, amountCents: l.amountCents, memo: l.memo, at: iso(l.createdAt) })),
        payouts: outs.map((p) => ({ id: p.id, shopId: p.shopId, amountCents: p.amountCents, status: p.status, createdAt: iso(p.createdAt) })),
    };
}

/** Ops: (re)run dispatch for a PAID order. */
export async function adminDispatchOrder(orderId: string): Promise<AdminDispatchResponse> {
    const db = getDb();
    const [exists] = await db.select({ id: orders.id }).from(orders).where(eq(orders.id, orderId));
    if (!exists) throw new ApiError('NOT_FOUND', 'Order not found');
    const result = await dispatchOrder(orderId);
    const [order] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId));
    return { orderId, jobId: result?.jobId ?? null, shopId: result?.shopId ?? null, status: order.status };
}

/** Ops: confirm delivery of an order's latest active shipment (manual carrier or carrier outage). */
export async function adminMarkOrderDelivered(orderId: string, actor: Actor, deliveredAt?: Date): Promise<ShipmentView> {
    const [s] = await getDb()
        .select({ id: shipments.id })
        .from(shipments)
        .where(and(eq(shipments.orderId, orderId), ne(shipments.status, 'CANCELLED')))
        .orderBy(desc(shipments.createdAt))
        .limit(1);
    if (!s) throw new ApiError('NOT_FOUND', 'Order has no shipment to mark delivered');
    return markShipmentDelivered(s.id, actor, deliveredAt);
}

// ---------------------------------------------------------------------------
// Shop onboarding
// ---------------------------------------------------------------------------

const centsField = z.number().int().nonnegative().max(10_000_000);

export const RateCardInput = z.object({
    fiberLaserCentsPerHour: centsField,
    co2LaserCentsPerHour: centsField,
    brakeCentsPerBend: centsField,
    brakeSetupCents: centsField,
    orderSetupCents: centsField,
    partHandlingCents: centsField,
    finishingCentsPerFt2: centsField,
    finishBatchSetupCents: centsField,
    qaCentsPerPart: centsField.default(0),
    packagingBaseCents: centsField,
    materialMarkup: z.number().min(1).max(3).default(1),
    platformMarginPct: z.number().min(0).max(0.9),
    minimumOrderCents: centsField,
    volumeDiscountMax: z.number().min(0).max(0.6).default(0.2),
    serviceOverrides: z.record(z.number().int().nonnegative()).default({}),
    notes: z.string().trim().max(500).optional(),
});

export const CapabilityInput = z.object({
    thicknessOptionId: ThicknessOptionId,
    processId: ProcessId,
    bedWidthMm: z.number().positive().max(10_000),
    bedHeightMm: z.number().positive().max(10_000),
    maxBendLengthMm: z.number().positive().max(10_000).optional(),
    machineLabel: z.string().trim().max(120).optional(),
});

export const CreateShopRequest = z.object({
    name: z.string().trim().min(2).max(120),
    slug: z
        .string()
        .trim()
        .regex(/^[a-z0-9][a-z0-9-]{2,59}$/, 'lowercase letters, digits and dashes')
        .optional(),
    legalName: z.string().trim().max(200).optional(),
    contactEmail: Email,
    phone: z.string().trim().max(32).optional(),
    address: Address,
    status: z.enum(['PENDING', 'ACTIVE']).default('ACTIVE'),
    timezone: z.string().trim().max(64).default('America/New_York'),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    queueDays: z.number().int().min(0).max(60).default(2),
    acceptWindowMinutes: z.number().int().min(15).max(10_080).default(120),
    adapterLevel: z.enum(['L0', 'L1', 'L2', 'L3']).default('L1'),
    certifications: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
    rateCard: RateCardInput.optional(),
    capabilities: z.array(CapabilityInput).max(500).default([]),
    tokenLabel: z.string().trim().min(1).max(60).default('console'),
});
export type CreateShopRequest = z.input<typeof CreateShopRequest>;

export const IssueShopTokenRequest = z.object({
    label: z.string().trim().min(1).max(60),
    expiresAt: IsoDateTime.optional(),
});

export const ShopConsoleTokenView = z.object({
    id: z.string(),
    label: z.string(),
    /** Plaintext console token. Shown ONCE; only its sha256 is stored. */
    token: z.string(),
    expiresAt: IsoDateTime.nullable(),
});
export type ShopConsoleTokenView = z.infer<typeof ShopConsoleTokenView>;

export const CreateShopResponse = z.object({
    shop: z.object({ id: ShopId, slug: z.string(), name: z.string(), status: z.string(), city: z.string(), region: z.string() }),
    rateCardId: z.string().nullable(),
    capabilityCount: z.number().int().nonnegative(),
    consoleToken: ShopConsoleTokenView,
});
export type CreateShopResponse = z.infer<typeof CreateShopResponse>;

function slugify(name: string): string {
    return (
        name
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 50) || 'shop'
    );
}

/** Create a shop (+ optional rate card and capabilities) and issue its first console token. */
export async function createShop(raw: CreateShopRequest): Promise<CreateShopResponse> {
    const input = CreateShopRequest.parse(raw);
    return withTx(async (t) => {
        const slug = input.slug ?? `${slugify(input.name)}-${newId('shop').slice(-4)}`;
        const [dupe] = await t.select({ id: shops.id }).from(shops).where(eq(shops.slug, slug));
        if (dupe) throw new ApiError('CONFLICT', `A shop with slug ${slug} already exists`);

        const thicknessIds = [...new Set(input.capabilities.map((c) => c.thicknessOptionId))];
        const processIds = [...new Set(input.capabilities.map((c) => c.processId))];
        const thkRows = thicknessIds.length ? await t.select().from(thicknessOptions).where(inArray(thicknessOptions.id, thicknessIds)) : [];
        const prcRows = processIds.length ? await t.select({ id: processes.id }).from(processes).where(inArray(processes.id, processIds)) : [];
        const thkById = new Map(thkRows.map((r) => [r.id, r]));
        const unknownThk = thicknessIds.filter((id) => !thkById.has(id));
        const unknownPrc = processIds.filter((id) => !prcRows.some((p) => p.id === id));
        if (unknownThk.length || unknownPrc.length) {
            throw new ApiError('VALIDATION_FAILED', `Unknown catalog ids: ${[...unknownThk, ...unknownPrc].join(', ')}`);
        }

        const [shop] = await t
            .insert(shops)
            .values({
                id: newId('shop'),
                slug,
                name: input.name,
                legalName: input.legalName ?? null,
                status: input.status,
                contactEmail: input.contactEmail,
                phone: input.phone ?? input.address.phone ?? null,
                address: input.address,
                city: input.address.city,
                region: input.address.region,
                country: input.address.country,
                timezone: input.timezone,
                lat: input.lat ?? null,
                lng: input.lng ?? null,
                queueDays: input.queueDays,
                acceptWindowMinutes: input.acceptWindowMinutes,
                adapterLevel: input.adapterLevel,
                certifications: input.certifications,
            })
            .returning();

        let rateCardId: string | null = null;
        if (input.rateCard) {
            const { notes, ...rc } = input.rateCard;
            const [card] = await t
                .insert(shopRateCards)
                .values({ id: newId('rateCard'), shopId: shop.id, version: 1, active: true, currency: 'usd', ...rc, notes: notes ?? null, calibrated: false })
                .returning({ id: shopRateCards.id });
            rateCardId = card.id;
        }

        if (input.capabilities.length) {
            await t.insert(shopCapabilities).values(
                input.capabilities.map((c) => ({
                    id: newId('capability'),
                    shopId: shop.id,
                    materialId: (thkById.get(c.thicknessOptionId) as typeof thicknessOptions.$inferSelect).materialId,
                    thicknessOptionId: c.thicknessOptionId,
                    processId: c.processId,
                    bedWidthMm: c.bedWidthMm,
                    bedHeightMm: c.bedHeightMm,
                    maxBendLengthMm: c.maxBendLengthMm ?? null,
                    machineLabel: c.machineLabel ?? null,
                })),
            );
        }

        const token = generateToken(SHOP_TOKEN_PREFIX);
        const tokenId = newId('shopToken');
        await t.insert(shopAccessTokens).values({ id: tokenId, shopId: shop.id, tokenHash: sha256Hex(token), label: input.tokenLabel });

        return {
            shop: { id: shop.id, slug: shop.slug, name: shop.name, status: shop.status, city: shop.city, region: shop.region },
            rateCardId,
            capabilityCount: input.capabilities.length,
            consoleToken: { id: tokenId, label: input.tokenLabel, token, expiresAt: null },
        };
    });
}

/** Issue an additional console token for a shop (rotation). Plaintext returned once. */
export async function issueShopToken(shopId: string, input: z.infer<typeof IssueShopTokenRequest>): Promise<ShopConsoleTokenView> {
    const db = getDb();
    const [shop] = await db.select({ id: shops.id }).from(shops).where(eq(shops.id, shopId));
    if (!shop) throw new ApiError('NOT_FOUND', 'Shop not found');
    const [dupe] = await db
        .select({ id: shopAccessTokens.id })
        .from(shopAccessTokens)
        .where(and(eq(shopAccessTokens.shopId, shopId), eq(shopAccessTokens.label, input.label)));
    if (dupe) throw new ApiError('CONFLICT', `Token label "${input.label}" is already used for this shop`);
    const token = generateToken(SHOP_TOKEN_PREFIX);
    const id = newId('shopToken');
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    await db.insert(shopAccessTokens).values({ id, shopId, tokenHash: sha256Hex(token), label: input.label, expiresAt });
    return { id, label: input.label, token, expiresAt: expiresAt ? iso(expiresAt) : null };
}

/** Revoke a console token (and every session opened with it). */
export async function revokeShopToken(shopId: string, tokenId: string): Promise<void> {
    const [row] = await getDb()
        .update(shopAccessTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(shopAccessTokens.id, tokenId), eq(shopAccessTokens.shopId, shopId)))
        .returning({ id: shopAccessTokens.id });
    if (!row) throw new ApiError('NOT_FOUND', 'Token not found');
}
