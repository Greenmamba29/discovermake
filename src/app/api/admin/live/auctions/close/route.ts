/**
 * POST|GET /api/admin/live/auctions/close -> CloseAuctionsResponse
 * Close every auction past its end (capture the winner, release the other holds) and finish
 * interrupted settlement. Auth: Bearer ADMIN_TOKEN or CRON_SECRET (vercel.json).
 */
import type { CloseAuctionsResponse } from '@/contracts/live';
import { requireAdminOrCron } from '@/server/auth/admin';
import { json, route } from '@/server/http';
import { sweepAuctions } from '@/server/live';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = route(async (request) => {
    await requireAdminOrCron(request);
    return json<CloseAuctionsResponse>(await sweepAuctions());
});

export const POST = handler;
export const GET = handler;
