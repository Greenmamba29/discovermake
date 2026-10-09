/**
 * GET  /api/admin/prime/orders/:orderId/messages                      -> OrderChatView (ops)
 * POST /api/admin/prime/orders/:orderId/messages  PostMessageRequest  -> OrderChatView (201)
 */
import { PostMessageRequest, type OrderChatView } from '@/contracts/prime';
import { requireAdmin } from '@/server/auth/admin';
import { getChat, postMessage } from '@/server/chat';
import { json, parseJson, route } from '@/server/http';
import { requireOrderExists } from '@/server/r3/order-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route<{ orderId: string }>(async (request, { params }) => {
    const admin = await requireAdmin(request);
    const order = await requireOrderExists((await params).orderId);
    return json<OrderChatView>(await getChat(order, { kind: 'ops', id: admin.actor.id }));
});

export const POST = route<{ orderId: string }>(async (request, { params }) => {
    const admin = await requireAdmin(request);
    const order = await requireOrderExists((await params).orderId);
    const body = await parseJson(request, PostMessageRequest);
    return json<OrderChatView>(await postMessage(order, { kind: 'ops', id: admin.actor.id }, body), { status: 201 });
});
