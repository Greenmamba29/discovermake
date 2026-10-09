/**
 * POST /api/live/shows/:showId/questions AskRequest -> AskResponse (201, signed in).
 * mode=creator queues the question for the host; mode=make_ai answers at once from the
 * featured build's record (see src/server/live/make-ai-answer.ts).
 */
import { AskRequest, ShowId } from '@/contracts/live';
import { json, parseJson, route } from '@/server/http';
import { askQuestion, limitLive, loadShowAccess, requireSignedIn } from '@/server/live';
import { pathId } from '@/server/quote/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ showId: string }>(async (request, { params }) => {
    const showId = pathId((await params).showId, ShowId, 'Show');
    const access = await loadShowAccess(request, showId);
    requireSignedIn(access);
    const limited = limitLive('question', access.viewer.user.id);
    if (limited) return limited;
    const body = await parseJson(request, AskRequest);
    return json({ question: await askQuestion(access, body) }, { status: 201 });
});
