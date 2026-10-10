/**
 * POST /api/orders/:orderId/balance -> BalancePaymentView
 * Supplier-route orders: open (or return the open) hosted payment session for the balance once the
 * parts passed inspection. Auth: signed order token (`x-order-token` or `?t=`); a wrong token and a
 * missing order both answer 404. 409 when no balance is due yet.
 */
import { OrderId } from '@/contracts/common';
import { verifyOrderAccessToken, readOrderToken } from '@/server/auth/order-link';
import { getDb } from '@/server/db';
import { orders } from '@/server/db/schema';
import { ApiError, json, route } from '@/server/http';
import { requestBalancePayment } from '@/server/prime/payments';
import { eq } from 'drizzle-orm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ orderId: string }>(async (request, { params }) => {
    const id = OrderId.safeParse((await params).orderId);
    if (!id.success) throw new ApiError('NOT_FOUND', 'Order not found');
    const [order] = await getDb().select({ id: orders.id, accessTokenHash: orders.accessTokenHash }).from(orders).where(eq(orders.id, id.data));
    if (!order || !verifyOrderAccessToken(order.id, readOrderToken(request), order.accessTokenHash)) throw new ApiError('NOT_FOUND', 'Order not found');
    const view = await requestBalancePayment(order.id);
    if (!view) throw new ApiError('CONFLICT', 'No balance is due on this order.');
    return json(view, { headers: { 'referrer-policy': 'no-referrer' } });
});
