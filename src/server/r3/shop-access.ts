/**
 * Shop Console access for R3 features: a job's order chat (only the shop assigned to the
 * order) and the per-order flags in the job list (Prime priority + unread messages).
 */
import { and, eq } from 'drizzle-orm';
import type { ShopJobFlagsResponse } from '../../contracts/prime';
import { unreadCounts } from '../chat';
import { getDb } from '../db';
import { manufacturingJobs } from '../db/schema';
import { ApiError } from '../http';
import { priorityOrderIds } from '../prime/order-benefits';
import { requireShopOrder, type ChatParty, type OrderRow } from './order-access';

export async function requireShopJobOrder(shopId: string, jobId: string): Promise<{ order: OrderRow; party: ChatParty }> {
    if (!/^job_[A-Za-z0-9_-]{4,60}$/.test(jobId)) throw new ApiError('NOT_FOUND', 'Job not found');
    const [job] = await getDb()
        .select({ orderId: manufacturingJobs.orderId })
        .from(manufacturingJobs)
        .where(and(eq(manufacturingJobs.id, jobId), eq(manufacturingJobs.shopId, shopId)))
        .limit(1);
    if (!job) throw new ApiError('NOT_FOUND', 'Job not found');
    try {
        return await requireShopOrder(shopId, job.orderId);
    } catch {
        // An offer the shop never accepted (or lost) does not open the buyer conversation.
        throw new ApiError('NOT_FOUND', 'Job not found');
    }
}

export async function shopJobFlags(shopId: string): Promise<ShopJobFlagsResponse> {
    const rows = await getDb().select({ orderId: manufacturingJobs.orderId }).from(manufacturingJobs).where(eq(manufacturingJobs.shopId, shopId)).limit(500);
    const ids = [...new Set(rows.map((r) => r.orderId))];
    const [priority, unread] = await Promise.all([priorityOrderIds(ids), unreadCounts(ids, 'shop')]);
    const orders: ShopJobFlagsResponse['orders'] = {};
    for (const id of ids) orders[id] = { priority: priority.has(id), unread: unread.get(id) ?? 0 };
    return { orders };
}
