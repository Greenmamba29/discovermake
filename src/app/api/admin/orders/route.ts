/** GET /api/admin/orders?status=PAID,DISPATCHED -> AdminOrderListResponse. Auth: Bearer ADMIN_TOKEN. */
import { z } from 'zod';
import type { AdminOrderListResponse } from '@/contracts/admin';
import { OrderStatus } from '@/contracts/enums';
import { requireAdmin } from '@/server/auth/admin';
import { json, parseQuery, route } from '@/server/http';
import { listAdminOrders } from '@/server/shops/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Query = z.object({
    status: z
        .string()
        .optional()
        .transform((v) => (v ? v.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) : undefined))
        .pipe(z.array(OrderStatus).max(13).optional()),
});

export const GET = route(async (request) => {
    requireAdmin(request);
    const { status } = parseQuery(request, Query);
    const body: AdminOrderListResponse = { orders: await listAdminOrders(status) };
    return json(body);
});
