/**
 * Ops/admin contracts. Auth: `Authorization: Bearer <ADMIN_TOKEN>` (ADR-0008).
 *
 * GET    /api/admin/orders?status=PAID,DISPATCHED       -> AdminOrderListResponse
 * GET    /api/admin/orders/:orderId                      -> AdminOrderDetail
 * POST   /api/admin/orders/:orderId/dispatch             -> AdminDispatchResponse
 * POST   /api/admin/orders/:orderId/delivered            MarkDeliveredRequest -> ShipmentView (latest shipment)
 * POST   /api/admin/orders/:orderId/refund               AdminRefundRequest -> AdminOrderDetail
 * POST   /api/admin/shipments/:shipmentId/delivered      MarkDeliveredRequest -> ShipmentView
 * POST   /api/admin/payouts/:payoutId/paid               MarkPayoutPaidRequest -> AdminPayoutView
 * POST   /api/admin/offers/expire                        -> ExpireOffersResponse   (also GET, for cron)
 * POST   /api/admin/outbox/publish                       -> PublishOutboxResponse  (also GET, for cron)
 * POST   /api/admin/shops                                CreateShopRequest -> CreateShopResponse (201)
 * POST   /api/admin/shops/:shopId/tokens                 IssueShopTokenRequest -> ShopConsoleTokenView (201)
 * DELETE /api/admin/shops/:shopId/tokens/:tokenId        -> OkResponse
 */
import { z } from 'zod';
import { JobStatus, LedgerAccount, LedgerDirection, OrderStatus, OrderType, PaymentStatus, PayoutStatus, ShipmentStatus, UniversalStatus } from './enums';
import { Address, Cents, Email, IsoDateTime, OrderId, ProcessId, ServiceId, ShopId, ThicknessOptionId } from './common';

export const AdminOrderRow = z.object({
    id: OrderId,
    orderNumber: z.string(),
    status: OrderStatus,
    universalStatus: UniversalStatus,
    orderType: OrderType,
    buyerEmail: z.string(),
    totalCents: Cents,
    currency: z.string(),
    shopName: z.string().nullable(),
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
});
export type AdminOrderRow = z.infer<typeof AdminOrderRow>;

export const AdminOrderListResponse = z.object({ orders: z.array(AdminOrderRow) });
export type AdminOrderListResponse = z.infer<typeof AdminOrderListResponse>;

export const AdminOrderDetail = AdminOrderRow.extend({
    statusHistory: z.array(
        z.object({ from: OrderStatus.nullable(), to: OrderStatus, actorId: z.string(), reason: z.string().nullable(), at: IsoDateTime }),
    ),
    payments: z.array(z.object({ id: z.string(), provider: z.string(), providerRef: z.string(), amountCents: Cents, status: PaymentStatus, createdAt: IsoDateTime })),
    jobs: z.array(z.object({ id: z.string(), shopId: z.string(), status: JobStatus, isRework: z.boolean(), createdAt: IsoDateTime })),
    ledger: z.array(
        z.object({ txnKey: z.string(), account: LedgerAccount, direction: LedgerDirection, amountCents: Cents, memo: z.string().nullable(), at: IsoDateTime }),
    ),
    payouts: z.array(
        z.object({
            id: z.string(),
            shopId: z.string(),
            amountCents: Cents,
            status: PayoutStatus,
            /** 'stripe_connect' | 'manual' (manual payouts are settled by ops: POST /api/admin/payouts/:id/paid). */
            method: z.string(),
            createdAt: IsoDateTime,
        }),
    ),
    shipments: z.array(
        z.object({
            id: z.string(),
            status: ShipmentStatus,
            carrier: z.string(),
            trackingNumber: z.string(),
            createdAt: IsoDateTime,
            deliveredAt: IsoDateTime.nullable(),
        }),
    ),
});
export type AdminOrderDetail = z.infer<typeof AdminOrderDetail>;

export const AdminDispatchResponse = z.object({
    orderId: OrderId,
    jobId: z.string().nullable(),
    shopId: z.string().nullable(),
    status: OrderStatus,
});
export type AdminDispatchResponse = z.infer<typeof AdminDispatchResponse>;

export const AdminRefundRequest = z.object({
    reason: z.string().trim().min(3).max(500),
});
export type AdminRefundRequest = z.infer<typeof AdminRefundRequest>;

export const MarkPayoutPaidRequest = z.object({
    /** Bank transfer / check / provider reference for the manual payout. */
    reference: z.string().trim().min(1).max(200),
});
export type MarkPayoutPaidRequest = z.infer<typeof MarkPayoutPaidRequest>;

export const AdminPayoutView = z.object({
    id: z.string(),
    orderId: OrderId,
    shopId: ShopId,
    amountCents: Cents,
    currency: z.string(),
    status: PayoutStatus,
    method: z.string(),
    providerRef: z.string().nullable(),
    paidAt: IsoDateTime.nullable(),
});
export type AdminPayoutView = z.infer<typeof AdminPayoutView>;

export const ExpireOffersResponse = z.object({ expired: z.number().int().nonnegative() });
export type ExpireOffersResponse = z.infer<typeof ExpireOffersResponse>;

export const PublishOutboxResponse = z.object({ published: z.number().int().nonnegative(), failed: z.number().int().nonnegative() });
export type PublishOutboxResponse = z.infer<typeof PublishOutboxResponse>;

// ---------------------------------------------------------------------------
// Shop onboarding
// ---------------------------------------------------------------------------

const centsField = z.number().int().nonnegative().max(10_000_000);

/** Rate card coefficients (all `calibrated=false` until checked against shop invoices). */
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
export type RateCardInput = z.input<typeof RateCardInput>;

/** One machine x thickness option the shop can run (cutting or press brake). */
export const CapabilityInput = z.object({
    thicknessOptionId: ThicknessOptionId,
    processId: ProcessId,
    bedWidthMm: z.number().positive().max(10_000),
    bedHeightMm: z.number().positive().max(10_000),
    maxBendLengthMm: z.number().positive().max(10_000).optional(),
    machineLabel: z.string().trim().max(120).optional(),
});
export type CapabilityInput = z.input<typeof CapabilityInput>;

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
    /** Finishes + secondary operations the shop performs (svc_bending, svc_powder_*, ...). */
    serviceIds: z.array(ServiceId).max(100).default([]),
    tokenLabel: z.string().trim().min(1).max(60).default('console'),
});
export type CreateShopRequest = z.input<typeof CreateShopRequest>;

export const IssueShopTokenRequest = z.object({
    label: z.string().trim().min(1).max(60),
    expiresAt: IsoDateTime.optional(),
});
export type IssueShopTokenRequest = z.infer<typeof IssueShopTokenRequest>;

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
    serviceCount: z.number().int().nonnegative(),
    consoleToken: ShopConsoleTokenView,
});
export type CreateShopResponse = z.infer<typeof CreateShopResponse>;
