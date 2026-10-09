/**
 * GET /api/orders/:orderId/watch -> WatchMyBuildView
 * Auth: the signed order token (`x-order-token` header or `?t=`), or the signed-in buyer.
 * A wrong token and a missing order both answer 404 (never reveal which).
 */
import { OrderId } from '@/contracts/common';
import type { WatchMyBuildView } from '@/contracts/media';
import { readOrderToken } from '@/server/auth/order-link';
import { getViewer } from '@/server/auth/viewer';
import { ApiError, json, route } from '@/server/http';
import { watchMyBuild } from '@/server/media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route<{ orderId: string }>(async (request, { params }) => {
    const id = OrderId.safeParse((await params).orderId);
    if (!id.success) throw new ApiError('NOT_FOUND', 'Order not found');
    const view = await watchMyBuild(id.data, { token: readOrderToken(request), viewer: await getViewer(request) });
    if (!view) throw new ApiError('NOT_FOUND', 'Order not found');
    return json<WatchMyBuildView>(view, { headers: { 'referrer-policy': 'no-referrer' } });
});
