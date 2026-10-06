/** POST /api/admin/offers/expire -> { expired } (expire stale shop offers + re-dispatch; cron-able). Auth: Bearer ADMIN_TOKEN. */
import { requireAdmin } from '@/server/auth/admin';
import { expireStaleOffers } from '@/server/dispatch';
import { json, route } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request) => {
    requireAdmin(request);
    return json({ expired: await expireStaleOffers() });
});
