/** POST /api/auth/signout -> { ok } — revokes the session and clears dm_session (the device cookie stays). */
import type { OkResponse } from '@/contracts/common';
import { clearSessionCookie, readSessionSecret, revokeSession } from '@/server/auth/sessions';
import { assertSameOrigin } from '@/server/auth/viewer';
import { json, route } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request) => {
    assertSameOrigin(request);
    await revokeSession(readSessionSecret(request));
    const res = json<OkResponse>({ ok: true });
    clearSessionCookie(res);
    return res;
});
