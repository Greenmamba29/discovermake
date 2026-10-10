/**
 * POST /api/media/studio/payouts/connect -> { url } (signed in): Stripe-hosted Connect onboarding
 * for the creator (the shop Express flow). 503 "Stripe is not configured" without STRIPE_SECRET_KEY.
 */
import { assertSameOrigin, requireViewer } from '@/server/auth/viewer';
import { json, route } from '@/server/http';
import { createCreatorOnboardingLink } from '@/server/media';
import { assertNotKidMode } from '@/server/kids/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request) => {
    await assertNotKidMode(request);
    assertSameOrigin(request);
    const viewer = await requireViewer(request);
    return json(await createCreatorOnboardingLink(viewer));
});
