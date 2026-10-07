/**
 * GET /api/catalog -> CatalogResponse (public, buyer-safe: no shop costs).
 */
import { json, route } from '@/server/http';
import { getCatalog } from '@/server/quote';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async () => {
    return json(await getCatalog());
});
