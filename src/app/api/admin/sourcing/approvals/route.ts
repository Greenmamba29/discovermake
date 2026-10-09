/** GET /api/admin/sourcing/approvals?status=PENDING&role=ops -> ApprovalView[] (pending: oldest first). Auth: Bearer ADMIN_TOKEN. */
import { requireAdmin } from '@/server/auth/admin';
import { json, parseQuery, route } from '@/server/http';
import { listApprovals } from '@/server/sourcing/approvals';
import { ListApprovalsQuery } from '@/server/sourcing/desk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
    await requireAdmin(request);
    const q = parseQuery(request, ListApprovalsQuery);
    return json(await listApprovals({ statuses: q.status, role: q.role }));
});
