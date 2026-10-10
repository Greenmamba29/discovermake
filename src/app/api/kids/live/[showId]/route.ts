/**
 * GET /api/kids/live/:showId -> { show, token }: view-only Live for a kid whose grown-up turned it on.
 * Subscribe-only video as an anonymous viewer. No chat, questions, polls, likes or drops exist in
 * Kids mode (those routes are refused for kid sessions).
 */
import { ShowId } from '@/contracts/live';
import { json, route } from '@/server/http';
import { assertCanWatchLive, kidWatch, requireKidSession } from '@/server/kids';
import { pathId } from '@/server/quote/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route<{ showId: string }>(async (request, { params }) => {
    const kid = await requireKidSession(request);
    assertCanWatchLive(kid);
    const showId = pathId((await params).showId, ShowId, 'Show');
    return json(await kidWatch(request, showId));
});
