/**
 * POST /api/checkout/dev-confirm  DevPaymentConfirmRequest -> DevPaymentConfirmResponse
 * Alias of POST /api/webhooks/dev-payment (same pipeline). 404 unless PAYMENT_PROVIDER=dev outside production.
 */
import { json, MAX_JSON_BODY_BYTES, readBodyText, route } from '@/server/http';
import { confirmDevPayment } from '@/server/orders';
import { assertNotKidMode } from '@/server/kids/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request) => {
    await assertNotKidMode(request);
    const result = await confirmDevPayment(await readBodyText(request, MAX_JSON_BODY_BYTES), request.headers);
    return json(result);
});
