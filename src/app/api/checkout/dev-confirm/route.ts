/**
 * POST /api/checkout/dev-confirm  DevPaymentConfirmRequest -> DevPaymentConfirmResponse
 * Alias of POST /api/webhooks/dev-payment (same pipeline). 404 unless PAYMENT_PROVIDER=dev outside production.
 */
import { json, route } from '@/server/http';
import { confirmDevPayment } from '@/server/orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request) => {
    const result = await confirmDevPayment(await request.text(), request.headers);
    return json(result);
});
