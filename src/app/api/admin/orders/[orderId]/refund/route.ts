/**
 * POST /api/admin/orders/:orderId/refund  AdminRefundRequest -> AdminOrderDetail
 * Full refund before shipping: provider refund, order REFUNDED, open shop jobs cancelled,
 * ledger reversed (one transaction after the provider call). 409 once shipped.
 * Auth: Bearer ADMIN_TOKEN.
 */
import { AdminRefundRequest } from '@/contracts/admin';
import { OrderId } from '@/contracts/common';
import { ADMIN_ACTOR, requireAdmin } from '@/server/auth/admin';
import { ApiError, json, parseJson, route } from '@/server/http';
import { adminRefundOrder } from '@/server/shops/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ orderId: string }>(async (request, { params }) => {
    requireAdmin(request);
    const id = OrderId.safeParse((await params).orderId);
    if (!id.success) throw new ApiError('NOT_FOUND', 'Order not found');
    const { reason } = await parseJson(request, AdminRefundRequest);
    return json(await adminRefundOrder(id.data, { ...ADMIN_ACTOR }, reason));
});
