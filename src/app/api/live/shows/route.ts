/**
 * POST /api/live/shows CreateShowRequest -> ShowView (201): schedule a show on the viewer's channel.
 */
import { CreateShowRequest } from '@/contracts/live';
import { requireRole } from '@/server/auth/viewer';
import { json, parseJson, route } from '@/server/http';
import { createShow } from '@/server/live';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request) => {
    const viewer = await requireRole(request, 'creator');
    const body = await parseJson(request, CreateShowRequest);
    return json(await createShow(viewer, body), { status: 201 });
});
