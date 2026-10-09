/**
 * Persist the membership benefits an order was priced with (order_benefits). Read by the
 * Shop Console (priority flag) and, later, by the Delivery Promise engine (guaranteed dates).
 */
import { eq, inArray } from 'drizzle-orm';
import type { DbOrTx } from '../db';
import { getDb } from '../db';
import { orderBenefits } from '../db/schema';
import type { BenefitPricing, BenefitResult } from './benefits';

export async function recordOrderBenefits(tx: DbOrTx, orderId: string, result: BenefitResult<BenefitPricing>, userId: string | null): Promise<void> {
    if (!result.flags.membershipId && !result.benefits.length) return;
    await tx
        .insert(orderBenefits)
        .values({
            orderId,
            userId,
            membershipId: result.flags.membershipId,
            priority: result.flags.priority,
            guaranteedDates: result.flags.guaranteedDates,
            shippingWaivedCents: result.shippingWaivedCents,
            materialDiscountCents: result.materialDiscountCents,
        })
        .onConflictDoNothing({ target: orderBenefits.orderId });
}

export async function getOrderBenefits(orderId: string) {
    const [row] = await getDb().select().from(orderBenefits).where(eq(orderBenefits.orderId, orderId)).limit(1);
    return row ?? null;
}

/** Priority flags for a set of orders (Shop Console job list). */
export async function priorityOrderIds(orderIds: string[]): Promise<Set<string>> {
    if (!orderIds.length) return new Set();
    const rows = await getDb().select({ orderId: orderBenefits.orderId, priority: orderBenefits.priority }).from(orderBenefits).where(inArray(orderBenefits.orderId, orderIds));
    return new Set(rows.filter((r) => r.priority).map((r) => r.orderId));
}
