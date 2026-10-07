/**
 * Canonical enum values for DiscoverMake R1.
 *
 * These arrays are the single source of truth: the Postgres enums in
 * `src/server/db/schema.ts` and the zod schemas in `src/contracts/*` are both
 * derived from them. Never redeclare these string unions elsewhere.
 */
import { z } from 'zod';

/** Universal status language (spec §23). The ONLY vocabulary allowed on UI status pills. */
export const UNIVERSAL_STATUSES = [
    'DRAFT',
    'ANALYZING',
    'NEEDS_INPUT',
    'READY',
    'REVIEW',
    'IN_PRODUCTION',
    'LIVE',
    'COMPLETE',
    'FAILED',
    'CANCELLED',
] as const;
export const UniversalStatus = z.enum(UNIVERSAL_STATUSES);
export type UniversalStatus = z.infer<typeof UniversalStatus>;

/** Order lifecycle (see `src/server/orders/state.ts` for the transition table). */
export const ORDER_STATUSES = [
    'PENDING_PAYMENT',
    'PAYMENT_FAILED',
    'PAID',
    'DISPATCHED',
    'ACCEPTED',
    'IN_PRODUCTION',
    'QA_FAILED',
    'QA_PASSED',
    'SHIPPED',
    'DELIVERED',
    'COMPLETE',
    'CANCELLED',
    'REFUNDED',
] as const;
export const OrderStatus = z.enum(ORDER_STATUSES);
export type OrderStatus = z.infer<typeof OrderStatus>;

/** Explicit commerce order types (spec §13, ADR-0004). R1 creates PROTOTYPE / SMALL_BATCH / PRODUCTION_RUN. */
export const ORDER_TYPES = [
    'STOCKED_PRODUCT',
    'MADE_TO_ORDER',
    'CUSTOM_BUILD',
    'REMIX_BUILD',
    'PROTOTYPE',
    'SMALL_BATCH',
    'PRODUCTION_RUN',
    'BUILD_SLOT',
    'LIVE_DROP',
] as const;
export const OrderType = z.enum(ORDER_TYPES);
export type OrderType = z.infer<typeof OrderType>;

/** Quantity tiers shown on the Instant Quote screen. */
export const QUOTE_TIERS = ['PROTOTYPE', 'SMALL_BATCH', 'PRODUCTION_RUN'] as const;
export const QuoteTier = z.enum(QUOTE_TIERS);
export type QuoteTier = z.infer<typeof QuoteTier>;

/** Build lifecycle uses the universal status language directly. */
export const BUILD_STATUSES = UNIVERSAL_STATUSES;
export const BuildStatus = UniversalStatus;
export type BuildStatus = UniversalStatus;

export const PART_STATUSES = [
    'AWAITING_UPLOAD', // part row created, signed upload URL issued, bytes not verified yet
    'ANALYZING', // parse + feature extraction running
    'NEEDS_INPUT', // e.g. units ambiguous; client must call analyze again with `units`
    'READY', // features extracted, quotable
    'FAILED', // unparseable / rejected file (see `error`)
] as const;
export const PartStatus = z.enum(PART_STATUSES);
export type PartStatus = z.infer<typeof PartStatus>;

export const PART_UNITS = ['mm', 'in'] as const;
export const PartUnits = z.enum(PART_UNITS);
export type PartUnits = z.infer<typeof PartUnits>;

/** Accepted CAD formats. R1 parses DXF only; others are rejected at upload with a clear message. */
export const PART_FILE_FORMATS = ['dxf'] as const;
export const PartFileFormat = z.enum(PART_FILE_FORMATS);
export type PartFileFormat = z.infer<typeof PartFileFormat>;

export const QUOTE_STATUSES = [
    'READY', // binding + orderable until valid_until
    'REVIEW', // outside catalog / low confidence: needs shop confirmation (1 business day SLA)
    'NEEDS_INPUT', // blocking DFM violation(s): not orderable
    'EXPIRED', // past valid_until
    'ORDERED', // consumed by a paid order
] as const;
export const QuoteStatus = z.enum(QUOTE_STATUSES);
export type QuoteStatus = z.infer<typeof QuoteStatus>;

/** Quote trust levels (workflow 03). Only BINDING (and approved SUPPLIER_CONFIRMED) is orderable. */
export const TRUST_LEVELS = ['AI_ESTIMATE', 'SUPPLIER_ESTIMATE', 'SUPPLIER_CONFIRMED', 'BINDING'] as const;
export const TrustLevel = z.enum(TRUST_LEVELS);
export type TrustLevel = z.infer<typeof TrustLevel>;

export const PAYMENT_PROVIDERS = ['stripe', 'dev'] as const;
export const PaymentProviderName = z.enum(PAYMENT_PROVIDERS);
export type PaymentProviderName = z.infer<typeof PaymentProviderName>;

export const PAYMENT_STATUSES = ['PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED', 'CANCELLED'] as const;
export const PaymentStatus = z.enum(PAYMENT_STATUSES);
export type PaymentStatus = z.infer<typeof PaymentStatus>;

/**
 * Manufacturing job lifecycle (one job = one shop leg).
 * A QA failure marks the job QA_FAILED (terminal) and opens a NEW rework job
 * (status ACCEPTED, same shop, `rework_of_job_id` set).
 */
export const JOB_STATUSES = [
    'OFFERED',
    'ACCEPTED',
    'DECLINED',
    'EXPIRED',
    'IN_PRODUCTION',
    'QA_FAILED',
    'QA_PASSED',
    'SHIPPED',
    'DELIVERED',
    'CANCELLED',
] as const;
export const JobStatus = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof JobStatus>;

