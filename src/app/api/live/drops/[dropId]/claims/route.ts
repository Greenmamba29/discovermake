/**
 * POST /api/live/drops/:dropId/claims ClaimSlotsRequest -> ClaimSlotsResponse (201, signed in).
 *
 * Fair queue (drop row lock): never more than totalSlots or perBuyerLimit. Creates a
 * BUILD_SLOT order with an authorize-only payment; `checkoutUrl` is where the buyer
 * authorizes the hold. Send `Idempotency-Key` to make retries safe.
 */
import { ClaimSlotsRequest, DropId, type ClaimSlotsResponse } from '@/contracts/live';
import { requireViewer } from '@/server/auth/viewer';
import { json, parseJson, route } from '@/server/http';
import { claimSlots, limitLive } from '@/server/live';
import { pathId } from '@/server/quote/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ dropId: string }>(async (request, { params }) => {
    const dropId = pathId((await params).dropId, DropId, 'Drop');
    const viewer = await requireViewer(request);
    const limited = limitLive('claim', viewer.user.id);
    if (limited) return limited;
    const body = await parseJson(request, ClaimSlotsRequest);
    const key = request.headers.get('idempotency-key')?.trim().slice(0, 100) || null;
    return json<ClaimSlotsResponse>(await claimSlots(dropId, viewer, body, key), { status: 201 });
});
