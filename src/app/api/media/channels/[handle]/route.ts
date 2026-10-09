/**
 * GET /api/media/channels/:handle -> ChannelMediaPage (public): Live's channel page plus the
 * owner's published builds and the channel's clips. Follow / unfollow stays on
 * `/api/live/channels/:handle/follow`.
 */
import type { ChannelMediaPage } from '@/contracts/media';
import { getViewer } from '@/server/auth/viewer';
import { ApiError, json, route } from '@/server/http';
import { channelMediaPage } from '@/server/media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route<{ handle: string }>(async (request, { params }) => {
    const handle = (await params).handle.toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(handle)) throw new ApiError('NOT_FOUND', 'Channel not found');
    const page = await channelMediaPage(handle, await getViewer(request));
    if (!page) throw new ApiError('NOT_FOUND', 'Channel not found');
    return json<ChannelMediaPage>(page);
});
