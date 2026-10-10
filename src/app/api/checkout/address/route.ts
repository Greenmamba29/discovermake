/**
 * POST /api/checkout/address  AddressCheckRequest -> AddressCheckResponse
 * Non-blocking address warnings (EasyPost verification when configured, else local heuristics).
 */
import { AddressCheckRequest, type AddressCheckResponse } from '@/contracts/prime';
import { json, parseJson, route } from '@/server/http';
import { checkAddress } from '@/server/shipping/address-check';
import { assertNotKidMode } from '@/server/kids/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request) => {
    await assertNotKidMode(request);
    const body = await parseJson(request, AddressCheckRequest);
    return json<AddressCheckResponse>(await checkAddress(body.address, { freight: body.freight }));
});
