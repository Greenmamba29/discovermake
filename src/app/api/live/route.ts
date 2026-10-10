/**
 * GET /api/live?category=<chip> -> LiveHomeResponse (public): LIVE now, upcoming, replays.
 */
import { ChannelCategory, type LiveHomeResponse } from '@/contracts/live';
import { getViewer } from '@/server/auth/viewer';
import { json, route } from '@/server/http';
import { liveHome } from '@/server/live';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
    const raw = new URL(request.url).searchParams.get('category');
    const category = raw ? ChannelCategory.safeParse(raw) : null;
    const viewer = await getViewer(request);
    return json<LiveHomeResponse>(await liveHome(viewer?.user.id ?? null, category?.success ? category.data : null));
});
