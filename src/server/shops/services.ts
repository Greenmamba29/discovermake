/**
 * Shop service capability (finishes + secondary operations), shared by quote routing
 * and dispatch. Dependency-free on purpose (db only) so both modules can import it
 * without pulling in the rest of the shops module.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { getDb, type DbOrTx } from '../db';
import { shopServices } from '../db/schema';

/**
 * Of `shopIds`, the shops with an ACTIVE `shop_services` row for EVERY id in
 * `serviceIds`. With no required services every shop qualifies.
 */
export async function shopsOfferingAll(serviceIds: readonly string[], shopIds: readonly string[], db: DbOrTx = getDb()): Promise<Set<string>> {
    const candidates = [...new Set(shopIds)];
    const required = [...new Set(serviceIds)];
    if (required.length === 0 || candidates.length === 0) return new Set(candidates);
    const rows = await db
        .select({ shopId: shopServices.shopId, serviceId: shopServices.serviceId })
        .from(shopServices)
        .where(and(inArray(shopServices.shopId, candidates), inArray(shopServices.serviceId, required), eq(shopServices.active, true)));
    const offered = new Map<string, Set<string>>();
    for (const r of rows) {
        const set = offered.get(r.shopId) ?? new Set<string>();
        set.add(r.serviceId);
        offered.set(r.shopId, set);
    }
    return new Set(candidates.filter((id) => required.every((svc) => offered.get(id)?.has(svc))));
}
