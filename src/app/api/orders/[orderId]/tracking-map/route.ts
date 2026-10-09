/**
 * GET /api/orders/:orderId/tracking-map -> TrackingMapView
 * Auth: order link token (x-order-token / ?t=) or the signed-in owner. 404 before shipping.
 */
import type { TrackingMapView } from '@/contracts/prime';
import { getTrackingMap } from '@/server/geo/tracking-map';
import { json, route } from '@/server/http';
import { requireBuyerOrder } from '@/server/r3/order-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route<{ orderId: string }>(async (request, { params }) => {
    const { order } = await requireBuyerOrder(request, (await params).orderId);
    return json<TrackingMapView>(await getTrackingMap(order), { headers: { 'referrer-policy': 'no-referrer' } });
});
