/**
 * POST /api/kids/designs  CreateKidDesignRequest -> KidDesignView (201)
 * One allowed template with its bounded options (validated by the template's own schema, kid-safe
 * label rules). Runs the workshop and the print engine: a BINDING price, or an honest "offline".
 */
import { CreateKidDesignRequest, type KidDesignView } from '@/contracts/kids';
import { assertSameOrigin } from '@/server/auth/viewer';
import { json, parseJson, route } from '@/server/http';
import { createKidDesign, requireKidSession } from '@/server/kids';
import { kidDesignLimiter, limitKid } from '@/server/kids/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request) => {
    assertSameOrigin(request);
    const kid = await requireKidSession(request);
    const body = await parseJson(request, CreateKidDesignRequest);
    await limitKid(kidDesignLimiter, kid.kid.id);
    return json<KidDesignView>(await createKidDesign(kid, body), { status: 201 });
});
