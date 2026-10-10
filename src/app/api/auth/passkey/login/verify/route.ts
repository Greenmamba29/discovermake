/**
 * POST /api/auth/passkey/login/verify (anyone)  { challengeId, response } -> SignInResponse + dm_session
 * 400 expired / used challenge, 401 unknown or invalid passkey.
 */
import { PasskeyLoginVerifyRequest } from '@/contracts/account';
import { verifyPasskeyLogin } from '@/server/auth/passkeys';
import { signInDevice, signInJson } from '@/server/auth/sign-in';
import { completeSignIn } from '@/server/auth/users';
import { assertSameOrigin } from '@/server/auth/viewer';
import { parseJson, route } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request) => {
    assertSameOrigin(request);
    const body = await parseJson(request, PasskeyLoginVerifyRequest);
    const { userId } = await verifyPasskeyLogin(body.challengeId, body.response);
    const device = signInDevice(request);
    const result = await completeSignIn({ method: 'passkey', userId, deviceHash: device.hash, userAgent: request.headers.get('user-agent') });
    const res = signInJson(request, result);
    device.apply(res);
    return res;
});
