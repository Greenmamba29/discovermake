/** GET /api/admin/orders/:orderId -> AdminOrderDetail. Auth: Bearer ADMIN_TOKEN. */
import { OrderId } from '@/contracts/common';
import { requireAdmin } from '@/server/auth/admin';
import { ApiError, json, route } from '@/server/http';
import { getAdminOrder } from '@/server/shops/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route<{ orderId: string }>(async (request, { params }) => {
    requireAdmin(request);
    const id = OrderId.safeParse((await params).orderId);
    if (!id.success) throw new ApiError('NOT_FOUND', 'Order not found');
    const detail = await getAdminOrder(id.data);
    if (!detail) throw new ApiError('NOT_FOUND', 'Order not found');
    return json(detail);
});
