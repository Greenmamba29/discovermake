/**
 * POST /api/checkout  CheckoutRequest -> CheckoutResponse (201)
 * Server-priced: the body carries ids + buyer details; amounts come from the quote snapshot.
 * Signed in: the order is attached to the account (orders.buyer_user_id; ADR-0009).
 */
import { CheckoutRequest } from '@/contracts/checkout';
import { json, parseJson, route } from '@/server/http';
import { getViewer } from '@/server/auth/viewer';
import { createCheckout } from '@/server/orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request) => {
    const body = await parseJson(request, CheckoutRequest);
    const viewer = await getViewer(request);
    const result = await createCheckout(body, { buyerUserId: viewer?.user.id ?? null });
    return json(result, { status: 201 });
});
