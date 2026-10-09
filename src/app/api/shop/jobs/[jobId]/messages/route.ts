/**
 * GET  /api/shop/jobs/:jobId/messages                      -> OrderChatView (marks read for the shop)
 * POST /api/shop/jobs/:jobId/messages  PostMessageRequest  -> OrderChatView (201)
 * Auth: Shop Console session; only the shop assigned to the job's order (others: 404).
 */
import { PostMessageRequest, type OrderChatView } from '@/contracts/prime';
import { getChat, postMessage } from '@/server/chat';
import { json, parseJson, route } from '@/server/http';
import { requireShopJobOrder } from '@/server/r3/shop-access';
import { assertSameOrigin, requireShop } from '@/server/shops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route<{ jobId: string }>(async (request, { params }) => {
    const shop = await requireShop(request);
    const { order, party } = await requireShopJobOrder(shop.shopId, (await params).jobId);
    return json<OrderChatView>(await getChat(order, party));
});

export const POST = route<{ jobId: string }>(async (request, { params }) => {
    assertSameOrigin(request);
    const shop = await requireShop(request);
    const { order, party } = await requireShopJobOrder(shop.shopId, (await params).jobId);
    const body = await parseJson(request, PostMessageRequest);
    return json<OrderChatView>(await postMessage(order, party, body), { status: 201 });
});
