/**
 * GET  /api/orders/:orderId/rating                       -> OrderRatingResponse
 * POST /api/orders/:orderId/rating  SubmitRatingRequest  -> OrderRatingResponse (201)
 * Delivered orders only, once per order; ratings start pending until ops approve them.
 */
import { SubmitRatingRequest, type OrderRatingResponse } from '@/contracts/prime';
import { assertSameOrigin } from '@/server/auth/viewer';
import { json, parseJson, route } from '@/server/http';
import { requireBuyerOrder } from '@/server/r3/order-access';
import { getOrderRating, submitRating } from '@/server/ratings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route<{ orderId: string }>(async (request, { params }) => {
    const { order } = await requireBuyerOrder(request, (await params).orderId);
    return json<OrderRatingResponse>(await getOrderRating(order));
});

export const POST = route<{ orderId: string }>(async (request, { params }) => {
    assertSameOrigin(request);
    const { order, viewer, party } = await requireBuyerOrder(request, (await params).orderId);
    const body = await parseJson(request, SubmitRatingRequest);
    const userId = viewer && party.id === viewer.user.id ? viewer.user.id : null;
    return json<OrderRatingResponse>(await submitRating(order, body, userId, { kind: 'buyer', id: userId ?? `order_${order.id}` }), { status: 201 });
});
