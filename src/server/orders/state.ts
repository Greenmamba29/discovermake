/**
 * Order state machine (pure; no I/O). ADR-0007.
 *
 *   PENDING_PAYMENT ─► PAID ─► DISPATCHED ─► ACCEPTED ─► IN_PRODUCTION ─► QA_PASSED ─► SHIPPED ─► DELIVERED ─► COMPLETE
 *        │   ▲                    │                          │   ▲
 *        ▼   │                    ▼ (no shop accepted)        ▼   │ (rework)
 *   PAYMENT_FAILED              PAID                        QA_FAILED
 *
 *   CANCELLED: only before money moved (PENDING_PAYMENT, PAYMENT_FAILED).
 *   REFUNDED:  after payment, any time before shipping (PAID .. QA_PASSED).
 *
 * The only writer of `orders.status` is `advanceOrder()` (src/server/orders/advance.ts),
 * which calls `assertTransition()` and records history + an `order.status_changed` event.
 */
import type { OrderStatus, UniversalStatus } from '../../contracts/enums';
import type { TrackingStepKey } from '../../contracts/orders';

export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
    PENDING_PAYMENT: ['PAID', 'PAYMENT_FAILED', 'CANCELLED'],
    PAYMENT_FAILED: ['PENDING_PAYMENT', 'PAID', 'CANCELLED'],
    PAID: ['DISPATCHED', 'REFUNDED'],
    DISPATCHED: ['ACCEPTED', 'PAID', 'REFUNDED'],
    ACCEPTED: ['IN_PRODUCTION', 'REFUNDED'],
    IN_PRODUCTION: ['QA_PASSED', 'QA_FAILED', 'REFUNDED'],
    QA_FAILED: ['IN_PRODUCTION', 'REFUNDED'],
    QA_PASSED: ['SHIPPED', 'REFUNDED'],
    SHIPPED: ['DELIVERED'],
    DELIVERED: ['COMPLETE'],
    COMPLETE: [],
    CANCELLED: [],
    REFUNDED: [],
};

export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = ['COMPLETE', 'CANCELLED', 'REFUNDED'];

export class IllegalTransitionError extends Error {
    constructor(
        public readonly from: OrderStatus,
        public readonly to: OrderStatus,
    ) {
        super(`Illegal order transition ${from} -> ${to}`);
        this.name = 'IllegalTransitionError';
    }
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
    return ORDER_TRANSITIONS[from].includes(to);
}

/** Throws IllegalTransitionError unless `from -> to` is in the table. */
export function assertTransition(from: OrderStatus, to: OrderStatus): void {
    if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}

export function isTerminal(status: OrderStatus): boolean {
    return TERMINAL_ORDER_STATUSES.includes(status);
}

/** Order status -> universal status language (spec §23). */
export const ORDER_UNIVERSAL_STATUS: Readonly<Record<OrderStatus, UniversalStatus>> = {
    PENDING_PAYMENT: 'NEEDS_INPUT',
    PAYMENT_FAILED: 'FAILED',
    PAID: 'READY',
    DISPATCHED: 'REVIEW',
    ACCEPTED: 'IN_PRODUCTION',
    IN_PRODUCTION: 'IN_PRODUCTION',
    QA_FAILED: 'IN_PRODUCTION',
    QA_PASSED: 'IN_PRODUCTION',
    SHIPPED: 'IN_PRODUCTION',
    DELIVERED: 'COMPLETE',
    COMPLETE: 'COMPLETE',
    CANCELLED: 'CANCELLED',
    REFUNDED: 'CANCELLED',
};

export function toUniversalStatus(status: OrderStatus): UniversalStatus {
    return ORDER_UNIVERSAL_STATUS[status];
}

/** Default plain-language label + progress for the buyer tracker. */
export const ORDER_STATUS_DISPLAY: Readonly<Record<OrderStatus, { label: string; progressPct: number; step: TrackingStepKey }>> = {
    PENDING_PAYMENT: { label: 'Waiting for payment', progressPct: 5, step: 'DESIGN' },
    PAYMENT_FAILED: { label: 'Payment failed · try again', progressPct: 5, step: 'DESIGN' },
    PAID: { label: 'Paid · finding your shop', progressPct: 15, step: 'MATERIALS' },
    DISPATCHED: { label: 'Waiting for the shop to accept', progressPct: 20, step: 'MATERIALS' },
    ACCEPTED: { label: 'Shop accepted · staging material', progressPct: 30, step: 'MATERIALS' },
    IN_PRODUCTION: { label: 'In production', progressPct: 55, step: 'PRODUCTION' },
    QA_FAILED: { label: 'Rework in progress after inspection', progressPct: 55, step: 'QA' },
    QA_PASSED: { label: 'Passed inspection · packing', progressPct: 75, step: 'QA' },
    SHIPPED: { label: 'Shipped · in transit', progressPct: 85, step: 'SHIPPING' },
    DELIVERED: { label: 'Delivered', progressPct: 100, step: 'DELIVERED' },
    COMPLETE: { label: 'Complete · passport available', progressPct: 100, step: 'DELIVERED' },
    CANCELLED: { label: 'Cancelled', progressPct: 0, step: 'DESIGN' },
    REFUNDED: { label: 'Refunded', progressPct: 0, step: 'DESIGN' },
};
