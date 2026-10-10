/** POST /api/auth/passkey/login/options (anyone) -> PublicKeyCredentialRequestOptionsJSON & { challengeId } */
import { passkeyLoginOptions } from '@/server/auth/passkeys';
import { assertSameOrigin } from '@/server/auth/viewer';
import { limitWrite } from '@/server/build-graph';
import { json, route } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request) => {
    assertSameOrigin(request);
    const limited = await limitWrite(request, undefined, 'Too many sign-in attempts. Wait a minute and try again.');
    if (limited) return limited;
    return json(await passkeyLoginOptions());
});
