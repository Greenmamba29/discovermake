/**
 * Sourcing contracts (ADR-0005, workflow 03): the DiscoverMake Sourcing MCP server
 * that Accio Work calls (inverted control), plus the ops sourcing desk and the
 * customer-facing supplier offers on the Manufacturing Route.
 *
 * Agent-facing shapes (`SourcingRequest`, `*Input`, tool results) are snake_case
 * because they are read by external LLM agents and mirror the workflow-03 JSON.
 * UI-facing views are camelCase like the rest of `@/contracts`.
 *
 * Money is integer cents everywhere (the Quote Normalization agent converts
 * supplier replies). Offers are always tied to one `design_version`; an offer for
 * any other version is rejected with STALE_DESIGN_VERSION.
 */
import { z } from 'zod';
import { ApprovalId, BuildDisplayId, BuildId, Cents, IsoDateTime, PartId, SourcingJobId, SupplierId, SupplierOfferId, idOf } from './common';
import {
    ApprovalKind,
    ApprovalStatus,
    ApproverRole,
    Incoterm,
    NegotiationStatus,
    PackageTier,
    SourcingChannel,
    SourcingDocumentKind,
    SourcingJobStatus,
    SupplierOfferStatus,
    TrustLevel,
} from './enums';

const text = (max: number) => z.string().trim().min(1).max(max);
const Country = z.string().trim().length(2).toUpperCase();

export const SourcingDocumentId = idOf('sourcingDocument');

/** Human display id for a sourcing job, e.g. `SRC-7K3QX`. */
export const SourcingDisplayId = z.string().regex(/^SRC-[0-9A-Z]{5,8}$/);

// ---------------------------------------------------------------------------
// Approval policy + boundary
// ---------------------------------------------------------------------------

/**
 * What the sourcing agent may do on this job without a human (ADR-0005).
 * `allow_purchase` and `allow_full_package` exist so the policy is explicit, but
 * the bridge NEVER lets an agent purchase or release the full package by itself:
 * those always go through `request_approval` (see src/server/sourcing/policy.ts).
 */
export const ApprovalPolicy = z.object({
    allow_supplier_contact: z.boolean(),
    allow_negotiation: z.boolean(),
    allow_sample_request: z.boolean(),
    allow_purchase: z.literal(false),
    allow_full_package: z.literal(false),
    /** Negotiation bound: offers above this unit price are flagged for review. null = no bound. */
    max_unit_price_cents: Cents.nullable(),
    /** Latest acceptable delivery (production + shipping) in days. null = no bound. */
    max_total_lead_days: z.number().int().positive().nullable(),
});
export type ApprovalPolicy = z.infer<typeof ApprovalPolicy>;

export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = {
    allow_supplier_contact: true,
    allow_negotiation: true,
    allow_sample_request: false,
    allow_purchase: false,
    allow_full_package: false,
    max_unit_price_cents: null,
    max_total_lead_days: null,
};

// ---------------------------------------------------------------------------
// SourcingRequest (what the agent works on)
// ---------------------------------------------------------------------------

export const CriticalTolerance = z.object({
    feature: text(120),
    nominal_mm: z.number(),
    plus_mm: z.number().nonnegative(),
    minus_mm: z.number().nonnegative(),
});

export const SourcingRequest = z.object({
    sourcing_request_id: SourcingJobId,
    display_id: SourcingDisplayId,
    build_id: BuildId,
    build_display_id: BuildDisplayId,
    design_version: z.number().int().positive(),
    part_id: PartId.nullable(),
    name: text(200),
    quantity: z.number().int().positive().max(1_000_000),
    target_unit_cost_cents: Cents.nullable(),
    material: text(120),
    process: z.array(text(80)).min(1).max(8),
    /** Bounding box. For a 2D flat pattern, z is the sheet thickness, or 0 when no material is chosen yet. */
    dimensions_mm: z.object({ x: z.number().positive(), y: z.number().positive(), z: z.number().nonnegative() }).nullable(),
    critical_tolerances: z.array(CriticalTolerance).max(20),
    surface_finish: z.string().trim().max(120).nullable(),
    required_certifications: z.array(text(80)).max(10),
    target_regions: z.array(Country).max(10),
    target_delivery_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    acceptable_substitutions: z.array(text(200)).max(10),
    /** What exists in the package (not URLs: use get_attachments). */
    attachments: z.array(text(80)).max(20),
    notes: z.string().trim().max(2000).nullable(),
    approval_policy: ApprovalPolicy,
});
export type SourcingRequest = z.infer<typeof SourcingRequest>;

