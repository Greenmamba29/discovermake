/**
 * GET /api/media/feed?tab=for_you|live|new|trending&cursor=<opaque>&limit=12 -> FeedResponse (public).
 * For You is seeded by the signed-in user's (else this device's) onboarding interests.
 */
import { FeedTab, type FeedResponse } from '@/contracts/media';
import { getDeviceHash, getViewer } from '@/server/auth/viewer';
import { ApiError, json, route } from '@/server/http';
import { feedPage, feedViewerFrom } from '@/server/media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
    const url = new URL(request.url);
    const tab = FeedTab.safeParse(url.searchParams.get('tab') ?? 'for_you');
    if (!tab.success) throw new ApiError('VALIDATION_FAILED', 'Unknown feed tab');
    const limit = Number(url.searchParams.get('limit') ?? 12);
    const cursor = url.searchParams.get('cursor');
    if (cursor && cursor.length > 500) throw new ApiError('VALIDATION_FAILED', 'Invalid cursor');
    const viewer = await getViewer(request);
    return json<FeedResponse>(await feedPage({ tab: tab.data, cursor, limit: Number.isFinite(limit) ? limit : 12, viewer: feedViewerFrom(viewer, getDeviceHash(request)) }));
});
