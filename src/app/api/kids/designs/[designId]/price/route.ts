/** POST /api/kids/designs/:designId/price -> KidDesignView ("Try again": the workshop and the price for the kid's own design). */
import { KidDesignId, type KidDesignView } from '@/contracts/kids';
import { assertSameOrigin } from '@/server/auth/viewer';
import { json, route } from '@/server/http';
import { priceKidDesign, requireKidSession } from '@/server/kids';
import { kidDesignLimiter, limitKid } from '@/server/kids/rate-limit';
import { pathId } from '@/server/quote/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ designId: string }>(async (request, { params }) => {
    assertSameOrigin(request);
    const kid = await requireKidSession(request);
    const designId = pathId((await params).designId, KidDesignId, 'Design');
    await limitKid(kidDesignLimiter, kid.kid.id);
    return json<KidDesignView>(await priceKidDesign(kid, designId));
});
