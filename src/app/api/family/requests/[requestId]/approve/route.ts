/**
 * POST /api/family/requests/:requestId/approve -> { checkoutUrl, quoteId }
 * "Approve & pay": marks the request approved and sends the grown-up to their normal checkout for
 * the BINDING print quote (re-quoted by the engine if it went stale). The grown-up is the buyer,
 * so Prime benefits apply at checkout automatically.
 */
import { KidRequestId } from '@/contracts/kids';
import { assertSameOrigin } from '@/server/auth/viewer';
import { json, route } from '@/server/http';
import { approveKidRequest, requireGrownUp } from '@/server/kids';
import { pathId } from '@/server/quote/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ requestId: string }>(async (request, { params }) => {
    assertSameOrigin(request);
    const viewer = await requireGrownUp(request);
    const requestId = pathId((await params).requestId, KidRequestId, 'Request');
    return json(await approveKidRequest(viewer.user.id, requestId));
});
