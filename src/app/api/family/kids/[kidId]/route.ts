/**
 * PATCH  /api/family/kids/:kidId  UpdateKidProfileRequest -> KidProfileView (controls, nickname, avatar)
 * DELETE /api/family/kids/:kidId  -> { deleted: true }: the profile and all of its designs, requests and activity
 */
import { KidProfileId, UpdateKidProfileRequest, type KidProfileView } from '@/contracts/kids';
import { assertSameOrigin } from '@/server/auth/viewer';
import { json, parseJson, route } from '@/server/http';
import { deleteKidProfile, requireGrownUp, updateKidProfile } from '@/server/kids';
import { pathId } from '@/server/quote/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PATCH = route<{ kidId: string }>(async (request, { params }) => {
    assertSameOrigin(request);
    const viewer = await requireGrownUp(request);
    const kidId = pathId((await params).kidId, KidProfileId, 'Kid profile');
    const body = await parseJson(request, UpdateKidProfileRequest);
    return json<KidProfileView>(await updateKidProfile(viewer.user.id, kidId, body));
});

export const DELETE = route<{ kidId: string }>(async (request, { params }) => {
    assertSameOrigin(request);
    const viewer = await requireGrownUp(request);
    const kidId = pathId((await params).kidId, KidProfileId, 'Kid profile');
    return json(await deleteKidProfile(viewer.user.id, kidId));
});
