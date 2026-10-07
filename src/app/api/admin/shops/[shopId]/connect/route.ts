/**
 * POST /api/admin/shops/:shopId/connect -> AdminShopConnectLinkResponse
 * Auth: Bearer ADMIN_TOKEN. Ops-assisted payout onboarding: same account creation and
 * hosted link as the Shop Console (the link can be sent to the shop owner).
 * 503 "Stripe is not configured" without STRIPE_SECRET_KEY.
 */
import { ShopId } from '@/contracts/common';
import type { AdminShopConnectLinkResponse } from '@/contracts/connect';
import { ADMIN_ACTOR, requireAdmin } from '@/server/auth/admin';
import { ApiError, json, route } from '@/server/http';
import { createShopOnboardingLink } from '@/server/shops/connect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ shopId: string }>(async (request, { params }) => {
    requireAdmin(request);
    const id = ShopId.safeParse((await params).shopId);
    if (!id.success) throw new ApiError('NOT_FOUND', 'Shop not found');
    return json<AdminShopConnectLinkResponse>(await createShopOnboardingLink(id.data, ADMIN_ACTOR));
});
