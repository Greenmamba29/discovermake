/**
 * POST|GET /api/admin/live/drops/close -> CloseDropsResponse
 * Close every overdue drop (capture or release its holds), expire unauthorized holds and
 * finish any interrupted settlement; R5: drain fair queues and close overdue auctions. Auth: Bearer ADMIN_TOKEN or CRON_SECRET (vercel.json).
 */
import type { CloseDropsResponse } from '@/contracts/live';
import { requireAdminOrCron } from '@/server/auth/admin';
import { json, route } from '@/server/http';
import { sweepAuctions, sweepDrops, sweepDropQueues } from '@/server/live';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = route(async (request) => {
    await requireAdminOrCron(request);
    const result = await sweepDrops();
    // R5: drain fair queues and close overdue auctions on the same schedule.
    await sweepDropQueues();
    await sweepAuctions();
    return json<CloseDropsResponse>(result);
});

export const POST = handler;
export const GET = handler;
