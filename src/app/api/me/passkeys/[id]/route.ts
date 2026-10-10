/** DELETE /api/me/passkeys/:id (signed in) -> { ok }. 404 when the passkey is not the caller's. */
import type { OkResponse } from '@/contracts/common';
import { deletePasskey } from '@/server/auth/passkeys';
import { assertSameOrigin, requireViewer } from '@/server/auth/viewer';
import { ApiError, json, route } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const DELETE = route<{ id: string }>(async (request, { params }) => {
    assertSameOrigin(request);
    const viewer = await requireViewer(request);
    const { id } = await params;
    if (!/^[A-Za-z0-9_-]{1,512}$/.test(id)) throw new ApiError('NOT_FOUND', 'Passkey not found');
    await deletePasskey(viewer.user.id, id);
    return json<OkResponse>({ ok: true });
});
