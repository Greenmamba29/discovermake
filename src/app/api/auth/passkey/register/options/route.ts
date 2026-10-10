/** POST /api/auth/passkey/register/options (signed in) -> PublicKeyCredentialCreationOptionsJSON */
import { passkeyRegistrationOptions } from '@/server/auth/passkeys';
import { assertSameOrigin, requireViewer } from '@/server/auth/viewer';
import { json, route } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request) => {
    assertSameOrigin(request);
    const viewer = await requireViewer(request);
    return json(await passkeyRegistrationOptions(viewer.user.id));
});
