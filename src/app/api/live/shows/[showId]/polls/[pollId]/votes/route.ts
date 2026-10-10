/**
 * POST /api/live/shows/:showId/polls/:pollId/votes PollVoteRequest -> { poll } (signed in, one vote each).
 */
import { LivePollId, PollVoteRequest, ShowId } from '@/contracts/live';
import { assertSameOrigin } from '@/server/auth/viewer';
import { json, parseJson, route } from '@/server/http';
import { limitLive, loadShowAccess, requireSignedIn, votePoll } from '@/server/live';
import { pathId } from '@/server/quote/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ showId: string; pollId: string }>(async (request, { params }) => {
    assertSameOrigin(request);
    const p = await params;
    const showId = pathId(p.showId, ShowId, 'Show');
    const pollId = pathId(p.pollId, LivePollId, 'Poll');
    const access = await loadShowAccess(request, showId);
    requireSignedIn(access);
    const limited = await limitLive('vote', access.viewer.user.id);
    if (limited) return limited;
    const body = await parseJson(request, PollVoteRequest);
    return json({ poll: await votePoll(access, pollId, body.optionIndex) });
});
