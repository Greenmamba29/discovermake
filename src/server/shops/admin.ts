/**
 * Ops/admin operations (auth: Bearer ADMIN_TOKEN, enforced in the route handlers).
 * Contracts: src/contracts/admin.ts (orders, refunds, payouts, shop onboarding).
 */
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import {
    CreateShopRequest,
    type AdminDispatchResponse,
    type AdminOrderDetail,
    type AdminOrderRow,
    type AdminPayoutView,
    type CreateShopResponse,
    type IssueShopTokenRequest,
    type ShopConsoleTokenView,
} from '../../contracts/admin';
import type { Actor } from '../../contracts/common';
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
    services,
    shipments,
    shopAccessTokens,
    shopCapabilities,
    shopRateCards,
    shopServices,
    shops,
    thicknessOptions,
} from '../db/schema';
import { dispatchOrder, sweepStaleOffersLazily } from '../dispatch';
import { ApiError } from '../http';
import { newId } from '../ids';
import { markPayoutPaid } from '../ledger';
import { refundOrder, toUniversalStatus } from '../orders';
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
    await sweepStaleOffersLazily();
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
    const [history, pays, jobs, ledger, outs, ships] = await Promise.all([
        db.select().from(orderStatusHistory).where(eq(orderStatusHistory.orderId, orderId)).orderBy(asc(orderStatusHistory.createdAt)),
        db.select().from(payments).where(eq(payments.orderId, orderId)).orderBy(asc(payments.createdAt)),
        db.select().from(manufacturingJobs).where(eq(manufacturingJobs.orderId, orderId)).orderBy(asc(manufacturingJobs.createdAt)),
        db.select().from(ledgerEntries).where(eq(ledgerEntries.orderId, orderId)).orderBy(asc(ledgerEntries.txnKey), asc(ledgerEntries.lineNo)),
        db.select().from(payouts).where(eq(payouts.orderId, orderId)).orderBy(asc(payouts.createdAt)),
        db.select().from(shipments).where(eq(shipments.orderId, orderId)).orderBy(asc(shipments.createdAt)),
    ]);
    return {
        ...toAdminRow(row.order, row.shopName),
        statusHistory: history.map((h) => ({ from: h.fromStatus, to: h.toStatus, actorId: h.actorId, reason: h.reason, at: iso(h.createdAt) })),
        payments: pays.map((p) => ({ id: p.id, provider: p.provider, providerRef: p.providerRef, amountCents: p.amountCents, status: p.status, createdAt: iso(p.createdAt) })),
        jobs: jobs.map((j) => ({ id: j.id, shopId: j.shopId, status: j.status, isRework: !!j.reworkOfJobId, createdAt: iso(j.createdAt) })),
        ledger: ledger.map((l) => ({ txnKey: l.txnKey, account: l.account, direction: l.direction, amountCents: l.amountCents, memo: l.memo, at: iso(l.createdAt) })),
        payouts: outs.map((p) => ({ id: p.id, shopId: p.shopId, amountCents: p.amountCents, status: p.status, method: p.method, createdAt: iso(p.createdAt) })),
        shipments: ships.map((sh) => ({
            id: sh.id,
            status: sh.status,
            carrier: sh.carrier,
            trackingNumber: sh.trackingNumber,
            createdAt: iso(sh.createdAt),
            deliveredAt: sh.deliveredAt ? iso(sh.deliveredAt) : null,
        })),
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

/** Ops: full refund of a paid order before shipping (provider refund, REFUNDED, open jobs cancelled, ledger reversed). */
export async function adminRefundOrder(orderId: string, actor: Actor, reason: string): Promise<AdminOrderDetail> {
    const [exists] = await getDb().select({ id: orders.id }).from(orders).where(eq(orders.id, orderId));
    if (!exists) throw new ApiError('NOT_FOUND', 'Order not found');
    await refundOrder(orderId, actor, reason);
    return (await getAdminOrder(orderId)) as AdminOrderDetail;
}

/** Ops: settle a manual payout (bank transfer / check) with its reference. Idempotent. */
export async function adminMarkPayoutPaid(payoutId: string, reference: string): Promise<AdminPayoutView> {
    let row: typeof payouts.$inferSelect | null;
    try {
        row = await markPayoutPaid(payoutId, reference);
    } catch (err) {
        throw new ApiError('CONFLICT', err instanceof Error ? err.message : String(err));
    }
    if (!row) throw new ApiError('NOT_FOUND', 'Payout not found');
    return {
        id: row.id,
        orderId: row.orderId,
        shopId: row.shopId,
        amountCents: row.amountCents,
        currency: row.currency,
        status: row.status,
        method: row.method,
        providerRef: row.providerRef,
        paidAt: row.paidAt ? iso(row.paidAt) : null,
    };
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

export { CapabilityInput, CreateShopRequest, CreateShopResponse, IssueShopTokenRequest, RateCardInput, ShopConsoleTokenView } from '../../contracts/admin';

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

        const serviceIds = [...new Set(input.serviceIds)];
        const svcRows = serviceIds.length ? await t.select({ id: services.id }).from(services).where(inArray(services.id, serviceIds)) : [];
        const unknownSvc = serviceIds.filter((id) => !svcRows.some((r) => r.id === id));
        if (unknownSvc.length) throw new ApiError('VALIDATION_FAILED', `Unknown service ids: ${unknownSvc.join(', ')}`);

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
                stripeAccountId: input.stripeAccountId ?? null,
                // Ops attaching an existing account attest it is payout-ready; accounts created
                // through Connect onboarding start false until Stripe reports payouts_enabled.
                stripePayoutsEnabled: !!input.stripeAccountId,
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

        if (serviceIds.length) {
            await t.insert(shopServices).values(serviceIds.map((serviceId) => ({ id: newId('shopService'), shopId: shop.id, serviceId })));
        }

        const token = generateToken(SHOP_TOKEN_PREFIX);
        const tokenId = newId('shopToken');
        await t.insert(shopAccessTokens).values({ id: tokenId, shopId: shop.id, tokenHash: sha256Hex(token), label: input.tokenLabel });

        return {
            shop: { id: shop.id, slug: shop.slug, name: shop.name, status: shop.status, city: shop.city, region: shop.region },
            rateCardId,
            capabilityCount: input.capabilities.length,
            serviceCount: serviceIds.length,
            consoleToken: { id: tokenId, label: input.tokenLabel, token, expiresAt: null },
        };
    });
}

/** Issue an additional console token for a shop (rotation). Plaintext returned once. */
export async function issueShopToken(shopId: string, input: IssueShopTokenRequest): Promise<ShopConsoleTokenView> {
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
