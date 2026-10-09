/**
 * GET   /api/me                          -> MeResponse (works signed out: viewer null, device preferences)
 * PATCH /api/me  UpdateProfileRequest    -> MeResponse (signed in; 409 handle taken)
 */
import { UpdateProfileRequest, type MeResponse } from '@/contracts/account';
import { getMe, updateProfile } from '@/server/accounts/me';
import { applySessionRefresh, assertSameOrigin, getDeviceHash, getViewer, requireViewer } from '@/server/auth/viewer';
import { json, parseJson, route } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
    const viewer = await getViewer(request);
    // Read-only: never mint a device here. Parallel first-load requests each minting one would
    // race, and the last Set-Cookie would orphan builds stamped with another (src/proxy.ts mints).
    const res = json<MeResponse>(await getMe({ userId: viewer?.user.id ?? null, deviceHash: getDeviceHash(request) }));
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