// ---------------------------------------------------------------------------
// Agent inputs (MCP tool arguments)
// ---------------------------------------------------------------------------

/** Every write is made under the lease returned by `next_job`. */
const Lease = {
    sourcing_request_id: SourcingJobId,
    lease_id: z.string().uuid(),
};

export const NextJobInput = z.object({
    /** Optional: only lease jobs that need one of these processes. */
    processes: z.array(text(80)).max(8).optional(),
});

export const GetJobInput = z.object({ sourcing_request_id: SourcingJobId });

export const GetAttachmentsInput = z.object({
    ...Lease,
    /** FULL needs an APPROVED RELEASE_FULL_PACKAGE approval for `supplier_id`. */
    tier: PackageTier.default('REDACTED'),
    supplier_id: SupplierId.optional(),
});

export const SupplierEvidenceInput = z.object({
    kind: z.enum(['platform_profile', 'verified_badge', 'certificate', 'factory_photo', 'transaction_history', 'website', 'other']),
    url: z.string().url().max(1000).optional(),
    note: text(500),
});
export type SupplierEvidenceInput = z.infer<typeof SupplierEvidenceInput>;

export const SubmitSupplierInput = z.object({
    ...Lease,
    name: text(200),
    platform: z.enum(['alibaba', '1688', 'made-in-china', 'global-sources', 'direct', 'other']),
    /** The platform's own supplier id/handle, used to de-duplicate suppliers. */
    platform_ref: z.string().trim().min(1).max(200).optional(),
    country: Country,
    verified: z.boolean(),
    profile_url: z.string().url().max(1000).optional(),
    capabilities: z.array(text(80)).max(20).default([]),
    evidence: z.array(SupplierEvidenceInput).max(20).default([]),
});
export type SubmitSupplierInput = z.infer<typeof SubmitSupplierInput>;

export const SubmitOfferInput = z.object({
    ...Lease,
    /** Retries with the same key return the first offer instead of creating a duplicate. */
    idempotency_key: z.string().trim().min(8).max(100),
    supplier_id: SupplierId,
    design_version: z.number().int().positive(),
    quantity: z.number().int().positive(),
    currency: z.literal('usd').default('usd'),
    unit_price_cents: Cents,
    tooling_cents: Cents.default(0),
    sample_cost_cents: Cents.nullable().default(null),
    /** Freight to the destination under `incoterm`; null when not quoted. */
    shipping_cents: Cents.nullable().default(null),
    moq: z.number().int().positive(),
    production_lead_days: z.number().int().positive().max(365),
    shipping_lead_days: z.number().int().nonnegative().max(180),
    incoterm: Incoterm,
    material: text(120),
    processes: z.array(text(80)).min(1).max(8),
    certifications_claimed: z.array(text(80)).max(10).default([]),
    /**
     * Anything that differs from the request: a substituted material, a relaxed tolerance,
     * a different finish. Any exception makes the offer a SUPPLIER_ESTIMATE and needs a
     * human decision before it can be selected.
     */
    exceptions: z.array(text(300)).max(10).default([]),
    source_evidence: z.array(SupplierEvidenceInput).max(10).default([]),
    attachment_ids: z.array(SourcingDocumentId).max(10).default([]),
    /** 0..1: the agent's confidence that this offer is real and complete. */
    confidence: z.number().min(0).max(1),
    negotiation_status: NegotiationStatus,
    valid_until: IsoDateTime.nullable().default(null),
});
export type SubmitOfferInput = z.infer<typeof SubmitOfferInput>;

export const UpdateNegotiationInput = z.object({
    ...Lease,
    supplier_id: SupplierId,
    status: NegotiationStatus,
    note: text(2000),
});
export type UpdateNegotiationInput = z.infer<typeof UpdateNegotiationInput>;

