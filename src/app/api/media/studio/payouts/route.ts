/**
 * GET  /api/media/studio/payouts -> CreatorPayoutsResponse (signed in): balance, earnings, payouts, Connect status.
 * POST /api/media/studio/payouts -> CreatorPayoutView (201): pay out the whole available balance.
 *      Stripe Connect transfer when the creator's account has payouts enabled; otherwise a
 *      manual payout that ops mark paid (POST /api/admin/creator-payouts/:id/paid).
 */
import type { CreatorPayoutView, CreatorPayoutsResponse } from '@/contracts/media';
import { assertSameOrigin, requireViewer } from '@/server/auth/viewer';
import { json, route } from '@/server/http';
import { creatorPayoutsView, requestCreatorPayout } from '@/server/media';
import { limited } from '@/server/media/http';
import { RateLimiter } from '@/server/rate-limit';
import { assertNotKidMode } from '@/server/kids/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const payoutLimiter = new RateLimiter('media_creator_payout', { kind: 'fixed_window', limit: 5, windowMs: 60_000 });

export const GET = route(async (request) => {
    await assertNotKidMode(request);
    const viewer = await requireViewer(request);
    return json<CreatorPayoutsResponse>(await creatorPayoutsView(viewer.user.id));
});

export const POST = route(async (request) => {
    await assertNotKidMode(request);
    assertSameOrigin(request);
    const viewer = await requireViewer(request);
    const tooFast = await limited(payoutLimiter, viewer.user.id);
    if (tooFast) return tooFast;
    return json<CreatorPayoutView>(await requestCreatorPayout(viewer.user.id, { kind: 'buyer', id: viewer.user.id }), { status: 201 });
});
