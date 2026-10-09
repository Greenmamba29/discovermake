/**
 * POST /api/live/channels UpsertChannelRequest -> ChannelView (creator role): create or update
 * the viewer's own channel (one per user). 409 when the handle is taken.
 */
import { UpsertChannelRequest } from '@/contracts/live';
import { assertSameOrigin, requireRole } from '@/server/auth/viewer';
import { json, parseJson, route } from '@/server/http';
import { upsertChannel } from '@/server/live';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request) => {
    assertSameOrigin(request);
    const viewer = await requireRole(request, 'creator');
    const body = await parseJson(request, UpsertChannelRequest);
    return json(await upsertChannel(viewer, body), { status: 201 });
});
