/**
 * POST   /api/builds/:buildId/follow -> FollowResponse { following: true }   (signed in)
 * DELETE /api/builds/:buildId/follow -> FollowResponse { following: false }  (signed in)
 * 401 signed out, 404 unknown build. Following shows the build under My Builds > Following.
 */
import { BuildId } from '@/contracts';
import type { z } from 'zod';
import type { FollowResponse } from '@/contracts/account';
import { setFollow } from '@/server/accounts/follows';
import { assertSameOrigin, requireViewer } from '@/server/auth/viewer';
import { json, route } from '@/server/http';
import { pathId } from '@/server/quote/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Follow = z.infer<typeof FollowResponse>;

const handler = (following: boolean) =>
    route<{ buildId: string }>(async (request, { params }) => {
        const buildId = pathId((await params).buildId, BuildId, 'Build');
        assertSameOrigin(request);
        const viewer = await requireViewer(request);
        return json<Follow>(await setFollow(viewer.user.id, buildId, following));
    });

export const POST = handler(true);
export const DELETE = handler(false);
