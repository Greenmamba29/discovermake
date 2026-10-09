/**
 * POST|GET /api/admin/outbox/publish -> PublishOutboxResponse
 * Publish pending domain events from the transactional outbox (ADR-0002) to subscribers.
 * Auth: Bearer ADMIN_TOKEN or CRON_SECRET (GET is what Vercel Cron calls; see vercel.json).
 */
import type { PublishOutboxResponse } from '@/contracts/admin';
import { requireAdminOrCron } from '@/server/auth/admin';
import { publishPendingEvents } from '@/server/events/outbox';
import { ensureSubscribers } from '@/server/events/registry';
import { json, route } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = route(async (request) => {
    await requireAdminOrCron(request);
    await ensureSubscribers();
    return json<PublishOutboxResponse>(await publishPendingEvents({ limit: 500 }));
});

export const POST = handler;
export const GET = handler;
