/** POST /api/admin/prime/ratings/:ratingId  ModerateRatingRequest -> RatingView (approve updates the shop rating). */
import { ModerateRatingRequest, type RatingView } from '@/contracts/prime';
import { requireAdmin } from '@/server/auth/admin';
import { json, parseJson, route } from '@/server/http';
import { moderateRating } from '@/server/ratings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ ratingId: string }>(async (request, { params }) => {
    const admin = await requireAdmin(request);
    const body = await parseJson(request, ModerateRatingRequest);
    return json<RatingView>(await moderateRating((await params).ratingId, body.decision, body.reason ?? null, admin.actor));
});
