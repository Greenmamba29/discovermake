/**
 * GET   /api/me                          -> MeResponse (works signed out: viewer null, device preferences)
 * PATCH /api/me  UpdateProfileRequest    -> MeResponse (signed in; 409 handle taken)
 */
import { UpdateProfileRequest, type MeResponse } from '@/contracts/account';
import { getMe, updateProfile } from '@/server/accounts/me';
import { applyDevice, applySessionRefresh, assertSameOrigin, getViewer, requireViewer, resolveDevice } from '@/server/auth/viewer';
import { json, parseJson, route } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
    const viewer = await getViewer(request);
    const device = resolveDevice(request);
    const res = json<MeResponse>(await getMe({ userId: viewer?.user.id ?? null, deviceHash: device.hash }));
    applyDevice(res, device);
    await applySessionRefresh(request, res);
    return res;
});

export const PATCH = route(async (request) => {
    assertSameOrigin(request);
    const viewer = await requireViewer(request);
    const body = await parseJson(request, UpdateProfileRequest);
    await updateProfile(viewer.user.id, body);
    return json<MeResponse>(await getMe({ userId: viewer.user.id, deviceHash: null }));
});
