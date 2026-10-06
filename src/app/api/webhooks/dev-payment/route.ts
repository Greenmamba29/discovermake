/**
 * POST /api/webhooks/dev-payment  DevPaymentConfirmRequest -> DevPaymentConfirmResponse
 * Dev payment double: only when PAYMENT_PROVIDER=dev and NODE_ENV !== 'production' (404 otherwise).
 * Goes through the same webhook_events dedupe + handlePaymentSucceeded/Failed path as Stripe.
 */
import { json, route } from '@/server/http';
import { confirmDevPayment } from '@/server/orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request) => {
    const result = await confirmDevPayment(await request.text(), request.headers);
    return json(result);
});
