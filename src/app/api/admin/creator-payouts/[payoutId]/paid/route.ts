/**
 * POST /api/admin/creator-payouts/:payoutId/paid { reference } -> CreatorPayoutView (ops).
 * Settles a manual creator payout (no Stripe Connect) with its bank / check reference. Idempotent.
 * Auth: Bearer ADMIN_TOKEN or an ops sign-in.
 */
import { MarkCreatorPayoutPaidRequest } from '@/contracts/media';
import { requireAdmin } from '@/server/auth/admin';
import { ApiError, json, parseJson, route } from '@/server/http';
import { markCreatorPayoutPaid } from '@/server/media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ payoutId: string }>(async (request, { params }) => {
    const admin = await requireAdmin(request);
    const payoutId = (await params).payoutId;
    if (!/^cpo_[A-Za-z0-9_-]{1,60}$/.test(payoutId)) throw new ApiError('NOT_FOUND', 'Payout not found');
    const { reference } = await parseJson(request, MarkCreatorPayoutPaidRequest);
    const row = await markCreatorPayoutPaid(payoutId, reference, admin.actor);
    if (!row) throw new ApiError('NOT_FOUND', 'Payout not found');
    return json(row);
});
