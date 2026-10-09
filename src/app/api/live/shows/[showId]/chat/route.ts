/**
 * POST /api/live/shows/:showId/chat ChatRequest -> ChatResponse (201, signed in).
 * Keyword + link filter, mutes, slow mode and a per-user rate limit apply.
 */
import { ChatRequest, ShowId, type ChatResponse } from '@/contracts/live';
import { assertSameOrigin } from '@/server/auth/viewer';
import { json, parseJson, route } from '@/server/http';
import { limitLive, loadShowAccess, postChat, requireSignedIn } from '@/server/live';
import { pathId } from '@/server/quote/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ showId: string }>(async (request, { params }) => {
    assertSameOrigin(request);
    const showId = pathId((await params).showId, ShowId, 'Show');
    const access = await loadShowAccess(request, showId);
    requireSignedIn(access);
    const limited = limitLive('chat', access.viewer.user.id);
    if (limited) return limited;
    const body = await parseJson(request, ChatRequest);
    return json<ChatResponse>({ event: await postChat(access, body.text) }, { status: 201 });
});
