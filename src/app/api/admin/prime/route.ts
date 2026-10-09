/**
 * GET /api/admin/prime -> AdminPrimeQueueResponse
 * Ops queue for R3: ratings awaiting moderation, open hold requests, invoices, chats.
 * Auth: admin token or an ops/admin session.
 */
import type { AdminPrimeQueueResponse } from '@/contracts/prime';
import { requireAdmin } from '@/server/auth/admin';
import { listOpenHolds, opsChatInbox } from '@/server/chat';
import { json, route } from '@/server/http';
import { listInvoices } from '@/server/invoices';
import { listPendingRatings } from '@/server/ratings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
    await requireAdmin(request);
    const [ratings, holds, invoices, chats] = await Promise.all([listPendingRatings(), listOpenHolds(), listInvoices(), opsChatInbox()]);
    return json<AdminPrimeQueueResponse>({ ratings, holds, invoices, chats });
});
