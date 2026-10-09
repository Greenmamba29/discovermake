/** POST /api/admin/prime/holds/:holdId  ResolveHoldRequest -> HoldRequestView (answer posted in the order chat). */
import { ResolveHoldRequest, type HoldRequestView } from '@/contracts/prime';
import { requireAdmin } from '@/server/auth/admin';
import { resolveHold } from '@/server/chat';
import { json, parseJson, route } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ holdId: string }>(async (request, { params }) => {
    const admin = await requireAdmin(request);
    const body = await parseJson(request, ResolveHoldRequest);
    return json<HoldRequestView>(await resolveHold((await params).holdId, body.decision, body.note ?? null, admin.actor));
});
