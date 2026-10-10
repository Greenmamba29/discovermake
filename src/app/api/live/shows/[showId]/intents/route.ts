/**
 * POST /api/live/shows/:showId/intents HostIntent -> { event, drop? } (host / staff co-host only).
 * The server validates each intent and emits the signed Live Build Protocol events itself.
 */
import { HostIntent, ShowId } from '@/contracts/live';
import { assertSameOrigin } from '@/server/auth/viewer';
import { json, parseJson, route } from '@/server/http';
import { handleIntent, loadShowAccess, requireHost } from '@/server/live';
import { pathId } from '@/server/quote/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ showId: string }>(async (request, { params }) => {
    assertSameOrigin(request);
    const showId = pathId((await params).showId, ShowId, 'Show');
    const access = await loadShowAccess(request, showId);
    requireHost(access); // before reading the body: viewers never get past here
    const intent = await parseJson(request, HostIntent);
    const result = await handleIntent(access, intent);
    return json({ event: result.event, ...(result.drop ? { drop: result.drop } : {}) });
});
