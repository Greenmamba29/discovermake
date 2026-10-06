/**
 * `advanceOrder` — the ONLY function that writes `orders.status`.
 *
 * Implemented in the foundation so every agent builds against real behaviour.
 * Owner: orders agent (may extend `AdvanceMeta`, must keep the semantics):
 *   1. lock the order row (SELECT ... FOR UPDATE)
 *   2. assertTransition(from, to)  -> IllegalTransitionError (HTTP 409) if not allowed
 *   3. update status (+ lifecycle timestamps, version++)
 *   4. insert order_status_history
 *   5. emit `order.status_changed` in the same transaction
 */
import { eq, sql } from 'drizzle-orm';
import type { Actor } from '../../contracts/common';
import { actorId } from '../../contracts/common';
import type { OrderStatus } from '../../contracts/enums';
import { withTx, type DbOrTx } from '../db';
import { orders, orderStatusHistory } from '../db/schema';
import { emitEvent } from '../events/outbox';
import { assertTransition } from './state';

export type OrderRow = typeof orders.$inferSelect;

export type AdvanceMeta = {
    /** Human/ops reason, stored in history + event payload (e.g. decline reason, cancel reason). */
    reason?: string;
    /** event_id that caused this transition (ADR-0002 causation_id). */
    causationId?: string | null;
    /** Assign the shop (set when a job is accepted). */
    shopId?: string;
    /** Extra structured context stored in order_status_history.meta. */
    data?: Record<string, unknown>;
    /** Override "now" (tests). */
    at?: Date;
};

export class OrderNotFoundError extends Error {
    constructor(public readonly orderId: string) {
        super(`Order ${orderId} not found`);
        this.name = 'OrderNotFoundError';
    }
}

/**
 * Move an order to `to`. Pass `tx` to join the caller's transaction (so the job /
 * payment / shipment change and the order transition commit atomically).
 */
export async function advanceOrder(orderId: string, to: OrderStatus, actor: Actor, meta: AdvanceMeta = {}, tx?: DbOrTx): Promise<OrderRow> {
    return withTx(async (t) => {
        const [current] = await t.select().from(orders).where(eq(orders.id, orderId)).for('update');
        if (!current) throw new OrderNotFoundError(orderId);
        const from = current.status;
        assertTransition(from, to);

        const at = meta.at ?? new Date();
        const lifecycle: Partial<typeof orders.$inferInsert> = {};
        if (to === 'PAID') lifecycle.paidAt = current.paidAt ?? at;
        if (to === 'SHIPPED') lifecycle.shippedAt = at;
        if (to === 'DELIVERED') lifecycle.deliveredAt = at;
        if (to === 'COMPLETE') lifecycle.completedAt = at;
        if ((to === 'CANCELLED' || to === 'REFUNDED') && meta.reason) lifecycle.cancelReason = meta.reason;
        if (meta.shopId) lifecycle.shopId = meta.shopId;

        const [updated] = await t
            .update(orders)
            .set({ status: to, version: sql`${orders.version} + 1`, updatedAt: at, ...lifecycle })
            .where(eq(orders.id, orderId))
            .returning();

        const event = await emitEvent(t, {
            type: 'order.status_changed',
            payload: { orderId, from, to, reason: meta.reason ?? null },
            actor,
            correlationId: current.correlationId,
            buildId: current.buildId,
            orderId,
            causationId: meta.causationId ?? null,
            timestamp: at,
        });

        await t.insert(orderStatusHistory).values({
            orderId,
            fromStatus: from,
            toStatus: to,
            actorId: actorId(actor),
            reason: meta.reason ?? null,
            meta: meta.data ?? {},
            eventId: event.event_id,
            createdAt: at,
        });

        return updated;
    }, tx);
}
