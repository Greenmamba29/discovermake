/**
 * POST /api/me/builds/:buildId/reorder -> ReorderResponse (201)
 * A fresh quote with the last order's selections. Caller must be able to edit the build
 * or be the signed-in buyer of an order on it (403). 409 when the build has no placed
 * order or the part no longer quotes. Per-IP rate limited.
 */
import { BuildId } from '@/contracts';
import { reorderBuild } from '@/server/accounts/my-builds';
import { assertSameOrigin, getDeviceHash, getViewer } from '@/server/auth/viewer';
import { limitWrite } from '@/server/build-graph';
import { json, route } from '@/server/http';
import { pathId } from '@/server/quote/route-helpers';
import { assertNotKidMode } from '@/server/kids/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ buildId: string }>(async (request, { params }) => {
    await assertNotKidMode(request);
    const buildId = pathId((await params).buildId, BuildId, 'Build');
    assertSameOrigin(request);
    const limited = await limitWrite(request);
    if (limited) return limited;
    const viewer = await getViewer(request);
    return json(await reorderBuild({ viewer, deviceHash: getDeviceHash(request) }, buildId), { status: 201 });
});