export const AttachDocumentInput = z.object({
    ...Lease,
    supplier_id: SupplierId.optional(),
    kind: SourcingDocumentKind,
    filename: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .regex(/^[^/\\]+$/, 'filename must not contain path separators'),
    content_type: z.enum(['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain', 'text/csv']),
    /** Base64 file body, max 5 MB decoded. */
    content_base64: z.string().min(4).max(7_000_000),
});
export type AttachDocumentInput = z.infer<typeof AttachDocumentInput>;

export const RequestApprovalInput = z.object({
    ...Lease,
    kind: ApprovalKind,
    supplier_id: SupplierId.optional(),
    supplier_offer_id: SupplierOfferId.optional(),
    reason: text(1000),
    details: z.record(z.unknown()).default({}),
});
export type RequestApprovalInput = z.infer<typeof RequestApprovalInput>;

export const CompleteJobInput = z.object({
    ...Lease,
    outcome: z.enum(['offers_submitted', 'no_viable_suppliers', 'needs_desk']),
    summary: text(4000),
});
export type CompleteJobInput = z.infer<typeof CompleteJobInput>;

/** Error codes a sourcing tool can return (as an MCP tool error with this code in `structuredContent`). */
export const SOURCING_ERROR_CODES = [
    'APPROVAL_REQUIRED', // the action is outside the approval boundary; use request_approval
    'STALE_DESIGN_VERSION', // the build moved to a newer design version
    'LEASE_INVALID', // lease_id unknown, expired, or owned by another client
    'NOT_FOUND',
    'VALIDATION_FAILED',
    'CONFLICT',
    'RATE_LIMITED',
    'UNAUTHORIZED',
] as const;
export const SourcingErrorCode = z.enum(SOURCING_ERROR_CODES);
export type SourcingErrorCode = z.infer<typeof SourcingErrorCode>;

export const SourcingToolError = z.object({
    error: z.object({ code: SourcingErrorCode, message: z.string(), approval_kind: ApprovalKind.optional() }),
});
export type SourcingToolError = z.infer<typeof SourcingToolError>;

export const NextJobResult = z.object({
    job: SourcingRequest.nullable(),
    lease_id: z.string().uuid().nullable(),
    lease_expires_at: IsoDateTime.nullable(),
});
export type NextJobResult = z.infer<typeof NextJobResult>;

export const SignedAttachment = z.object({
    name: z.string(),
    tier: PackageTier,
    url: z.string().url(),
    expires_at: IsoDateTime,
});
export type SignedAttachment = z.infer<typeof SignedAttachment>;

// ---------------------------------------------------------------------------
// UI views
// ---------------------------------------------------------------------------

/** Ops view of an offer (sourcing desk). Includes the supplier identity. */
export const SupplierOfferView = z.object({
    id: SupplierOfferId,
    jobId: SourcingJobId,
    supplier: z.object({ id: SupplierId, name: z.string(), platform: z.string(), country: z.string(), verified: z.boolean() }),
    designVersion: z.number().int().positive(),
    quantity: z.number().int().positive(),
    unitPriceCents: Cents,
    toolingCents: Cents,
    sampleCostCents: Cents.nullable(),
    shippingCents: Cents.nullable(),
    moq: z.number().int().positive(),
    productionLeadDays: z.number().int(),
    shippingLeadDays: z.number().int(),
    incoterm: Incoterm,
    material: z.string(),
    processes: z.array(z.string()),
    certificationsClaimed: z.array(z.string()),
    exceptions: z.array(z.string()),
    confidence: z.number(),
    negotiationStatus: NegotiationStatus,
    trustLevel: TrustLevel,
    status: SupplierOfferStatus,
    validUntil: IsoDateTime.nullable(),
    createdAt: IsoDateTime,
});
export type SupplierOfferView = z.infer<typeof SupplierOfferView>;

/**
 * Buyer view of an offer on the Manufacturing Route. Customers never see the
 * supplier's name or platform ("customers never see Alibaba"): only region,
 * verification, price, dates and the trust label.
 */
