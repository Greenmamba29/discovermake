/**
 * POST|GET /api/admin/offers/expire -> ExpireOffersResponse
 * Expire stale shop offers and re-dispatch each order to the next capable shop.
 * Auth: Bearer ADMIN_TOKEN or CRON_SECRET (GET is what Vercel Cron calls; see vercel.json).
 */
import type { ExpireOffersResponse } from '@/contracts/admin';
import { requireAdminOrCron } from '@/server/auth/admin';
import { expireStaleOffers } from '@/server/dispatch';
import { json, route } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = route(async (request) => {
    requireAdminOrCron(request);
    return json<ExpireOffersResponse>({ expired: await expireStaleOffers() });
});

export const POST = handler;
export const GET = handler;
