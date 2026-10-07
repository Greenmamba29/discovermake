/**
 * In-process outbox subscribers (ADR-0002). Registered lazily with dynamic imports so
 * the outbox module stays free of import cycles with the domain modules it serves.
 * Every entry point that relays events (immediate delivery, the publish cron, the
 * lazy maintenance sweep) calls `ensureSubscribers()` first.
 */
import { subscribe } from './outbox';

let registration: Promise<void> | null = null;

export function ensureSubscribers(): Promise<void> {
    registration ??= (async () => {
        const { handleOrderEvent } = await import('../orders/payment-events');
        subscribe(handleOrderEvent);
        // Sourcing bridge (ADR-0005): auto-request on REVIEW quotes, ops notices for approvals / desk hand-offs.
        const { handleSourcingEvent } = await import('../sourcing/auto-request');
        subscribe(handleSourcingEvent);
    })();
    return registration;
}