export const RouteOfferView = z.object({
    id: SupplierOfferId,
    label: z.string(), // e.g. "Verified partner · Vietnam"
    country: z.string(),
    verified: z.boolean(),
    quantity: z.number().int().positive(),
    unitPriceCents: Cents,
    toolingCents: Cents,
    /** unit × qty + tooling + shipping (when quoted). */
    totalCents: Cents,
    shippingIncluded: z.boolean(),
    totalLeadDays: z.number().int(),
    trustLevel: TrustLevel,
    exceptions: z.array(z.string()),
    status: SupplierOfferStatus,
    /** A pending/decided SELECT_SUPPLIER_OFFER approval for this offer, if any. */
    selection: z.object({ approvalId: ApprovalId, status: ApprovalStatus }).nullable(),
});
export type RouteOfferView = z.infer<typeof RouteOfferView>;

export const SourcingJobView = z.object({
    id: SourcingJobId,
    displayId: SourcingDisplayId,
    buildId: BuildId,
    buildDisplayId: BuildDisplayId,
    partId: PartId.nullable(),
    designVersion: z.number().int().positive(),
    status: SourcingJobStatus,
    channel: SourcingChannel,
    request: SourcingRequest,
    leaseExpiresAt: IsoDateTime.nullable(),
    summary: z.string().nullable(),
    offerCount: z.number().int().nonnegative(),
    pendingApprovalCount: z.number().int().nonnegative(),
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
});
export type SourcingJobView = z.infer<typeof SourcingJobView>;

export const ApprovalView = z.object({
    id: ApprovalId,
    jobId: SourcingJobId.nullable(),
    buildId: BuildId,
    kind: ApprovalKind,
    status: ApprovalStatus,
    approverRole: ApproverRole,
    requestedBy: z.string(),
    supplierId: SupplierId.nullable(),
    supplierOfferId: SupplierOfferId.nullable(),
    reason: z.string(),
    details: z.record(z.unknown()),
    decidedBy: z.string().nullable(),
    decisionNote: z.string().nullable(),
    decidedAt: IsoDateTime.nullable(),
    expiresAt: IsoDateTime.nullable(),
    createdAt: IsoDateTime,
});
export type ApprovalView = z.infer<typeof ApprovalView>;

export const ApprovalDecisionRequest = z.object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    note: z.string().trim().max(1000).optional(),
});
export type ApprovalDecisionRequest = z.infer<typeof ApprovalDecisionRequest>;

/** POST /api/builds/:buildId/sourcing (buyer: "Find manufacturing partners"), or ops via the desk. */
export const CreateSourcingRequest = z.object({
    partId: PartId.optional(),
    quantity: z.number().int().positive().max(1_000_000),
    material: text(120).optional(),
    process: z.array(text(80)).min(1).max(8).optional(),
    surfaceFinish: z.string().trim().max(120).optional(),
    targetUnitCostCents: Cents.optional(),
    targetDeliveryDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    targetRegions: z.array(Country).max(10).optional(),
    notes: z.string().trim().max(2000).optional(),
});
export type CreateSourcingRequest = z.infer<typeof CreateSourcingRequest>;

/** Buyer-facing sourcing status for a build ("Finding manufacturing partners…"). */
export const BuildSourcingView = z.object({
    buildId: BuildId,
    jobs: z.array(
        z.object({
            id: SourcingJobId,
            displayId: SourcingDisplayId,
            status: SourcingJobStatus,
            designVersion: z.number().int().positive(),
            quantity: z.number().int().positive(),
            createdAt: IsoDateTime,
        }),
    ),
    offers: z.array(RouteOfferView),
});
export type BuildSourcingView = z.infer<typeof BuildSourcingView>;

/** Admin: register an Accio Work workspace (or any MCP client) and get its one-time bearer token. */
export const CreateSourcingClientRequest = z.object({ name: text(120) });
export const CreateSourcingClientResponse = z.object({
    clientId: idOf('sourcingClient'),
    name: z.string(),
    /** Shown once. Only its sha256 is stored. */
    token: z.string(),
});
export type CreateSourcingClientResponse = z.infer<typeof CreateSourcingClientResponse>;
