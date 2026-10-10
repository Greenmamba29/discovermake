/**
 * GET /api/live/studio -> StudioOverview (signed in): the viewer's channel, shows and the
 * go-live checklist for the next show.
 */
import type { StudioOverview } from '@/contracts/live';
import { requireViewer } from '@/server/auth/viewer';
import { json, route } from '@/server/http';
import { studioOverview } from '@/server/live';
import { assertNotKidMode } from '@/server/kids/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
    await assertNotKidMode(request);
    const viewer = await requireViewer(request);
    return json<StudioOverview>(await studioOverview(viewer));
});
