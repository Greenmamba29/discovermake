/**
 * GET /api/live/shows/:showId/control -> ControlRoomView (host / staff co-host).
 */
import { ShowId, type ControlRoomView } from '@/contracts/live';
import { json, route } from '@/server/http';
import { buildControlRoom, loadShowAccess } from '@/server/live';
import { pathId } from '@/server/quote/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route<{ showId: string }>(async (request, { params }) => {
    const showId = pathId((await params).showId, ShowId, 'Show');
    const access = await loadShowAccess(request, showId);
    return json<ControlRoomView>(await buildControlRoom(access));
});