export const DECLINE_REASONS = ['CAPACITY', 'MATERIAL_UNAVAILABLE', 'CAPABILITY', 'DFM_CONCERN', 'OTHER'] as const;
export const DeclineReason = z.enum(DECLINE_REASONS);
export type DeclineReason = z.infer<typeof DeclineReason>;

/** Shop Console milestone buttons, in order. */
export const MILESTONE_KINDS = ['MATERIAL_STAGED', 'CUTTING', 'BENDING', 'FINISHING', 'QA', 'PACKED'] as const;
export const MilestoneKind = z.enum(MILESTONE_KINDS);
export type MilestoneKind = z.infer<typeof MilestoneKind>;

export const INSPECTION_OUTCOMES = ['PASS', 'FAIL'] as const;
export const InspectionOutcome = z.enum(INSPECTION_OUTCOMES);
export type InspectionOutcome = z.infer<typeof InspectionOutcome>;

export const INSPECTION_CHECK_KINDS = ['DIMENSION', 'HOLE_DIAMETER', 'FLATNESS', 'VISUAL', 'FINISH', 'COUNT', 'BEND_ANGLE'] as const;
export const InspectionCheckKind = z.enum(INSPECTION_CHECK_KINDS);
export type InspectionCheckKind = z.infer<typeof InspectionCheckKind>;

export const SHIPMENT_STATUSES = [
    'LABEL_CREATED',
    'IN_TRANSIT',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
    'EXCEPTION',
    'RETURNED',
    'CANCELLED',
] as const;
export const ShipmentStatus = z.enum(SHIPMENT_STATUSES);
export type ShipmentStatus = z.infer<typeof ShipmentStatus>;

export const CARRIER_PROVIDERS = ['easypost', 'manual'] as const;
export const CarrierProviderName = z.enum(CARRIER_PROVIDERS);
export type CarrierProviderName = z.infer<typeof CarrierProviderName>;

export const SHIPPING_METHODS = ['STANDARD', 'EXPEDITED', 'EXPRESS'] as const;
export const ShippingMethod = z.enum(SHIPPING_METHODS);
export type ShippingMethod = z.infer<typeof ShippingMethod>;

export const PASSPORT_STATUSES = ['PENDING', 'ACTIVE', 'REVOKED'] as const;
export const PassportStatus = z.enum(PASSPORT_STATUSES);
export type PassportStatus = z.infer<typeof PassportStatus>;

/** Double-entry ledger accounts (ADR-0004). See docs/architecture/r1-implementation.md for postings. */
export const LEDGER_ACCOUNTS = [
    'CASH', // money held by the platform at the payment processor
    'SHOP_PAYABLE', // owed to the manufacturing shop
    'PLATFORM_REVENUE', // platform margin / fee
    'SHIPPING_PAYABLE', // collected shipping, owed to carrier / label account
    'TAX_PAYABLE', // collected sales tax (0 in R1)
    'PROCESSOR_FEES', // payment processor fees (expense)
    'PAYOUTS_IN_TRANSIT', // shop payout created, transfer not yet settled
    'REFUNDS', // contra-revenue for refunds
] as const;
export const LedgerAccount = z.enum(LEDGER_ACCOUNTS);
export type LedgerAccount = z.infer<typeof LedgerAccount>;

export const LEDGER_DIRECTIONS = ['DEBIT', 'CREDIT'] as const;
export const LedgerDirection = z.enum(LEDGER_DIRECTIONS);
export type LedgerDirection = z.infer<typeof LedgerDirection>;

export const PAYOUT_STATUSES = ['PENDING', 'PAID', 'FAILED', 'CANCELLED'] as const;
export const PayoutStatus = z.enum(PAYOUT_STATUSES);
export type PayoutStatus = z.infer<typeof PayoutStatus>;

export const SHOP_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED'] as const;
export const ShopStatus = z.enum(SHOP_STATUSES);
export type ShopStatus = z.infer<typeof ShopStatus>;

export const MATERIAL_CATEGORIES = ['METAL', 'PLASTIC', 'WOOD'] as const;
export const MaterialCategory = z.enum(MATERIAL_CATEGORIES);
export type MaterialCategory = z.infer<typeof MaterialCategory>;

export const PRICE_BASES = ['PER_KG', 'PER_SHEET'] as const;
export const PriceBasis = z.enum(PRICE_BASES);
export type PriceBasis = z.infer<typeof PriceBasis>;

export const PROCESS_KINDS = ['FIBER_LASER', 'CO2_LASER', 'PRESS_BRAKE'] as const;
export const ProcessKind = z.enum(PROCESS_KINDS);
export type ProcessKind = z.infer<typeof ProcessKind>;

export const SERVICE_KINDS = ['SECONDARY_OP', 'FINISH'] as const;
export const ServiceKind = z.enum(SERVICE_KINDS);
export type ServiceKind = z.infer<typeof ServiceKind>;

export const SERVICE_PRICING_UNITS = ['PER_FEATURE', 'PER_PART', 'PER_AREA_FT2'] as const;
export const ServicePricingUnit = z.enum(SERVICE_PRICING_UNITS);
export type ServicePricingUnit = z.infer<typeof ServicePricingUnit>;

export const DFM_SEVERITIES = ['BLOCKING', 'WARNING'] as const;
export const DfmSeverity = z.enum(DFM_SEVERITIES);
export type DfmSeverity = z.infer<typeof DfmSeverity>;

export const ACTOR_KINDS = ['system', 'buyer', 'shop', 'admin', 'carrier', 'payment_provider'] as const;
export const ActorKind = z.enum(ACTOR_KINDS);
export type ActorKind = z.infer<typeof ActorKind>;
