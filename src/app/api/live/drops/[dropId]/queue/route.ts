/**
 * POST /api/live/drops/:dropId/queue ClaimSlotsRequest -> DropQueueResponse (201, signed in)
 * GET  /api/live/drops/:dropId/queue -> DropQueueResponse (the viewer's entry; 404 when none)
 *
 * Fair queue for high-demand drops: entries are admitted in (arrival second, random tie-break)
 * order under the drop row lock; an admitted entry is a RESERVED Build Slot claim whose hold the
 * buyer authorizes at `claim.checkoutUrl`. Polling GET drains the queue and shows the position.
 */
import { ClaimSlotsRequest, DropId, type DropQueueResponse } from '@/contracts/live';
import { assertSameOrigin, requireViewer } from '@/server/auth/viewer';
import { ApiError, json, parseJson, route } from '@/server/http';
import { dropQueueStatus, joinDropQueue, limitLive } from '@/server/live';
import { pathId } from '@/server/quote/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ dropId: string }>(async (request, { params }) => {
    assertSameOrigin(request);
    const dropId = pathId((await params).dropId, DropId, 'Drop');
    const viewer = await requireViewer(request);
    const tooFast = await limitLive('queue', viewer.user.id);
    if (tooFast) return tooFast;
    const body = await parseJson(request, ClaimSlotsRequest);
    return json<DropQueueResponse>(await joinDropQueue(dropId, viewer, body), { status: 201 });
});

export const GET = route<{ dropId: string }>(async (request, { params }) => {
    const dropId = pathId((await params).dropId, DropId, 'Drop');
    const viewer = await requireViewer(request);
    const tooFast = await limitLive('queue', viewer.user.id);
    if (tooFast) return tooFast;
    const status = await dropQueueStatus(dropId, viewer);
    if (!status) throw new ApiError('NOT_FOUND', 'You are not in this queue');
    return json<DropQueueResponse>(status);
});
