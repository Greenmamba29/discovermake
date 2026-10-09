/**
 * POST /api/auth/email/start  EmailStartRequest -> EmailStartResponse (201)
 * Sends a 6-digit sign-in code (10 minutes, 5 tries). Outside production with no email
 * provider configured the code is also returned as `devCode`.
 * 429 over 5 codes per email per hour or 10 per IP per 10 minutes.
 */
import { EmailStartRequest } from '@/contracts/account';
import { startEmailSignIn } from '@/server/auth/email-code';
import { assertSameOrigin } from '@/server/auth/viewer';
import { json, parseJson, route } from '@/server/http';
import { clientIp } from '@/server/make-ai/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request) => {
    assertSameOrigin(request);
    const { email } = await parseJson(request, EmailStartRequest);
    return json(await startEmailSignIn(email, { ip: clientIp(request) }), { status: 201 });
});
