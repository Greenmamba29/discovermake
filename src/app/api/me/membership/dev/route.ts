/**
 * POST /api/me/membership/dev  DevMembershipSimulateRequest -> MembershipResponse
 * Dev payment double only (PAYMENT_PROVIDER=dev, never in production): simulates what Stripe
 * Billing would send next (trial end, renewal, failed payment, immediate cancel).
 */
import { DevMembershipSimulateRequest, type MembershipResponse } from '@/contracts/prime';
import { assertSameOrigin, requireViewer } from '@/server/auth/viewer';
import { ApiError, json, parseJson, route } from '@/server/http';
import { isDevPaymentEnabled } from '@/server/payments';
import { getMembershipResponse, simulateDevMembership } from '@/server/prime/membership';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request) => {
    if (!isDevPaymentEnabled()) throw new ApiError('NOT_FOUND', 'Not found');
    assertSameOrigin(request);
    const viewer = await requireViewer(request);
    const body = await parseJson(request, DevMembershipSimulateRequest);
    const me = { id: viewer.user.id, email: viewer.user.email };
    await simulateDevMembership(me, body.action);
    return json<MembershipResponse>(await getMembershipResponse(me));
});
