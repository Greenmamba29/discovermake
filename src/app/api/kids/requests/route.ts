/**
 * POST /api/kids/requests  CreateKidAskRequest -> KidThingView (201)
 * "Ask a grown-up": a priced design within the kid's spending limit (409 OVER_LIMIT otherwise).
 * Emails the grown-up's account address; nothing is sent to or collected from the kid.
 */
import { CreateKidAskRequest, type KidThingView } from '@/contracts/kids';
import { assertSameOrigin } from '@/server/auth/viewer';
import { json, parseJson, route } from '@/server/http';
import { askGrownUp, requireKidSession } from '@/server/kids';
import { kidAskLimiter, limitKid } from '@/server/kids/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request) => {
    assertSameOrigin(request);
    const kid = await requireKidSession(request);
    const { designId } = await parseJson(request, CreateKidAskRequest);
    await limitKid(kidAskLimiter, kid.kid.id);
    return json<KidThingView>(await askGrownUp(kid, designId), { status: 201 });
});
