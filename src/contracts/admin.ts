/**
 * Ops/admin contracts. Auth: `Authorization: Bearer <ADMIN_TOKEN>` (ADR-0008).
 *
 * GET  /api/admin/orders?status=PAID,DISPATCHED     -> AdminOrderListResponse
 * GET  /api/admin/orders/:orderId                    -> AdminOrderDetail
 * POST /api/admin/orders/:orderId/dispatch           -> AdminDispatchResponse
 * POST /api/admin/shipments/:shipmentId/delivered    MarkDeliveredRequest -> ShipmentView
 */
import { z } from 'zod';
import { JobStatus, LedgerAccount, LedgerDirection, OrderStatus, OrderType, PaymentStatus, PayoutStatus, UniversalStatus } from './enums';
import { Cents, IsoDateTime, OrderId } from './common';

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
    payouts: z.array(z.object({ id: z.string(), shopId: z.string(), amountCents: Cents, status: PayoutStatus, createdAt: IsoDateTime })),
});
export type AdminOrderDetail = z.infer<typeof AdminOrderDetail>;

export const AdminDispatchResponse = z.object({
    orderId: OrderId,
    jobId: z.string().nullable(),
    shopId: z.string().nullable(),
    status: OrderStatus,
});
export type AdminDispatchResponse = z.infer<typeof AdminDispatchResponse>;
