/**
 * PUT /api/me/preferences  UpdatePreferencesRequest -> Preferences
 * Guest: stored against this device (merged into the account at sign-in when it has none).
 * Signed in: stored on the account. `complete: true` marks onboarding done.
 */
import { UpdatePreferencesRequest } from '@/contracts/account';
import { updatePreferences } from '@/server/accounts/me';
import { applyDevice, assertSameOrigin, getViewer, resolveDevice } from '@/server/auth/viewer';
import { json, parseJson, route } from '@/server/http';
import { assertNotKidMode } from '@/server/kids/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PUT = route(async (request) => {
    await assertNotKidMode(request);
    assertSameOrigin(request);
    const body = await parseJson(request, UpdatePreferencesRequest);
    const viewer = await getViewer(request);
    const device = resolveDevice(request);
    const res = json(await updatePreferences({ userId: viewer?.user.id ?? null, deviceHash: device.hash }, body));
    applyDevice(res, device);
    return res;
});
