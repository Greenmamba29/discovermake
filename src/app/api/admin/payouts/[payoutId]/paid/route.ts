/**
 * POST /api/admin/payouts/:payoutId/paid  MarkPayoutPaidRequest -> AdminPayoutView
 * Ops settles a manual payout (shop without Stripe Connect) with its bank/check reference.
 * Idempotent. Auth: Bearer ADMIN_TOKEN.
 */
import { MarkPayoutPaidRequest } from '@/contracts/admin';
import { requireAdmin } from '@/server/auth/admin';
import { ApiError, json, parseJson, route } from '@/server/http';
import { adminMarkPayoutPaid } from '@/server/shops/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ payoutId: string }>(async (request, { params }) => {
    await requireAdmin(request);
    const payoutId = (await params).payoutId;
    if (!/^pout_[A-Za-z0-9_-]{1,60}$/.test(payoutId)) throw new ApiError('NOT_FOUND', 'Payout not found');
    const { reference } = await parseJson(request, MarkPayoutPaidRequest);
    return json(await adminMarkPayoutPaid(payoutId, reference));
});
