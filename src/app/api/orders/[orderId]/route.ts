/**
 * GET /api/orders/:orderId  -> OrderView
 * Auth: signed order token (`x-order-token` header or `?t=`). A wrong token and a
 * missing order both answer 404 (never reveal which).
 */
import { OrderId } from '@/contracts/common';
import { readOrderToken } from '@/server/auth/order-link';
import { ApiError, json, route } from '@/server/http';
import { getOrderForBuyer } from '@/server/orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { orderId: string };

export const GET = route<Params>(async (request, { params }) => {
    const { orderId } = await params;
    const id = OrderId.safeParse(orderId);
    if (!id.success) throw new ApiError('NOT_FOUND', 'Order not found');
    const view = await getOrderForBuyer(id.data, readOrderToken(request));
    if (!view) throw new ApiError('NOT_FOUND', 'Order not found');
    return json(view, { headers: { 'referrer-policy': 'no-referrer' } });
});
