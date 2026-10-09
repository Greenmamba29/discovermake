/**
 * GET /api/admin/creator-payouts -> { payouts } (ops): pending and failed creator payouts.
 * Auth: Bearer ADMIN_TOKEN or an ops sign-in.
 */
import { requireAdmin } from '@/server/auth/admin';
import { json, route } from '@/server/http';
import { listPendingCreatorPayouts } from '@/server/media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
    await requireAdmin(request);
    return json({ payouts: await listPendingCreatorPayouts() });
});
