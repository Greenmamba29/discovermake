/**
 * PUT /api/family/pin  SetPinRequest -> { pinSet: true }
 * The 4-digit grown-up PIN (scrypt-hashed, peppered with AUTH_SECRET). Only a signed-in grown-up
 * outside Kids mode can set or replace it.
 */
import { SetPinRequest } from '@/contracts/kids';
import { assertSameOrigin } from '@/server/auth/viewer';
import { json, parseJson, route } from '@/server/http';
import { requireGrownUp, setFamilyPin } from '@/server/kids';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PUT = route(async (request) => {
    assertSameOrigin(request);
    const viewer = await requireGrownUp(request);
    const { pin } = await parseJson(request, SetPinRequest);
    return json(await setFamilyPin(viewer.user.id, pin));
});
