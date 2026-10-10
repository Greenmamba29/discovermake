/**
 * POST|GET /api/admin/creator-payouts/run -> { settled } (admin or cron): the creator payout
 * runner. Transfers every PENDING Connect payout (idempotency key `payout:<payoutId>`) and
 * settles it; manual payouts wait for ops. Auth: Bearer ADMIN_TOKEN or CRON_SECRET.
 */
import { requireAdminOrCron } from '@/server/auth/admin';
import { json, route } from '@/server/http';
import { executePendingCreatorPayouts } from '@/server/media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = route(async (request) => {
    await requireAdminOrCron(request);
    return json({ settled: (await executePendingCreatorPayouts()).length });
});

export const POST = handler;
export const GET = handler;
