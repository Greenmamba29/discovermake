/**
 * GET   /api/me/membership                          -> MembershipResponse (signed out: membership null)
 * POST  /api/me/membership  StartMembershipRequest  -> StartMembershipResponse (signed in)
 * PATCH /api/me/membership  UpdateMembershipRequest -> MembershipResponse (signed in; cancel / resume)
 */
import { StartMembershipRequest, UpdateMembershipRequest, type MembershipResponse, type StartMembershipResponse } from '@/contracts/prime';
import { assertSameOrigin, getViewer, requireViewer } from '@/server/auth/viewer';
import { json, parseJson, route } from '@/server/http';
import { getMembershipResponse, startMembership, updateMembership } from '@/server/prime/membership';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
    const viewer = await getViewer(request);
    return json<MembershipResponse>(await getMembershipResponse(viewer ? { id: viewer.user.id, email: viewer.user.email } : null));
});

export const POST = route(async (request) => {
    assertSameOrigin(request);
    const viewer = await requireViewer(request);
    const body = await parseJson(request, StartMembershipRequest);
    const result = await startMembership({ id: viewer.user.id, email: viewer.user.email }, body.plan);
    return json<StartMembershipResponse>(result, { status: 201 });
});

export const PATCH = route(async (request) => {
    assertSameOrigin(request);
    const viewer = await requireViewer(request);
    const body = await parseJson(request, UpdateMembershipRequest);
    const me = { id: viewer.user.id, email: viewer.user.email };
    await updateMembership(me, body.action);
    return json<MembershipResponse>(await getMembershipResponse(me));
});
