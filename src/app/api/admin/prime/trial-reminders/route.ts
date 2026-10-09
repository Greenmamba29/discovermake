/**
 * POST|GET /api/admin/prime/trial-reminders -> { sent }
 * Emails members whose Prime trial ends within 2 days (once per trial; idempotent).
 * Auth: admin or CRON_SECRET (GET is what Vercel Cron calls; see vercel.json).
 */
import { requireAdminOrCron } from '@/server/auth/admin';
import { json, route } from '@/server/http';
import { sendTrialReminders } from '@/server/prime/membership';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = route(async (request) => {
    await requireAdminOrCron(request);
    return json(await sendTrialReminders());
});

export const POST = handler;
export const GET = handler;
