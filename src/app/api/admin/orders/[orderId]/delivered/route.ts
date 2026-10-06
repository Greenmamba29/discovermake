/**
 * POST /api/admin/orders/:orderId/delivered  MarkDeliveredRequest -> ShipmentView
 * Ops confirms delivery of the order's latest shipment (manual carrier / carrier outage):
 * DELIVERED -> passport activated -> payout recorded -> COMPLETE. Auth: Bearer ADMIN_TOKEN.
 */
import { OrderId } from '@/contracts/common';
import { MarkDeliveredRequest } from '@/contracts/shipments';
import { ADMIN_ACTOR, requireAdmin } from '@/server/auth/admin';
import { ApiError, json, parseJson, route } from '@/server/http';
import { adminMarkOrderDelivered } from '@/server/shops/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ orderId: string }>(async (request, { params }) => {
    requireAdmin(request);
    const id = OrderId.safeParse((await params).orderId);
    if (!id.success) throw new ApiError('NOT_FOUND', 'Order not found');
    const body = await parseJson(request, MarkDeliveredRequest);
    return json(await adminMarkOrderDelivered(id.data, { ...ADMIN_ACTOR }, body.deliveredAt ? new Date(body.deliveredAt) : undefined));
});
