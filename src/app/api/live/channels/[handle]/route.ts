/**
 * GET /api/live/channels/:handle -> ChannelPageResponse (public).
 */
import type { ChannelPageResponse } from '@/contracts/live';
import { getViewer } from '@/server/auth/viewer';
import { ApiError, json, route } from '@/server/http';
import { channelPage } from '@/server/live';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route<{ handle: string }>(async (request, { params }) => {
    const { handle } = await params;
    if (!/^[a-z0-9_]{3,24}$/.test(handle)) throw new ApiError('NOT_FOUND', 'Channel not found');
    const viewer = await getViewer(request);
    const page = await channelPage(handle, viewer?.user.id ?? null);
    if (!page) throw new ApiError('NOT_FOUND', 'Channel not found');
    return json<ChannelPageResponse>(page);
});
