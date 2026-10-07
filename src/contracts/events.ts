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
    ApprovalKind,
    ApprovalStatus,
    ApproverRole,
    DeclineReason,
    NegotiationStatus,
    PackageTier,
    SourcingChannel,
    SourcingDocumentKind,
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
import { CreationIntentKind, MakeAiRiskClass } from './make-ai';

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
    /** A human must look at something (amount mismatch, money for a closed order). Delivered durably via the outbox; never shown to buyers. */
    'ops.alert_requested': z.object({ subject: z.string().min(1).max(300), message: z.string().min(1).max(2000), orderId: id.nullable() }),
    /** A Stripe Connect Express account was created for a partner shop (shops.stripe_account_id set). */
    'shop.connect_account_created': z.object({ shopId: id, accountId: id }),
    /** Stripe reported a change to a shop's Connect account (account.updated). */
    'shop.connect_account_updated': z.object({ shopId: id, accountId: id, payoutsEnabled: z.boolean(), chargesEnabled: z.boolean(), detailsSubmitted: z.boolean() }),
    /** Make AI turned a buyer description into a CreationIntent. No raw prompt or IP: only its length + sha256. */
    'make_ai.intent_created': z.object({
        intentId: id,
        intent: CreationIntentKind,
        riskClass: MakeAiRiskClass,
        productType: z.string().max(120),
        requirementCount: z.number().int().nonnegative(),
        unknownCount: z.number().int().nonnegative(),
        refused: z.boolean(),
        model: z.string(),
        promptChars: z.number().int().nonnegative(),
        promptSha256: z.string().regex(/^[0-9a-f]{64}$/),
    }),

    // ---- R2: Build Graph (ADR-0001) --------------------------------------
    'build.forked': z.object({ buildId: id, derivedFromBuildId: id, fromVersion: z.number().int().positive(), kind: z.enum(['remix', 'clone']) }),
    'design.version_created': z.object({
        buildId: id,
        version: z.number().int().positive(),
        parentVersion: z.number().int().positive().nullable(),
        summary: z.string().max(300),
        nodeCount: z.number().int().nonnegative(),
        edgeCount: z.number().int().nonnegative(),
    }),
    'design.version_approved': z.object({ buildId: id, version: z.number().int().positive(), approvedBy: z.string() }),
    'requirements.generated': z.object({ buildId: id, version: z.number().int().positive(), requirementCount: z.number().int().nonnegative(), unknownCount: z.number().int().nonnegative() }),
    'material.recommended': z.object({ buildId: id, version: z.number().int().positive(), material: z.string().max(120), confidence: z.number().min(0).max(1) }),
    /** The CAD worker produced geometry for a design version; `partId` is set when a flat pattern was attached for instant quoting. */
    'cad.generated': z.object({
        buildId: id,
        version: z.number().int().positive(),
        family: z.enum(['sheet_panel', 'l_bracket', 'enclosure']),
        partId: id.nullable(),
        artifacts: z.array(z.object({ kind: z.enum(['STEP', 'DXF', 'GLB']), key: z.string(), sha256: z.string() })),
    }),

    // ---- R2: sourcing bridge (ADR-0005, workflow 03) ----------------------
    'sourcing.requested': z.object({ jobId: id, buildId: id, designVersion: z.number().int().positive(), channel: SourcingChannel, quantity: z.number().int().positive() }),
    'sourcing.job_leased': z.object({ jobId: id, clientId: id, leaseExpiresAt: IsoDateTime }),
    'sourcing.supplier_found': z.object({ jobId: id, supplierId: id, country: z.string(), verified: z.boolean() }),
    'sourcing.offer_received': z.object({ jobId: id, offerId: id, supplierId: id, trustLevel: TrustLevel, unitPriceCents: cents, quantity: z.number().int().positive() }),
    'sourcing.negotiation_updated': z.object({ jobId: id, supplierId: id, status: NegotiationStatus }),
    'sourcing.document_attached': z.object({ jobId: id, documentId: id, kind: SourcingDocumentKind }),
    /** Signed package URLs were handed to a sourcing agent (access log mirror). */
    'sourcing.package_accessed': z.object({ jobId: id, clientId: id, tier: PackageTier, supplierId: id.nullable() }),
    'sourcing.approval_requested': z.object({ approvalId: id, jobId: id.nullable(), buildId: id, kind: ApprovalKind, approverRole: ApproverRole }),
    'sourcing.approval_decided': z.object({ approvalId: id, kind: ApprovalKind, status: ApprovalStatus, decidedBy: z.string() }),
    /** A sourcing agent tried to cross the approval boundary; the bridge refused with APPROVAL_REQUIRED. */
    'sourcing.boundary_blocked': z.object({ jobId: id.nullable(), clientId: id, tool: z.string().max(80), approvalKind: ApprovalKind }),
    'sourcing.completed': z.object({ jobId: id, outcome: z.enum(['offers_submitted', 'no_viable_suppliers', 'needs_desk']), offerCount: z.number().int().nonnegative() }),
    'supplier.selected': z.object({ buildId: id, jobId: id, offerId: id, approvalId: id }),
    'sourcing.cancelled': z.object({ jobId: id, reason: z.string().max(1000).nullable() }),
    /** A lease ended without completion: it ran out (visibility timeout) or its client was revoked. The job is QUEUED again. */
    'sourcing.lease_released': z.object({ jobId: id, reason: z.enum(['expired', 'client_revoked']) }),
    /** The build moved past the offer's design version; the offer can no longer be selected. */
    'sourcing.offer_stale': z.object({ offerId: id, jobId: id, offerVersion: z.number().int().positive(), currentVersion: z.number().int().positive() }),
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
