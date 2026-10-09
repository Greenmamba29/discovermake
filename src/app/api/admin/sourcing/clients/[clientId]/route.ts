/** DELETE /api/admin/sourcing/clients/:clientId -> OkResponse. Revokes the client's token and returns its leased jobs to the queue. Auth: Bearer ADMIN_TOKEN. */
import { idOf, type OkResponse } from '@/contracts/common';
import { requireAdmin } from '@/server/auth/admin';
import { json, route } from '@/server/http';
import { pathId } from '@/server/quote/route-helpers';
import { revokeSourcingClient } from '@/server/sourcing/clients';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const DELETE = route<{ clientId: string }>(async (request, { params }) => {
    await requireAdmin(request);
    const clientId = pathId((await params).clientId, idOf('sourcingClient'), 'Sourcing client');
    await revokeSourcingClient(clientId);
    return json<OkResponse>({ ok: true });
});
