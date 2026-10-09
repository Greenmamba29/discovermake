/**
 * POST /api/live/channels/:handle/follow -> FollowChannelResponse (signed in)
 * DELETE                                 -> unfollow
 */
import type { FollowChannelResponse } from '@/contracts/live';
import { requireViewer } from '@/server/auth/viewer';
import { ApiError, json, route } from '@/server/http';
import { channelByHandle, setFollow } from '@/server/live';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function handler(follow: boolean) {
    return route<{ handle: string }>(async (request, { params }) => {
        const viewer = await requireViewer(request);
        const { handle } = await params;
        const channel = /^[a-z0-9_]{3,24}$/.test(handle) ? await channelByHandle(handle) : null;
        if (!channel) throw new ApiError('NOT_FOUND', 'Channel not found');
        return json<FollowChannelResponse>(await setFollow(channel.id, viewer, follow));
    });
}

export const POST = handler(true);
export const DELETE = handler(false);
