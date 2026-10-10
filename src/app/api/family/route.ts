/**
 * GET /api/family -> FamilyView (signed-in grown-up, not in Kids mode): PIN set?, kid profiles and
 * their controls, the requests inbox with order status, the activity log.
 */
import type { FamilyView } from '@/contracts/kids';
import { json, route } from '@/server/http';
import { getFamilyView, requireGrownUp } from '@/server/kids';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
    const viewer = await requireGrownUp(request);
    return json<FamilyView>(await getFamilyView(viewer.user.id));
});
