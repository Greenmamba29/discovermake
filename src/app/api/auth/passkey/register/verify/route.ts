/** POST /api/auth/passkey/register/verify (signed in)  { response, name? } -> { ok, passkeyId } (201) */
import { PasskeyRegisterVerifyRequest } from '@/contracts/account';
import { verifyPasskeyRegistration } from '@/server/auth/passkeys';
import { assertSameOrigin, requireViewer } from '@/server/auth/viewer';
import { json, parseJson, route } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request) => {
    assertSameOrigin(request);
    const viewer = await requireViewer(request);
    const body = await parseJson(request, PasskeyRegisterVerifyRequest);
    const { passkeyId } = await verifyPasskeyRegistration(viewer.user.id, body.response, { name: body.name, userAgent: request.headers.get('user-agent') });
    return json({ ok: true as const, passkeyId }, { status: 201 });
});
