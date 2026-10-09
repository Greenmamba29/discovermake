/**
 * GET /api/media/studio/publications -> StudioPublicationsResponse (signed in): your builds and their publish state.
 */
import type { StudioPublicationsResponse } from '@/contracts/media';
import { requireViewer } from '@/server/auth/viewer';
import { json, route } from '@/server/http';
import { studioPublications } from '@/server/media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
    const viewer = await requireViewer(request);
    return json<StudioPublicationsResponse>(await studioPublications(viewer));
});
