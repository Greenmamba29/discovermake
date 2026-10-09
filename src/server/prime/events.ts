/**
 * Outbox subscriber for R3 Prime (registered in src/server/events/registry.ts).
 * At-least-once: every handler is idempotent.
 */
import type { DomainEventEnvelope } from '../../contracts/events';
import { requestPurchaseOrderApprovals } from './purchase-orders';

export async function handlePrimeEvent(event: DomainEventEnvelope): Promise<void> {
    if (event.event_type === 'order.deposit_paid') {
        // A separate transaction so the sourcing_jobs row is locked first (LOCK ORDER).
        await requestPurchaseOrderApprovals((event.payload as { orderId: string }).orderId);
    }
}
