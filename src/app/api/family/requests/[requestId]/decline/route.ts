/** POST /api/family/requests/:requestId/decline  DeclineKidRequest -> { declined: true } ("Not this time", optional kind note). */
import { DeclineKidRequest, KidRequestId } from '@/contracts/kids';
import { assertSameOrigin } from '@/server/auth/viewer';
import { json, parseJson, route } from '@/server/http';
import { declineKidRequest, requireGrownUp } from '@/server/kids';
import { pathId } from '@/server/quote/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ requestId: string }>(async (request, { params }) => {
    assertSameOrigin(request);
    const viewer = await requireGrownUp(request);
    const requestId = pathId((await params).requestId, KidRequestId, 'Request');
    const body = await parseJson(request, DeclineKidRequest);
    return json(await declineKidRequest(viewer.user.id, requestId, body.note));
});
