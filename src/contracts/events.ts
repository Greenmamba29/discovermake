/**
 * Domain events (ADR-0002). Every meaningful state transition writes one of these
 * to `domain_events` (the outbox) IN THE SAME DB TRANSACTION as the state change,
 * via `emitEvent(tx, ...)` from `src/server/events/outbox.ts`.
 *
 * Adding an event type: add it to `EVENT_PAYLOADS` with a zod payload schema.
 * Changing a payload incompatibly: bump `EVENT_SCHEMA_VERSIONS[type]`.
 */
import { z } from 'zod';
import {
    DeclineReason,
    InspectionOutcome,
    MilestoneKind,
    OrderStatus,
    OrderType,
    PaymentProviderName,
    QuoteStatus,
    ShipmentStatus,
    TrustLevel,
} from './enums';
import { IsoDateTime } from './common';

const id = z.string().min(1);
const cents = z.number().int().nonnegative();

export const EVENT_PAYLOADS = {
    'build.created': z.object({ buildId: id, displayId: z.string(), name: z.string() }),
    'part.uploaded': z.object({ partId: id, filename: z.string(), sizeBytes: z.number().int(), fileSha256: z.string() }),
    'part.analyzed': z.object({
        partId: id,
        status: z.enum(['READY', 'NEEDS_INPUT', 'FAILED']),
        units: z.string().nullable(),
        designVersion: z.number().int(),
        error: z.string().nullable(),
    }),
    'dfm.completed': z.object({
        partId: id,
        quoteId: id.nullable(),
        rulesetVersion: z.string(),
        makeabilityScore: z.number().int(),
        blocking: z.boolean(),
        violationCount: z.number().int(),
    }),
    'quote.created': z.object({
        quoteId: id,
        partId: id,
        quantity: z.number().int(),
        unitPriceCents: cents,
        subtotalCents: cents,
        trustLevel: TrustLevel,
        status: QuoteStatus,
        rulesetVersion: z.string(),
    }),
    'order.created': z.object({
        orderId: id,
        orderNumber: z.string(),
        quoteId: id,
        orderType: OrderType,
        totalCents: cents,
        currency: z.string(),
    }),
    /** Emitted by `advanceOrder` for EVERY order transition. */
    'order.status_changed': z.object({
        orderId: id,
        from: OrderStatus,
        to: OrderStatus,
        reason: z.string().nullable(),
    }),
    'payment.completed': z.object({
        orderId: id,
        paymentId: id,
        provider: PaymentProviderName,
        providerRef: z.string(),
        amountCents: cents,
        currency: z.string(),
    }),
    'payment.failed': z.object({
        orderId: id,
        paymentId: id,
        provider: PaymentProviderName,
        providerRef: z.string(),
        reason: z.string().nullable(),
    }),
    /** Spec §12.4: payment success creates a production authorization event. */
    'production.authorized': z.object({ orderId: id, quoteId: id, designVersion: z.number().int() }),
    'order.cancelled': z.object({ orderId: id, reason: z.string() }),
    'order.refunded': z.object({ orderId: id, amountCents: cents, refundRef: z.string().nullable(), reason: z.string() }),
    'order.completed': z.object({ orderId: id }),
    'job.offered': z.object({ jobId: id, orderId: id, shopId: id, offerExpiresAt: IsoDateTime, isRework: z.boolean() }),
    'job.accepted': z.object({ jobId: id, orderId: id, shopId: id }),
    'job.declined': z.object({ jobId: id, orderId: id, shopId: id, reason: DeclineReason, note: z.string().nullable() }),
    'job.expired': z.object({ jobId: id, orderId: id, shopId: id }),
    /** Dispatch found no capable shop; the order stays PAID until ops dispatch or refund it. */
    'dispatch.unmatched': z.object({ orderId: id, excludedShopIds: z.array(z.string()) }),
    /** Open jobs withdrawn from shops because the order was refunded or cancelled. */
    'job.cancelled': z.object({ jobId: id, orderId: id, shopId: id, reason: z.string() }),
    'production.started': z.object({ jobId: id, orderId: id, shopId: id }),
    'production.milestone': z.object({ jobId: id, orderId: id, shopId: id, milestoneId: id, kind: MilestoneKind, note: z.string().nullable() }),
    'production.completed': z.object({ jobId: id, orderId: id, shopId: id }),
    'inspection.passed': z.object({ jobId: id, orderId: id, resultId: id, planId: id }),
    'inspection.failed': z.object({ jobId: id, orderId: id, resultId: id, planId: id, reworkJobId: id.nullable(), failedCheckIds: z.array(z.string()) }),
    'shipment.created': z.object({ shipmentId: id, orderId: id, jobId: id, carrier: z.string(), service: z.string(), trackingNumber: z.string() }),
    'shipment.updated': z.object({ shipmentId: id, orderId: id, status: ShipmentStatus, message: z.string().nullable() }),
    'product.delivered': z.object({ orderId: id, shipmentId: id, deliveredAt: IsoDateTime }),
    'passport.activated': z.object({ passportId: id, orderId: id, snapshotHash: z.string() }),
    'ledger.payment_recorded': z.object({ orderId: id, txnKey: z.string(), totalCents: cents }),
    'payout.created': z.object({ payoutId: id, orderId: id, shopId: id, amountCents: cents }),
} as const;

export type EventType = keyof typeof EVENT_PAYLOADS;
export const EVENT_TYPES = Object.keys(EVENT_PAYLOADS) as [EventType, ...EventType[]];
export const EventTypeSchema = z.enum(EVENT_TYPES);

export type EventPayload<T extends EventType> = z.infer<(typeof EVENT_PAYLOADS)[T]>;

/** Payload schema version per event type. Bump on incompatible payload changes. */
export const EVENT_SCHEMA_VERSIONS: Record<EventType, number> = Object.fromEntries(
    EVENT_TYPES.map((t) => [t, 1]),
) as Record<EventType, number>;

/** ADR-0002 envelope, as read back from `domain_events` and sent to consumers. */
export const DomainEventEnvelope = z.object({
    event_id: z.string().uuid(),
    event_type: EventTypeSchema,
    build_id: z.string().nullable(),
    actor_id: z.string(),
    timestamp: IsoDateTime,
    payload: z.unknown(),
    correlation_id: z.string(),
    causation_id: z.string().nullable(),
    schema_version: z.number().int().positive(),
});
export type DomainEventEnvelope<T extends EventType = EventType> = Omit<z.infer<typeof DomainEventEnvelope>, 'event_type' | 'payload'> & {
    event_type: T;
    payload: EventPayload<T>;
};

/** Parse + validate an envelope's payload against its event type's schema. */
export function parseDomainEvent(raw: unknown): DomainEventEnvelope {
    const env = DomainEventEnvelope.parse(raw);
    const payload = EVENT_PAYLOADS[env.event_type].parse(env.payload);
    return { ...env, payload } as DomainEventEnvelope;
}
