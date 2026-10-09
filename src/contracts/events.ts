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
    PromiseLeg,
    SupplierLegStatus,
} from './enums';
import { IsoDateTime } from './common';
import { CreationIntentKind, MakeAiRiskClass } from './make-ai';
import { CAD_FAMILIES, CadArtifactKind } from './cad';

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
    /** No shop could take the order, or (with `reason`) it is not dispatchable as paid and waits for ops. */
    'dispatch.unmatched': z.object({ orderId: id, excludedShopIds: z.array(z.string()), reason: z.string().max(40).optional(), detail: z.string().max(500).optional() }),
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
        family: z.enum(CAD_FAMILIES),
        partId: id.nullable(),
        artifacts: z.array(z.object({ kind: CadArtifactKind, key: z.string(), sha256: z.string() })),
    }),
    /** Workflow 01 "Makeability" + "Preliminary quote": the R1 engine priced every flat pattern of a CAD version. */
    'makeability.completed': z.object({ buildId: id, version: z.number().int().positive(), makeabilityScore: z.number().int().min(0).max(100), partCount: z.number().int().nonnegative() }),
    'quote.preliminary': z.object({
        buildId: id,
        version: z.number().int().positive(),
        quantity: z.number().int().positive(),
        lowCents: z.number().int().nonnegative(),
        highCents: z.number().int().nonnegative(),
        productionDaysMin: z.number().int().positive(),
        productionDaysMax: z.number().int().positive(),
        trustLevel: z.enum(['BINDING', 'ESTIMATE']),
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

    // ---- R3 Prime: supplier-route ordering + Delivery Promise (docs/architecture/r3-prime.md) ----
    /** A supplier confirmed an offer against the exact design version (trust SUPPLIER_CONFIRMED). */
    'quote.supplier_confirmed': z.object({ offerId: id, jobId: id, buildId: id, designVersion: z.number().int().positive(), totalCents: cents }),
    /** A BINDING quote was made from an approved supplier-confirmed offer (offer + margin + risk reserve). */
    'quote.binding': z.object({
        quoteId: id,
        buildId: id,
        offerId: id,
        subtotalCents: cents,
        riskReserveCents: cents,
        riskScore: z.number().min(0).max(1),
        depositPct: z.number().min(0).max(1),
        validUntil: IsoDateTime,
    }),
    /** Supplier-route deposit received; the PO approvals are requested from it (job row locked first). */
    'order.deposit_paid': z.object({ orderId: id, paymentId: id, depositCents: cents }),
    /** Human approvals for the purchase order (and the supplier deposit) were requested. */
    'po.approval_requested': z.object({ orderId: id, approvalId: id, depositApprovalId: id.nullable(), offerId: id }),
    /** Ops approved the PO: the supplier fulfilment leg exists. */
    'po.placed': z.object({ orderId: id, legId: id, poNumber: z.string(), approvalId: id, supplierId: id }),
    /** Ops approved paying the supplier deposit (money out, ledger `supplier_deposit:<orderId>`). */
    'po.deposit_approved': z.object({ orderId: id, legId: id.nullable(), approvalId: id, amountCents: cents }),
    'supplier_leg.status_changed': z.object({ orderId: id, legId: id, from: SupplierLegStatus, to: SupplierLegStatus, note: z.string().nullable() }),
    /** The balance of a supplier-route order is due (receiving QA passed); a payment session exists. */
    'order.balance_due': z.object({ orderId: id, paymentId: id, amountCents: cents }),
    'promise.set': z.object({ orderId: id, promisedDate: z.string(), p90Date: z.string(), shown: z.boolean(), bufferDays: z.number().int().nonnegative(), riskScore: z.number().min(0).max(1) }),
    'promise.at_risk': z.object({ orderId: id, promisedDate: z.string(), p90Date: z.string(), currentLeg: PromiseLeg.nullable() }),
    'promise.missed': z.object({ orderId: id, promisedDate: z.string(), deliveredOn: z.string(), responsibleLeg: PromiseLeg, creditId: id.nullable(), creditCents: cents }),
    'promise.kept': z.object({ orderId: id, promisedDate: z.string(), deliveredOn: z.string() }),
    'credit.issued': z.object({ creditId: id, orderId: id, amountCents: cents, responsibleLeg: PromiseLeg }),
    'credit.redeemed': z.object({ creditId: id, orderId: id, amountCents: cents }),
    // ---- R2: accounts (ADR-0009) -----------------------------------------
    /** A sign-in created a new account. No email in the payload (the user row has it). */
    'user.created': z.object({ userId: id, method: z.enum(['email', 'passkey', 'google', 'apple']) }),
    'user.signed_in': z.object({
        userId: id,
        method: z.enum(['email', 'passkey', 'google', 'apple']),
        created: z.boolean(),
        claimedBuilds: z.number().int().nonnegative(),
        claimedOrders: z.number().int().nonnegative(),
    }),
    /** A guest build (this device's, or a legacy build behind a claimed order) now belongs to a user. */
    'build.claimed': z.object({ buildId: id, userId: id }),

    // ---- R2 Stage 1: Build Workspace attachments + passport replacements ----
    /** A reference image or CAD file was uploaded to a build and verified (size, magic bytes, sha256). */
    'build.attachment_added': z.object({
        buildId: id,
        attachmentId: id,
        designVersion: z.number().int().positive(),
        kind: z.enum(['image', 'cad']),
        contentType: z.string().max(100),
        sizeBytes: z.number().int().positive(),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
    }),
    'build.attachment_removed': z.object({ buildId: id, attachmentId: id }),
    /** "Order a replacement" on a Product Passport created a fresh quote for the same part design. */
    'passport.replacement_quoted': z.object({ passportId: id, quoteId: id, partId: id, buildId: id, quantity: z.number().int().positive() }),

    // ---- R4: Live (workflow 06, ADR-0003) ----------------------------------
    /** Funds are held at the provider (manual capture); the order stays PENDING_PAYMENT until capture. */
    'payment.authorized': z.object({ orderId: id, paymentId: id, provider: PaymentProviderName, providerRef: z.string(), amountCents: cents, currency: z.string() }),
    /** An authorization (or an unpaid session) was released without capturing: nothing was charged. */
    'payment.authorization_released': z.object({ orderId: id, paymentId: id, provider: PaymentProviderName, reason: z.string() }),
    /** Mirrors of the Live Build Protocol events that matter outside the stream (the full log lives in `live_events`). */
    'live.show_started': z.object({ showId: id, channelId: id, displayId: z.string() }),
    'live.show_ended': z.object({ showId: id, channelId: id, displayId: z.string(), durationMs: z.number().int().nonnegative() }),
    'live.product_featured': z.object({ showId: id, buildId: id, seq: z.number().int().positive() }),
    'live.drop_started': z.object({ dropId: id, showId: id.nullable(), buildId: id, quoteId: id, priceCents: cents, totalSlots: z.number().int().positive(), thresholdSlots: z.number().int().positive(), closesAt: IsoDateTime }),
    'live.slot_claimed': z.object({ dropId: id, claimId: id, orderId: id, quantity: z.number().int().positive(), claimedSlots: z.number().int().nonnegative() }),
    'live.drop_closed': z.object({ dropId: id, status: z.enum(['CONFIRMED', 'FAILED']), claimedSlots: z.number().int().nonnegative(), thresholdSlots: z.number().int().positive(), captured: z.number().int().nonnegative(), released: z.number().int().nonnegative() }),
    // ---- R6 Reconstruct ----
    /** A buyer started rebuilding a broken part from photos (optionally linked to its passport). */
    'reconstruct.started': z.object({ buildId: id, partType: z.enum(['knob', 'spacer', 'bracket']), passportId: id.nullable() }),
    /** A caliper / ruler reading was confirmed (the only dimensions CAD may use). */
    'reconstruct.dimension_confirmed': z.object({
        buildId: id,
        version: z.number().int().positive(),
        param: z.string(),
        valueMm: z.number().positive(),
        unit: z.enum(['mm', 'in']),
        photoEstimateMm: z.number().nullable(),
        deltaPct: z.number().nullable(),
    }),
    /** CAD generated from the confirmed readings (family + spec from the Reconstruct planner). */
    'reconstruct.cad_generated': z.object({ buildId: id, version: z.number().int().positive(), family: z.string(), printed: z.boolean(), quoteId: id.nullable() }),
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
