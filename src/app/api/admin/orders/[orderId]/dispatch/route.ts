/** POST /api/admin/orders/:orderId/dispatch -> AdminDispatchResponse (idempotent; jobId null when no shop matched). Auth: Bearer ADMIN_TOKEN. */
import { OrderId } from '@/contracts/common';
import { requireAdmin } from '@/server/auth/admin';
import { ApiError, json, route } from '@/server/http';
import { adminDispatchOrder } from '@/server/shops/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ orderId: string }>(async (request, { params }) => {
    await requireAdmin(request);
    const id = OrderId.safeParse((await params).orderId);
    if (!id.success) throw new ApiError('NOT_FOUND', 'Order not found');
    return json(await adminDispatchOrder(id.data));
});
