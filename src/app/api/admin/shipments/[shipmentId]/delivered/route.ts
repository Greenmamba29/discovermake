/**
 * POST /api/admin/shipments/:shipmentId/delivered  MarkDeliveredRequest -> ShipmentView
 * DELIVERED -> passport activated -> payout recorded -> COMPLETE (idempotent; also retries a
 * failed follow-up). Auth: Bearer ADMIN_TOKEN.
 */
import { ShipmentId } from '@/contracts/common';
import { MarkDeliveredRequest } from '@/contracts/shipments';
import { ADMIN_ACTOR, requireAdmin } from '@/server/auth/admin';
import { ApiError, json, parseJson, route } from '@/server/http';
import { markShipmentDelivered } from '@/server/shipping';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ shipmentId: string }>(async (request, { params }) => {
    requireAdmin(request);
    const id = ShipmentId.safeParse((await params).shipmentId);
    if (!id.success) throw new ApiError('NOT_FOUND', 'Shipment not found');
    const body = await parseJson(request, MarkDeliveredRequest);
    return json(await markShipmentDelivered(id.data, { ...ADMIN_ACTOR }, body.deliveredAt ? new Date(body.deliveredAt) : undefined));
});
