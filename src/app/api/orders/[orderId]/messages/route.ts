/**
 * GET  /api/orders/:orderId/messages                      -> OrderChatView (marks read for the buyer)
 * POST /api/orders/:orderId/messages  PostMessageRequest  -> OrderChatView (201)
 * Auth: order link token or the signed-in owner (wrong token: 404).
 */
import { PostMessageRequest, type OrderChatView } from '@/contracts/prime';
import { getChat, postMessage } from '@/server/chat';
import { json, parseJson, route } from '@/server/http';
import { requireBuyerOrder } from '@/server/r3/order-access';
import { assertSameOrigin } from '@/server/auth/viewer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route<{ orderId: string }>(async (request, { params }) => {
    const { order, party } = await requireBuyerOrder(request, (await params).orderId);
    const peek = new URL(request.url).searchParams.get('peek') === '1';
    return json<OrderChatView>(await getChat(order, party, { markRead: !peek }), { headers: { 'referrer-policy': 'no-referrer' } });
});

export const POST = route<{ orderId: string }>(async (request, { params }) => {
    assertSameOrigin(request);
    const { order, party } = await requireBuyerOrder(request, (await params).orderId);
    const body = await parseJson(request, PostMessageRequest);
    return json<OrderChatView>(await postMessage(order, party, body), { status: 201 });
});
