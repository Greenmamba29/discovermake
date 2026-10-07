/**
 * GET /api/shop/jobs?status=OFFERED,ACCEPTED -> ShopJobListResponse
 * Auth: shop session. Default (no status): every non-terminal status.
 */
import { z } from 'zod';
import { JobStatus } from '@/contracts/enums';
import type { ShopJobListResponse } from '@/contracts/shop';
import { json, parseQuery, route } from '@/server/http';
import { listJobs, requireShop } from '@/server/shops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Query = z.object({
    status: z
        .string()
        .optional()
        .transform((v) => (v ? v.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) : undefined))
        .pipe(z.array(JobStatus).max(10).optional()),
});

export const GET = route(async (request) => {
    const shop = await requireShop(request);
    const { status } = parseQuery(request, Query);
    const body: ShopJobListResponse = { jobs: await listJobs(shop.shopId, { status }) };
    return json(body);
});
