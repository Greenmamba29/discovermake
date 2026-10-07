/**
 * POST /api/checkout  CheckoutRequest -> CheckoutResponse (201)
 * Server-priced: the body carries ids + buyer details; amounts come from the quote snapshot.
 */
import { CheckoutRequest } from '@/contracts/checkout';
import { json, parseJson, route } from '@/server/http';
import { createCheckout } from '@/server/orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request) => {
    const body = await parseJson(request, CheckoutRequest);
    const result = await createCheckout(body);
    return json(result, { status: 201 });
});
