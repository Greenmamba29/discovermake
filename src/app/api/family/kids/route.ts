/**
 * POST /api/family/kids  CreateKidProfileRequest -> KidProfileView (201)
 * Nickname, age band and a preset avatar only (the schema is strict: any other field about a
 * child is rejected). Up to four profiles per family.
 */
import { CreateKidProfileRequest, type KidProfileView } from '@/contracts/kids';
import { assertSameOrigin } from '@/server/auth/viewer';
import { json, parseJson, route } from '@/server/http';
import { createKidProfile, requireGrownUp } from '@/server/kids';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request) => {
    assertSameOrigin(request);
    const viewer = await requireGrownUp(request);
    const body = await parseJson(request, CreateKidProfileRequest);
    return json<KidProfileView>(await createKidProfile(viewer.user.id, body), { status: 201 });
});
