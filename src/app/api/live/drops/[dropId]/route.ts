/**
 * GET /api/live/drops/:dropId -> DropView (public; closes an overdue drop lazily).
 */
import { DropId, type DropView } from '@/contracts/live';
import { getViewer } from '@/server/auth/viewer';
import { ApiError, json, route } from '@/server/http';
import { getDropView } from '@/server/live';
import { pathId } from '@/server/quote/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route<{ dropId: string }>(async (request, { params }) => {
    const dropId = pathId((await params).dropId, DropId, 'Drop');
    const viewer = await getViewer(request);
    const view = await getDropView(dropId, viewer?.user.id ?? null);
    if (!view) throw new ApiError('NOT_FOUND', 'Drop not found');
    return json<DropView>(view);
});
