/**
 * POST /api/auth/email/verify  EmailVerifyRequest -> SignInResponse + Set-Cookie dm_session
 * 400 wrong / expired / used code (details.reason), 429 after 5 wrong tries.
 * Signing in claims this device's guest builds and the email's guest orders.
 */
import { EmailVerifyRequest } from '@/contracts/account';
import { verifyEmailCode } from '@/server/auth/email-code';
import { signInDevice, signInJson } from '@/server/auth/sign-in';
import { completeSignIn } from '@/server/auth/users';
import { assertSameOrigin } from '@/server/auth/viewer';
import { parseJson, route } from '@/server/http';
import { clientIp } from '@/server/make-ai/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request) => {
    assertSameOrigin(request);
    const body = await parseJson(request, EmailVerifyRequest);
    const { email } = await verifyEmailCode(body.challengeId, body.code, { ip: clientIp(request) });
    const device = signInDevice(request);
    const result = await completeSignIn({ method: 'email', email, deviceHash: device.hash, userAgent: request.headers.get('user-agent') });
    const res = signInJson(request, result);
    device.apply(res);
    return res;
});
