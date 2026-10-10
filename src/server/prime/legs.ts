/**
 * Supplier fulfilment leg state machine (pure, no I/O).
 *
 *   PO_PLACED ─► IN_PRODUCTION_AT_SUPPLIER ─► SHIPPED_INBOUND ─► RECEIVED_AT_PARTNER ─► DELIVERED
 *                                                  │                  │   ▲
 *                                                  │ (direct ship)    ▼   │ (rework passes QA)
 *                                                  └──────► DELIVERED  QA_FAILED
 *   CANCELLED from any open status (refund).
 *
 * Who moves it:
 * - ops (Sourcing desk): IN_PRODUCTION_AT_SUPPLIER, SHIPPED_INBOUND, and DELIVERED for direct ship;
 * - the receiving partner (Shop Console "Mark freight received"): RECEIVED_AT_PARTNER;
 * - QA at receipt: QA_FAILED / back to RECEIVED_AT_PARTNER after a passing re-inspection;
 * - the outbound shipment's delivery: DELIVERED; a refund: CANCELLED.
 *
 * The order moves through the R1 order state machine alongside it (ADR-0007, unchanged table):
 *   deposit paid -> PAID; PO approved -> DISPATCHED; supplier production -> ACCEPTED (receiving
 *   partner assigned); freight received -> IN_PRODUCTION; QA at receipt -> QA_PASSED / QA_FAILED;
 *   label -> SHIPPED (balance must be paid); delivered -> DELIVERED -> COMPLETE.
 */
import type { OrderStatus, SupplierLegStatus } from '../../contracts/enums';

export const LEG_TRANSITIONS: Readonly<Record<SupplierLegStatus, readonly SupplierLegStatus[]>> = {
    PO_PLACED: ['IN_PRODUCTION_AT_SUPPLIER', 'CANCELLED'],
    IN_PRODUCTION_AT_SUPPLIER: ['SHIPPED_INBOUND', 'CANCELLED'],
    SHIPPED_INBOUND: ['RECEIVED_AT_PARTNER', 'DELIVERED', 'CANCELLED'],
    RECEIVED_AT_PARTNER: ['QA_FAILED', 'DELIVERED', 'CANCELLED'],
    QA_FAILED: ['RECEIVED_AT_PARTNER', 'CANCELLED'],
    DELIVERED: [],
    CANCELLED: [],
};

/** Statuses ops may set from the Sourcing desk (supplier-side news). */
export const OPS_LEG_TARGETS: ReadonlySet<SupplierLegStatus> = new Set<SupplierLegStatus>(['IN_PRODUCTION_AT_SUPPLIER', 'SHIPPED_INBOUND', 'DELIVERED']);

export class IllegalLegTransitionError extends Error {
    constructor(
        public readonly from: SupplierLegStatus,
        public readonly to: SupplierLegStatus,
        reason?: string,
    ) {
        super(reason ?? `Illegal supplier leg transition ${from} -> ${to}`);
        this.name = 'IllegalLegTransitionError';
    }
}

export function canLegTransition(from: SupplierLegStatus, to: SupplierLegStatus, opts: { directShip: boolean }): boolean {
    if (!LEG_TRANSITIONS[from].includes(to)) return false;
    // Direct ship skips the partner: it can neither be received nor delivered through the partner path.
    if (from === 'SHIPPED_INBOUND' && to === 'DELIVERED') return opts.directShip;
    if (from === 'SHIPPED_INBOUND' && to === 'RECEIVED_AT_PARTNER') return !opts.directShip;
    if (from === 'RECEIVED_AT_PARTNER' && to === 'DELIVERED') return !opts.directShip;
    return true;
}

export function assertLegTransition(from: SupplierLegStatus, to: SupplierLegStatus, opts: { directShip: boolean }): void {
    if (!canLegTransition(from, to, opts)) throw new IllegalLegTransitionError(from, to);
}

/** What ops may move a leg to from the desk right now. */
export function opsAllowedNext(from: SupplierLegStatus, opts: { directShip: boolean }): SupplierLegStatus[] {
    return LEG_TRANSITIONS[from].filter((to) => OPS_LEG_TARGETS.has(to) && canLegTransition(from, to, opts) && (to !== 'DELIVERED' || opts.directShip));
}

/**
 * Order transitions that accompany an ops-driven leg change, in order. The partner path's
 * later order moves come from the Shop Console (receive, QA, ship) and the carrier.
 */
export function orderStepsForLeg(to: SupplierLegStatus, opts: { directShip: boolean }): OrderStatus[] {
    switch (to) {
        case 'IN_PRODUCTION_AT_SUPPLIER':
            return ['ACCEPTED'];
        case 'SHIPPED_INBOUND':
            // Direct ship: the pre-shipment inspection at origin is the QA gate.
            return opts.directShip ? ['IN_PRODUCTION', 'QA_PASSED'] : [];
        case 'DELIVERED':
            return opts.directShip ? ['SHIPPED', 'DELIVERED'] : [];
        default:
            return [];
    }
}

/** Short buyer sentence for a leg status (one plain status sentence, Uber rule). */
export function legSentence(status: SupplierLegStatus | null, ctx: { origin: string; partnerCity: string | null; directShip: boolean }): string {
    const partner = ctx.partnerCity ? `our partner in ${ctx.partnerCity}` : 'our US receiving partner';
    switch (status) {
        case null:
            return 'Deposit received · DiscoverMake is approving the purchase order';
        case 'PO_PLACED':
            return `Purchase order placed with a verified partner in ${ctx.origin}`;
        case 'IN_PRODUCTION_AT_SUPPLIER':
            return `Being made in ${ctx.origin}`;
        case 'SHIPPED_INBOUND':
            return ctx.directShip ? `Shipped to you from ${ctx.origin}` : `On its way to ${partner} for inspection`;
        case 'RECEIVED_AT_PARTNER':
            return `Received by ${partner} · inspecting`;
        case 'QA_FAILED':
            return 'Did not pass receiving inspection · we are fixing it at no cost to you';
        case 'DELIVERED':
            return 'Delivered';
        case 'CANCELLED':
            return 'Purchase order cancelled';
        default: {
            const never: never = status;
            throw new Error(`Unknown leg status ${String(never)}`);
        }
    }
}
