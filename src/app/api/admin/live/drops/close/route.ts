/**
 * POST|GET /api/admin/live/drops/close -> CloseDropsResponse
 * Close every overdue drop (capture or release its holds), expire unauthorized holds and
 * finish any interrupted settlement. Auth: Bearer ADMIN_TOKEN or CRON_SECRET (vercel.json).
 */
import type { CloseDropsResponse } from '@/contracts/live';
import { requireAdminOrCron } from '@/server/auth/admin';
import { json, route } from '@/server/http';
import { sweepDrops } from '@/server/live';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = route(async (request) => {
    requireAdminOrCron(request);
    return json<CloseDropsResponse>(await sweepDrops());
});

export const POST = handler;
export const GET = handler;
