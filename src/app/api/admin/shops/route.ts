/**
 * POST /api/admin/shops  CreateShopRequest -> CreateShopResponse (201)
 * Onboards a partner shop (+ optional rate card and capabilities) and issues its first
 * Shop Console token. The plaintext token is in this response ONLY; just its sha256 is stored.
 * Auth: Bearer ADMIN_TOKEN.
 */
import { requireAdmin } from '@/server/auth/admin';
import { json, parseJson, route } from '@/server/http';
import { createShop, CreateShopRequest } from '@/server/shops/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request) => {
    requireAdmin(request);
    const body = await parseJson(request, CreateShopRequest);
    return json(await createShop(body), { status: 201 });
});
