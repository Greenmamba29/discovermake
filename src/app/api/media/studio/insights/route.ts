/**
 * GET /api/media/studio/insights?range=7d|30d|90d|all -> InsightsView (signed in: the caller's own numbers).
 */
import { InsightRange, type InsightsView } from '@/contracts/media';
import { requireViewer } from '@/server/auth/viewer';
import { ApiError, json, route } from '@/server/http';
import { creatorInsights } from '@/server/media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
    const viewer = await requireViewer(request);
    const range = InsightRange.safeParse(new URL(request.url).searchParams.get('range') ?? '30d');
    if (!range.success) throw new ApiError('VALIDATION_FAILED', 'Unknown range');
    return json<InsightsView>(await creatorInsights(viewer.user.id, range.data));
});
