/**
 * DiscoverMake R1 database schema (Drizzle ORM, Postgres 16).
 *
 * Conventions:
 * - snake_case tables/columns; text ids with readable prefixes (see src/server/ids.ts).
 * - Money: integer cents + `currency`. Physical coefficients: double precision.
 * - Timestamps: timestamptz. Calendar dates: `date` (string mode, YYYY-MM-DD).
 * - Enum values come from src/contracts/enums.ts (single source of truth).
 * - jsonb columns are typed with the contract types they store.
 *
 * Use relative imports only in this file: drizzle-kit loads it outside Next/bun.
 */
import { sql } from 'drizzle-orm';
import {
    type AnyPgColumn,
    boolean,
    check,
    date,
    doublePrecision,
    index,
    integer,
    jsonb,
    pgEnum,
    pgSequence,
    pgTable,
    primaryKey,
    text,
    timestamp,
    uniqueIndex,
    uuid,
} from 'drizzle-orm/pg-core';
import {
    APPROVAL_KINDS,
    APPROVAL_STATUSES,
    APPROVER_ROLES,
    BG_EDGE_TYPES,
    BG_NODE_TYPES,
    BG_SOURCES,
    BUILD_ORIGINS,
    BUILD_STATUSES,
    DESIGN_VERSION_STATUSES,
    INCOTERMS,
    NEGOTIATION_STATUSES,
    PACKAGE_TIERS,
    SOURCING_CHANNELS,
    SOURCING_DOCUMENT_KINDS,
    SOURCING_JOB_STATUSES,
    SUPPLIER_OFFER_STATUSES,
    CARRIER_PROVIDERS,
    DECLINE_REASONS,
    INSPECTION_OUTCOMES,
    JOB_STATUSES,
    LEDGER_ACCOUNTS,
    LEDGER_DIRECTIONS,
    MATERIAL_CATEGORIES,
    MILESTONE_KINDS,
    ORDER_STATUSES,
    ORDER_TYPES,
    PART_STATUSES,
    PART_UNITS,
    PASSPORT_STATUSES,
    PAYMENT_PROVIDERS,
    PAYMENT_STATUSES,
    PAYOUT_STATUSES,
    PRICE_BASES,
    PROCESS_KINDS,
    QUOTE_STATUSES,
    QUOTE_TIERS,
    SERVICE_KINDS,
    SERVICE_PRICING_UNITS,
    SHIPMENT_STATUSES,
    SHIPPING_METHODS,
    SHOP_STATUSES,
    TRUST_LEVELS,
    CREDIT_STATUSES,
    PAYMENT_PLAN_KINDS,
    PROMISE_LEGS,
    PROMISE_STATUSES,
    SHOP_STOCK_KINDS,
    SUPPLIER_LEG_STATUSES,
} from '../../contracts/enums';
import type { Address } from '../../contracts/common';
import type { DfmResult, PartFeatures, PartPreview } from '../../contracts/parts';
import type { QuoteConfig, QuoteConfigSummary, QuoteLadderRung, QuoteLineItem, ShippingOption } from '../../contracts/quotes';
import type { InspectionCheck, InspectionMeasurement, JobPacket } from '../../contracts/shop';
import type { Parcel, TrackingEvent } from '../../contracts/shipments';
import type { PassportSnapshot } from '../../contracts/passport';
import type { CreationIntent } from '../../contracts/make-ai';
import type { ApprovalPolicy, SourcingRequest, SubmitOfferInput, SupplierEvidenceInput } from '../../contracts/sourcing';
import type { InterestSlug, OnboardingIntent, UserRole } from '../../contracts/account';
import type { PromiseLegPrediction, SupplierQuoteComposition } from '../../contracts/promise';
import { CHANNEL_KINDS, DROP_STATUSES, SHOW_FORMATS, SHOW_STATUSES, SLOT_CLAIM_STATUSES } from '../../contracts/live';
import type { ChannelCategory, LiveActorKind, LiveEventType } from '../../contracts/live';
import { newId } from '../ids';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const buildStatusEnum = pgEnum('build_status', BUILD_STATUSES);
export const partStatusEnum = pgEnum('part_status', PART_STATUSES);
export const partUnitsEnum = pgEnum('part_units', PART_UNITS);
export const materialCategoryEnum = pgEnum('material_category', MATERIAL_CATEGORIES);
export const priceBasisEnum = pgEnum('price_basis', PRICE_BASES);
export const processKindEnum = pgEnum('process_kind', PROCESS_KINDS);
export const serviceKindEnum = pgEnum('service_kind', SERVICE_KINDS);
export const servicePricingUnitEnum = pgEnum('service_pricing_unit', SERVICE_PRICING_UNITS);
export const shopStatusEnum = pgEnum('shop_status', SHOP_STATUSES);
export const quoteStatusEnum = pgEnum('quote_status', QUOTE_STATUSES);
export const quoteTierEnum = pgEnum('quote_tier', QUOTE_TIERS);
export const trustLevelEnum = pgEnum('trust_level', TRUST_LEVELS);
export const orderTypeEnum = pgEnum('order_type', ORDER_TYPES);
export const orderStatusEnum = pgEnum('order_status', ORDER_STATUSES);
export const shippingMethodEnum = pgEnum('shipping_method', SHIPPING_METHODS);
export const paymentProviderEnum = pgEnum('payment_provider', PAYMENT_PROVIDERS);
export const paymentStatusEnum = pgEnum('payment_status', PAYMENT_STATUSES);
export const jobStatusEnum = pgEnum('job_status', JOB_STATUSES);
export const declineReasonEnum = pgEnum('decline_reason', DECLINE_REASONS);
export const milestoneKindEnum = pgEnum('milestone_kind', MILESTONE_KINDS);
export const inspectionOutcomeEnum = pgEnum('inspection_outcome', INSPECTION_OUTCOMES);
export const shipmentStatusEnum = pgEnum('shipment_status', SHIPMENT_STATUSES);
export const carrierProviderEnum = pgEnum('carrier_provider', CARRIER_PROVIDERS);
export const passportStatusEnum = pgEnum('passport_status', PASSPORT_STATUSES);
export const ledgerAccountEnum = pgEnum('ledger_account', LEDGER_ACCOUNTS);
export const ledgerDirectionEnum = pgEnum('ledger_direction', LEDGER_DIRECTIONS);
export const payoutStatusEnum = pgEnum('payout_status', PAYOUT_STATUSES);
export const buildOriginEnum = pgEnum('build_origin', BUILD_ORIGINS);
export const designVersionStatusEnum = pgEnum('design_version_status', DESIGN_VERSION_STATUSES);
export const bgNodeTypeEnum = pgEnum('bg_node_type', BG_NODE_TYPES);
export const bgEdgeTypeEnum = pgEnum('bg_edge_type', BG_EDGE_TYPES);
export const bgSourceEnum = pgEnum('bg_source', BG_SOURCES);
export const sourcingJobStatusEnum = pgEnum('sourcing_job_status', SOURCING_JOB_STATUSES);
export const sourcingChannelEnum = pgEnum('sourcing_channel', SOURCING_CHANNELS);
export const negotiationStatusEnum = pgEnum('negotiation_status', NEGOTIATION_STATUSES);
export const supplierOfferStatusEnum = pgEnum('supplier_offer_status', SUPPLIER_OFFER_STATUSES);
export const approvalKindEnum = pgEnum('approval_kind', APPROVAL_KINDS);
export const approvalStatusEnum = pgEnum('approval_status', APPROVAL_STATUSES);
export const approverRoleEnum = pgEnum('approver_role', APPROVER_ROLES);
export const sourcingDocumentKindEnum = pgEnum('sourcing_document_kind', SOURCING_DOCUMENT_KINDS);
export const packageTierEnum = pgEnum('package_tier', PACKAGE_TIERS);
export const incotermEnum = pgEnum('incoterm', INCOTERMS);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => tstz('created_at').notNull().defaultNow();
const updatedAt = () =>
    tstz('updated_at')
        .notNull()
        .defaultNow()
        .$onUpdate(() => new Date());
const cents = (name: string) => integer(name);

// ---------------------------------------------------------------------------
// Builds + parts
// ---------------------------------------------------------------------------

/**
 * One persistent Build per creation (ADR-0001). R1 upload builds have one part and
 * no graph rows; R2 Make AI / remix / clone builds carry a Build Graph per design
 * version (`design_versions`, `bg_nodes`, `bg_edges`).
 */
export const builds = pgTable(
    'builds',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('build')),
        displayId: text('display_id').notNull(),
        name: text('name').notNull(),
        status: buildStatusEnum('status').notNull().default('DRAFT'),
        ownerEmail: text('owner_email'),
        origin: buildOriginEnum('origin').notNull().default('upload'),
        /** Latest design version number (graph builds). Upload builds track `parts.design_version`. */
        currentVersion: integer('current_version').notNull().default(1),
        derivedFromBuildId: text('derived_from_build_id'),
        /** Make AI intent that started this build (origin = make_ai). */
        intentId: text('intent_id'),
        /** R2 accounts (ADR-0009): the signed-in owner. Null for guest and legacy R1 builds. */
        ownerUserId: text('owner_user_id').references((): AnyPgColumn => users.id),
        /** R2 accounts: sha256 of the `dm_device` cookie that created the build (guest ownership). */
        deviceHash: text('device_hash'),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [
        uniqueIndex('builds_display_id_uq').on(t.displayId),
        index('builds_derived_from_idx').on(t.derivedFromBuildId),
        index('builds_owner_user_idx').on(t.ownerUserId, t.updatedAt),
        index('builds_device_hash_idx').on(t.deviceHash),
    ],
);

export const parts = pgTable(
    'parts',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('part')),
        buildId: text('build_id')
            .notNull()
            .references(() => builds.id, { onDelete: 'cascade' }),
        designVersion: integer('design_version').notNull().default(1),
        /** Storage key of the source file, e.g. `parts/prt_x/source.dxf`. */
        fileKey: text('file_key').notNull(),
        filename: text('filename').notNull(),
        format: text('format').notNull().default('dxf'),
        sizeBytes: integer('size_bytes').notNull(),
        /** sha256 of the verified bytes; null until the upload is verified at analyze time. */
        fileSha256: text('file_sha256'),
        units: partUnitsEnum('units'),
        status: partStatusEnum('status').notNull().default('AWAITING_UPLOAD'),
        features: jsonb('features').$type<PartFeatures>(),
        dfm: jsonb('dfm').$type<DfmResult>(),
        preview: jsonb('preview').$type<PartPreview>(),
        rulesetVersion: text('ruleset_version'),
        error: text('error'),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
        analyzedAt: tstz('analyzed_at'),
    },
    (t) => [index('parts_build_id_idx').on(t.buildId)],
);

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export const processes = pgTable('processes', {
    id: text('id').primaryKey().$defaultFn(() => newId('process')),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    kind: processKindEnum('kind').notNull(),
    description: text('description').notNull().default(''),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
});

export const materials = pgTable('materials', {
    id: text('id').primaryKey().$defaultFn(() => newId('material')),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    category: materialCategoryEnum('category').notNull(),
    description: text('description').notNull().default(''),
    swatchHex: text('swatch_hex').notNull().default('#9aa0a6'),
    densityKgM3: doublePrecision('density_kg_m3').notNull(),
    priceBasis: priceBasisEnum('price_basis').notNull(),
    /** PER_KG basis: material cost per kg in cents. */
    priceCentsPerKg: cents('price_cents_per_kg'),
    /** PER_SHEET basis: stock sheet size (price per sheet lives on thickness_options). */
    sheetWidthMm: doublePrecision('sheet_width_mm'),
    sheetHeightMm: doublePrecision('sheet_height_mm'),
    /** Material scrap allowance on nested area, e.g. 0.15 = 15%. */
    scrapPct: doublePrecision('scrap_pct').notNull().default(0.15),
    /** DFM ratios, multiplied by thickness: min hole Ø, min web/feature, hole-to-edge. */
    minHoleRatio: doublePrecision('min_hole_ratio').notNull(),
    minFeatureRatio: doublePrecision('min_feature_ratio').notNull(),
    holeToEdgeRatio: doublePrecision('hole_to_edge_ratio').notNull(),
    /** Absolute floors in mm (thin stock): DFM uses max(ratio x t, floor). */
    minHoleFloorMm: doublePrecision('min_hole_floor_mm').notNull().default(0.5),
    minFeatureFloorMm: doublePrecision('min_feature_floor_mm').notNull().default(0.5),
    /** false = coefficients are documented defaults that still need calibration against invoices. */
    calibrated: boolean('calibrated').notNull().default(false),
    active: boolean('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
});

export const thicknessOptions = pgTable(
    'thickness_options',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('thickness')),
        materialId: text('material_id')
            .notNull()
            .references(() => materials.id, { onDelete: 'cascade' }),
        processId: text('process_id')
            .notNull()
            .references(() => processes.id),
        thicknessMm: doublePrecision('thickness_mm').notNull(),
        label: text('label').notNull(),
        gaugeLabel: text('gauge_label'),
        /** Laser cutting feed rate at this thickness (mm/min). */
        feedRateMmPerMin: doublePrecision('feed_rate_mm_per_min').notNull(),
        /** Seconds per pierce. */
        pierceTimeS: doublePrecision('pierce_time_s').notNull(),
        kerfMm: doublePrecision('kerf_mm').notNull(),
        /** Sheet-metal K-factor for flat-pattern / bend allowance. */
        kFactor: doublePrecision('k_factor').notNull().default(0.44),
        bendable: boolean('bendable').notNull().default(false),
        minBendRadiusMm: doublePrecision('min_bend_radius_mm'),
        /** Min flange length = ratio x thickness (tooling dependent). */
        minFlangeRatio: doublePrecision('min_flange_ratio').notNull().default(4),
        /** PER_SHEET materials: price of one stock sheet in cents. */
        sheetPriceCents: cents('sheet_price_cents'),
        maxPartWidthMm: doublePrecision('max_part_width_mm').notNull(),
        maxPartHeightMm: doublePrecision('max_part_height_mm').notNull(),
        calibrated: boolean('calibrated').notNull().default(false),
        active: boolean('active').notNull().default(true),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [
        index('thickness_options_material_idx').on(t.materialId),
        uniqueIndex('thickness_options_material_thickness_uq').on(t.materialId, t.thicknessMm),
    ],
);

/** Secondary operations and finishes. Platform default prices; shop rate cards may override. */
export const services = pgTable('services', {
    id: text('id').primaryKey().$defaultFn(() => newId('service')),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    kind: serviceKindEnum('kind').notNull(),
    pricingUnit: servicePricingUnitEnum('pricing_unit').notNull(),
    description: text('description').notNull().default(''),
    /** Default price per unit (feature / part / ft²) in cents. */
    unitPriceCents: cents('unit_price_cents').notNull(),
    /** One-time setup per order line (e.g. powder coat batch), in cents. */
    batchSetupCents: cents('batch_setup_cents').notNull().default(0),
    /** Minimum charge per order line in cents. */
    minimumCents: cents('minimum_cents').notNull().default(0),
    colorName: text('color_name'),
    colorHex: text('color_hex'),
    requiresFeatureCount: boolean('requires_feature_count').notNull().default(false),
    /** Material categories this service applies to. */
    compatibleCategories: jsonb('compatible_categories').$type<string[]>().notNull().default([]),
    /** Optional explicit material slugs (overrides categories when non-empty). */
    compatibleMaterialSlugs: jsonb('compatible_material_slugs').$type<string[]>().notNull().default([]),
    options: jsonb('options').$type<Record<string, unknown>>().notNull().default({}),
    leadTimeDaysAdded: integer('lead_time_days_added').notNull().default(0),
    calibrated: boolean('calibrated').notNull().default(false),
    active: boolean('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
});

/**
 * Versioned DFM rule sets ("rules are data, not code branches").
 * `rules` holds thresholds/weights; every quote stores the version it ran against.
 */
export const dfmRulesets = pgTable('dfm_rulesets', {
    version: text('version').primaryKey(),
    rules: jsonb('rules').$type<Record<string, unknown>>().notNull(),
    active: boolean('active').notNull().default(false),
    notes: text('notes'),
    createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Shops
// ---------------------------------------------------------------------------

export const shops = pgTable('shops', {
    id: text('id').primaryKey().$defaultFn(() => newId('shop')),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    legalName: text('legal_name'),
    status: shopStatusEnum('status').notNull().default('PENDING'),
    contactEmail: text('contact_email').notNull(),
    phone: text('phone'),
    /** Ship-from address (labels, transit estimates). */
    address: jsonb('address').$type<Address>().notNull(),
    city: text('city').notNull(),
    region: text('region').notNull(),
    country: text('country').notNull().default('US'),
    timezone: text('timezone').notNull().default('America/New_York'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    rating: doublePrecision('rating'),
    ratingCount: integer('rating_count').notNull().default(0),
    /** Current queue wait in business days (feeds lead time; capacity calendar in R2). */
    queueDays: integer('queue_days').notNull().default(2),
    /** Offer acceptance window in minutes (workflow 05: 2 business hours). */
    acceptWindowMinutes: integer('accept_window_minutes').notNull().default(120),
    /** Adapter level: L0 email, L1 Shop Console, L2 API, L3 telemetry. */
    adapterLevel: text('adapter_level').notNull().default('L1'),
    certifications: jsonb('certifications').$type<string[]>().notNull().default([]),
    stripeAccountId: text('stripe_account_id'),
    /**
     * Stripe reports payouts_enabled on the Connect account (account.updated webhook or a
     * live status read). The ledger only routes payouts to Connect when this is true, so a
     * shop that started but did not finish onboarding keeps being paid manually.
     */
    stripePayoutsEnabled: boolean('stripe_payouts_enabled').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
});

export const shopCapabilities = pgTable(
    'shop_capabilities',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('capability')),
        shopId: text('shop_id')
            .notNull()
            .references(() => shops.id, { onDelete: 'cascade' }),
        materialId: text('material_id')
            .notNull()
            .references(() => materials.id),
        thicknessOptionId: text('thickness_option_id')
            .notNull()
            .references(() => thicknessOptions.id),
        processId: text('process_id')
            .notNull()
            .references(() => processes.id),
        /** Machine bed (mm). */
        bedWidthMm: doublePrecision('bed_width_mm').notNull(),
        bedHeightMm: doublePrecision('bed_height_mm').notNull(),
        /** Press brake only. */
        maxBendLengthMm: doublePrecision('max_bend_length_mm'),
        machineLabel: text('machine_label'),
        active: boolean('active').notNull().default(true),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [
        uniqueIndex('shop_capabilities_uq').on(t.shopId, t.thicknessOptionId, t.processId),
        index('shop_capabilities_lookup_idx').on(t.thicknessOptionId, t.processId),
    ],
);

/**
 * Secondary operations and finishes a shop can perform (bending, tapping, PEM,
 * powder coat colours, anodize...). Quote routing and dispatch only consider a
 * shop when it offers EVERY service the configuration selects. Bending also
 * needs a press-brake row in `shop_capabilities` for the thickness.
 */
export const shopServices = pgTable(
    'shop_services',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('shopService')),
        shopId: text('shop_id')
            .notNull()
            .references(() => shops.id, { onDelete: 'cascade' }),
        serviceId: text('service_id')
            .notNull()
            .references(() => services.id),
        active: boolean('active').notNull().default(true),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [uniqueIndex('shop_services_uq').on(t.shopId, t.serviceId), index('shop_services_service_idx').on(t.serviceId)],
);

/**
 * Per-shop pricing coefficients (workflow 02 pricing model). Exactly one active
 * card per shop. Quotes reference the card they were priced with.
 */
export const shopRateCards = pgTable(
    'shop_rate_cards',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('rateCard')),
        shopId: text('shop_id')
            .notNull()
            .references(() => shops.id, { onDelete: 'cascade' }),
        version: integer('version').notNull().default(1),
        active: boolean('active').notNull().default(true),
        currency: text('currency').notNull().default('usd'),
        fiberLaserCentsPerHour: cents('fiber_laser_cents_per_hour').notNull(),
        co2LaserCentsPerHour: cents('co2_laser_cents_per_hour').notNull(),
        brakeCentsPerBend: cents('brake_cents_per_bend').notNull(),
        brakeSetupCents: cents('brake_setup_cents').notNull(),
        /** Per order line setup (programming, sheet loading). */
        orderSetupCents: cents('order_setup_cents').notNull(),
        partHandlingCents: cents('part_handling_cents').notNull(),
        /** Default finishing $/ft² when a service has no shop override. */
        finishingCentsPerFt2: cents('finishing_cents_per_ft2').notNull(),
        finishBatchSetupCents: cents('finish_batch_setup_cents').notNull(),
        qaCentsPerPart: cents('qa_cents_per_part').notNull().default(0),
        packagingBaseCents: cents('packaging_base_cents').notNull(),
        /** Multiplier on material cost (shop buys stock), e.g. 1.10. */
        materialMarkup: doublePrecision('material_markup').notNull().default(1.0),
        /** Platform margin applied on top of shop cost, e.g. 0.30 = 30%. */
        platformMarginPct: doublePrecision('platform_margin_pct').notNull(),
        /** Floor for the order subtotal in cents. */
        minimumOrderCents: cents('minimum_order_cents').notNull(),
        /** Volume coefficient for the quantity curve: unit cost x (1 - volumeDiscountMax x f(qty)). */
        volumeDiscountMax: doublePrecision('volume_discount_max').notNull().default(0.2),
        /** Per-service overrides: { [serviceSlug]: unitPriceCents }. */
        serviceOverrides: jsonb('service_overrides').$type<Record<string, number>>().notNull().default({}),
        calibrated: boolean('calibrated').notNull().default(false),
        notes: text('notes'),
        effectiveFrom: tstz('effective_from').notNull().defaultNow(),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [
        uniqueIndex('shop_rate_cards_version_uq').on(t.shopId, t.version),
        uniqueIndex('shop_rate_cards_one_active_uq')
            .on(t.shopId)
            .where(sql`${t.active} = true`),
    ],
);

/** Shop Console login tokens. Only the sha256 hex of the token is stored. */
export const shopAccessTokens = pgTable(
    'shop_access_tokens',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('shopToken')),
        shopId: text('shop_id')
            .notNull()
            .references(() => shops.id, { onDelete: 'cascade' }),
        tokenHash: text('token_hash').notNull(),
        label: text('label').notNull(),
        lastUsedAt: tstz('last_used_at'),
        expiresAt: tstz('expires_at'),
        revokedAt: tstz('revoked_at'),
        createdAt: createdAt(),
    },
    (t) => [uniqueIndex('shop_access_tokens_hash_uq').on(t.tokenHash), uniqueIndex('shop_access_tokens_label_uq').on(t.shopId, t.label)],
);

/** Shop Console sessions behind the httpOnly cookie. Cookie holds a random secret; we store its sha256. */
export const shopSessions = pgTable(
    'shop_sessions',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('shopSession')),
        shopId: text('shop_id')
            .notNull()
            .references(() => shops.id, { onDelete: 'cascade' }),
        tokenId: text('token_id')
            .notNull()
            .references(() => shopAccessTokens.id, { onDelete: 'cascade' }),
        sessionHash: text('session_hash').notNull(),
        expiresAt: tstz('expires_at').notNull(),
        revokedAt: tstz('revoked_at'),
        lastSeenAt: tstz('last_seen_at'),
        createdAt: createdAt(),
    },
    (t) => [uniqueIndex('shop_sessions_hash_uq').on(t.sessionHash)],
);

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

/** Immutable priced snapshot. Only `status` may change after insert (READY -> EXPIRED/ORDERED). */
export const quotes = pgTable(
    'quotes',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('quote')),
        partId: text('part_id')
            .notNull()
            .references(() => parts.id),
        buildId: text('build_id')
            .notNull()
            .references(() => builds.id),
        designVersion: integer('design_version').notNull(),
        shopId: text('shop_id')
            .notNull()
            .references(() => shops.id),
        rateCardId: text('rate_card_id')
            .notNull()
            .references(() => shopRateCards.id),
        config: jsonb('config').$type<QuoteConfig>().notNull(),
        summary: jsonb('summary').$type<QuoteConfigSummary>().notNull(),
        quantity: integer('quantity').notNull(),
        tier: quoteTierEnum('tier').notNull(),
        lineItems: jsonb('line_items').$type<QuoteLineItem[]>().notNull(),
        ladder: jsonb('ladder').$type<QuoteLadderRung[]>().notNull(),
        shippingOptions: jsonb('shipping_options').$type<ShippingOption[]>().notNull(),
        dfm: jsonb('dfm').$type<DfmResult>().notNull(),
        unitPriceCents: cents('unit_price_cents').notNull(),
        subtotalCents: cents('subtotal_cents').notNull(),
        /** Internal split (never shown to buyers): what the shop is paid vs. platform margin. */
        shopCostCents: cents('shop_cost_cents').notNull(),
        platformFeeCents: cents('platform_fee_cents').notNull(),
        currency: text('currency').notNull().default('usd'),
        trustLevel: trustLevelEnum('trust_level').notNull(),
        status: quoteStatusEnum('status').notNull(),
        shipDate: date('ship_date', { mode: 'string' }).notNull(),
        leadTimeDays: integer('lead_time_days').notNull(),
        validUntil: tstz('valid_until').notNull(),
        rulesetVersion: text('ruleset_version').notNull(),
        pricingVersion: text('pricing_version').notNull(),
        makeabilityScore: integer('makeability_score').notNull(),
        createdAt: createdAt(),
    },
    (t) => [
        index('quotes_part_idx').on(t.partId),
        index('quotes_build_idx').on(t.buildId),
        check('quotes_split_ck', sql`${t.shopCostCents} + ${t.platformFeeCents} = ${t.subtotalCents}`),
    ],
);

// ---------------------------------------------------------------------------
// Orders + payments
// ---------------------------------------------------------------------------

export const orders = pgTable(
    'orders',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('order')),
        orderNumber: text('order_number').notNull(),
        buildId: text('build_id')
            .notNull()
            .references(() => builds.id),
        quoteId: text('quote_id')
            .notNull()
            .references(() => quotes.id),
        orderType: orderTypeEnum('order_type').notNull(),
        status: orderStatusEnum('status').notNull().default('PENDING_PAYMENT'),
        buyerEmail: text('buyer_email').notNull(),
        buyerName: text('buyer_name').notNull(),
        buyerPhone: text('buyer_phone'),
        shippingAddress: jsonb('shipping_address').$type<Address>().notNull(),
        shippingMethod: shippingMethodEnum('shipping_method').notNull(),
        notes: text('notes'),
        quantity: integer('quantity').notNull(),
        unitPriceCents: cents('unit_price_cents').notNull(),
        subtotalCents: cents('subtotal_cents').notNull(),
        shippingCents: cents('shipping_cents').notNull(),
        taxCents: cents('tax_cents').notNull().default(0),
        totalCents: cents('total_cents').notNull(),
        shopCostCents: cents('shop_cost_cents').notNull(),
        platformFeeCents: cents('platform_fee_cents').notNull(),
        currency: text('currency').notNull().default('usd'),
        promisedShipDate: date('promised_ship_date', { mode: 'string' }).notNull(),
        /** Assigned shop once a job is accepted. */
        shopId: text('shop_id').references(() => shops.id),
        /** R2 accounts: the signed-in buyer (set at checkout, or when a sign-in claims the order by verified email). */
        buyerUserId: text('buyer_user_id').references((): AnyPgColumn => users.id),
        /** HMAC-SHA256(ORDER_LINK_SECRET, buyer token), hex. See src/server/auth/order-link.ts. */
        accessTokenHash: text('access_token_hash').notNull(),
        /** Journey id for domain events (ADR-0002 correlation_id). */
        correlationId: text('correlation_id').notNull(),
        termsAcceptedAt: tstz('terms_accepted_at').notNull(),
        cancelReason: text('cancel_reason'),
        paidAt: tstz('paid_at'),
        shippedAt: tstz('shipped_at'),
        deliveredAt: tstz('delivered_at'),
        completedAt: tstz('completed_at'),
        /** Optimistic concurrency counter, incremented on every status change. */
        version: integer('version').notNull().default(1),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [
        uniqueIndex('orders_order_number_uq').on(t.orderNumber),
        index('orders_status_idx').on(t.status),
        index('orders_buyer_email_idx').on(t.buyerEmail),
        index('orders_build_idx').on(t.buildId),
        index('orders_buyer_user_idx').on(t.buyerUserId),
        check('orders_total_ck', sql`${t.totalCents} = ${t.subtotalCents} + ${t.shippingCents} + ${t.taxCents}`),
    ],
);

export const orderStatusHistory = pgTable(
    'order_status_history',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('orderStatus')),
        orderId: text('order_id')
            .notNull()
            .references(() => orders.id, { onDelete: 'cascade' }),
        fromStatus: orderStatusEnum('from_status'),
        toStatus: orderStatusEnum('to_status').notNull(),
        actorId: text('actor_id').notNull(),
        reason: text('reason'),
        meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
        eventId: uuid('event_id'),
        createdAt: createdAt(),
    },
    (t) => [index('order_status_history_order_idx').on(t.orderId, t.createdAt)],
);

export const payments = pgTable(
    'payments',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('payment')),
        orderId: text('order_id')
            .notNull()
            .references(() => orders.id),
        provider: paymentProviderEnum('provider').notNull(),
        /** Stripe Checkout Session id (cs_...) or dev session id. */
        providerRef: text('provider_ref').notNull(),
        /** Stripe PaymentIntent id once known (pi_...), for refunds. */
        providerPaymentId: text('provider_payment_id'),
        amountCents: cents('amount_cents').notNull(),
        currency: text('currency').notNull().default('usd'),
        status: paymentStatusEnum('status').notNull().default('PENDING'),
        failureReason: text('failure_reason'),
        refundedCents: cents('refunded_cents').notNull().default(0),
        metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
        succeededAt: tstz('succeeded_at'),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [uniqueIndex('payments_provider_ref_uq').on(t.provider, t.providerRef), index('payments_order_idx').on(t.orderId)],
);

// ---------------------------------------------------------------------------
// Manufacturing
// ---------------------------------------------------------------------------

export const manufacturingJobs = pgTable(
    'manufacturing_jobs',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('job')),
        orderId: text('order_id')
            .notNull()
            .references(() => orders.id),
        shopId: text('shop_id')
            .notNull()
            .references(() => shops.id),
        buildId: text('build_id')
            .notNull()
            .references(() => builds.id),
        partId: text('part_id')
            .notNull()
            .references(() => parts.id),
        quoteId: text('quote_id')
            .notNull()
            .references(() => quotes.id),
        status: jobStatusEnum('status').notNull().default('OFFERED'),
        /** Signed job packet (full, incl. shipTo; files are signed per request, not stored). */
        packet: jsonb('packet').$type<Omit<JobPacket, 'files'>>().notNull(),
        packetSignature: text('packet_signature').notNull(),
        /**
         * Immutable snapshot of the exact file the quote was priced on, taken at dispatch.
         * The shop's download URL and the passport file hash come from here, never from the
         * live `parts` row. Null only on jobs created before migration 0001.
         */
        sourceFileKey: text('source_file_key'),
        sourceFileSha256: text('source_file_sha256'),
        /** Set on rework jobs opened after a QA failure. */
        reworkOfJobId: text('rework_of_job_id'),
        /** Dispatch attempt number for this order (1 = first offer). */
        attempt: integer('attempt').notNull().default(1),
        payoutCents: cents('payout_cents').notNull(),
        offeredAt: tstz('offered_at').notNull().defaultNow(),
        offerExpiresAt: tstz('offer_expires_at'),
        acceptedAt: tstz('accepted_at'),
        declinedAt: tstz('declined_at'),
        declineReason: declineReasonEnum('decline_reason'),
        declineNote: text('decline_note'),
        startedAt: tstz('started_at'),
        qaPassedAt: tstz('qa_passed_at'),
        shippedAt: tstz('shipped_at'),
        completedAt: tstz('completed_at'),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [
        index('manufacturing_jobs_order_idx').on(t.orderId),
        index('manufacturing_jobs_shop_status_idx').on(t.shopId, t.status),
    ],
);

export const productionMilestones = pgTable(
    'production_milestones',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('milestone')),
        jobId: text('job_id')
            .notNull()
            .references(() => manufacturingJobs.id),
        orderId: text('order_id')
            .notNull()
            .references(() => orders.id),
        kind: milestoneKindEnum('kind').notNull(),
        note: text('note'),
        photoKeys: jsonb('photo_keys').$type<string[]>().notNull().default([]),
        actorId: text('actor_id').notNull(),
        occurredAt: tstz('occurred_at').notNull().defaultNow(),
        createdAt: createdAt(),
    },
    (t) => [index('production_milestones_job_idx').on(t.jobId, t.occurredAt), index('production_milestones_order_idx').on(t.orderId)],
);

export const inspectionPlans = pgTable(
    'inspection_plans',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('inspectionPlan')),
        jobId: text('job_id')
            .notNull()
            .references(() => manufacturingJobs.id),
        orderId: text('order_id')
            .notNull()
            .references(() => orders.id),
        partId: text('part_id')
            .notNull()
            .references(() => parts.id),
        checks: jsonb('checks').$type<InspectionCheck[]>().notNull(),
        sampleSize: integer('sample_size').notNull().default(1),
        rulesetVersion: text('ruleset_version').notNull(),
        createdAt: createdAt(),
    },
    (t) => [uniqueIndex('inspection_plans_job_uq').on(t.jobId)],
);

export const inspectionResults = pgTable(
    'inspection_results',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('inspectionResult')),
        planId: text('plan_id')
            .notNull()
            .references(() => inspectionPlans.id),
        jobId: text('job_id')
            .notNull()
            .references(() => manufacturingJobs.id),
        orderId: text('order_id')
            .notNull()
            .references(() => orders.id),
        outcome: inspectionOutcomeEnum('outcome').notNull(),
        measurements: jsonb('measurements').$type<InspectionMeasurement[]>().notNull(),
        photoKeys: jsonb('photo_keys').$type<string[]>().notNull().default([]),
        inspectorName: text('inspector_name').notNull(),
        notes: text('notes'),
        reworkJobId: text('rework_job_id'),
        actorId: text('actor_id').notNull(),
        createdAt: createdAt(),
    },
    (t) => [index('inspection_results_job_idx').on(t.jobId), index('inspection_results_order_idx').on(t.orderId)],
);

// ---------------------------------------------------------------------------
// Shipping
// ---------------------------------------------------------------------------

export const shipments = pgTable(
    'shipments',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('shipment')),
        orderId: text('order_id')
            .notNull()
            .references(() => orders.id),
        jobId: text('job_id')
            .notNull()
            .references(() => manufacturingJobs.id),
        provider: carrierProviderEnum('provider').notNull(),
        /** EasyPost shipment id (shp_... on their side); null for manual. */
        providerShipmentId: text('provider_shipment_id'),
        carrier: text('carrier').notNull(),
        service: text('service').notNull(),
        trackingNumber: text('tracking_number').notNull(),
        trackingUrl: text('tracking_url'),
        /** Storage key or provider URL of the label. */
        labelKey: text('label_key'),
        labelUrl: text('label_url'),
        rateCents: cents('rate_cents'),
        status: shipmentStatusEnum('status').notNull().default('LABEL_CREATED'),
        events: jsonb('events').$type<TrackingEvent[]>().notNull().default([]),
        parcel: jsonb('parcel').$type<Parcel>().notNull(),
        fromAddress: jsonb('from_address').$type<Address>().notNull(),
        toAddress: jsonb('to_address').$type<Address>().notNull(),
        estimatedDeliveryDate: date('estimated_delivery_date', { mode: 'string' }),
        shippedAt: tstz('shipped_at'),
        deliveredAt: tstz('delivered_at'),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [
        index('shipments_order_idx').on(t.orderId),
        uniqueIndex('shipments_provider_shipment_uq').on(t.provider, t.providerShipmentId),
        index('shipments_tracking_idx').on(t.trackingNumber),
    ],
);

// ---------------------------------------------------------------------------
// Passport
// ---------------------------------------------------------------------------

export const passports = pgTable(
    'passports',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('passport')),
        orderId: text('order_id')
            .notNull()
            .references(() => orders.id),
        buildId: text('build_id')
            .notNull()
            .references(() => builds.id),
        status: passportStatusEnum('status').notNull().default('PENDING'),
        snapshot: jsonb('snapshot').$type<PassportSnapshot>().notNull(),
        snapshotHash: text('snapshot_hash').notNull(),
        signature: text('signature').notNull(),
        signatureAlg: text('signature_alg').notNull().default('HMAC-SHA256'),
        keyId: text('key_id').notNull().default('passport-v1'),
        activatedAt: tstz('activated_at'),
        createdAt: createdAt(),
    },
    (t) => [uniqueIndex('passports_order_uq').on(t.orderId)],
);

// ---------------------------------------------------------------------------
// Money: ledger + payouts
// ---------------------------------------------------------------------------

/**
 * Double-entry ledger. A balanced transaction is the set of rows sharing `txn_key`
 * (sum of DEBIT = sum of CREDIT). `(txn_key, line_no)` is unique, so re-recording
 * the same transaction with ON CONFLICT DO NOTHING is idempotent.
 */
export const ledgerEntries = pgTable(
    'ledger_entries',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('ledger')),
        txnKey: text('txn_key').notNull(),
        lineNo: integer('line_no').notNull(),
        account: ledgerAccountEnum('account').notNull(),
        direction: ledgerDirectionEnum('direction').notNull(),
        amountCents: cents('amount_cents').notNull(),
        currency: text('currency').notNull().default('usd'),
        orderId: text('order_id').references(() => orders.id),
        shopId: text('shop_id').references(() => shops.id),
        payoutId: text('payout_id'),
        memo: text('memo'),
        createdAt: createdAt(),
    },
    (t) => [
        uniqueIndex('ledger_entries_txn_line_uq').on(t.txnKey, t.lineNo),
        index('ledger_entries_order_idx').on(t.orderId),
        index('ledger_entries_account_idx').on(t.account),
        check('ledger_entries_amount_ck', sql`${t.amountCents} > 0`),
    ],
);

export const payouts = pgTable(
    'payouts',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('payout')),
        shopId: text('shop_id')
            .notNull()
            .references(() => shops.id),
        orderId: text('order_id')
            .notNull()
            .references(() => orders.id),
        jobId: text('job_id').references(() => manufacturingJobs.id),
        amountCents: cents('amount_cents').notNull(),
        currency: text('currency').notNull().default('usd'),
        status: payoutStatusEnum('status').notNull().default('PENDING'),
        /** 'stripe_connect' | 'manual' */
        method: text('method').notNull().default('manual'),
        providerRef: text('provider_ref'),
        paidAt: tstz('paid_at'),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [uniqueIndex('payouts_order_shop_uq').on(t.orderId, t.shopId)],
);

// ---------------------------------------------------------------------------
// Events + webhooks
// ---------------------------------------------------------------------------

/** Transactional outbox (ADR-0002). Written only via emitEvent(tx, ...). */
export const domainEvents = pgTable(
    'domain_events',
    {
        eventId: uuid('event_id').primaryKey(),
        eventType: text('event_type').notNull(),
        buildId: text('build_id'),
        /** Denormalized for the buyer timeline query; null for non-order events. */
        orderId: text('order_id'),
        actorId: text('actor_id').notNull(),
        timestamp: tstz('timestamp').notNull().defaultNow(),
        payload: jsonb('payload').$type<unknown>().notNull(),
        correlationId: text('correlation_id').notNull(),
        causationId: text('causation_id'),
        schemaVersion: integer('schema_version').notNull().default(1),
        publishedAt: tstz('published_at'),
        publishAttempts: integer('publish_attempts').notNull().default(0),
        lastError: text('last_error'),
    },
    (t) => [
        index('domain_events_unpublished_idx')
            .on(t.timestamp)
            .where(sql`${t.publishedAt} is null`),
        index('domain_events_order_idx').on(t.orderId, t.timestamp),
        index('domain_events_build_idx').on(t.buildId, t.timestamp),
        index('domain_events_type_idx').on(t.eventType),
    ],
);

/** Inbound webhook idempotency: (provider, event_id) processed at most once. */
export const webhookEvents = pgTable(
    'webhook_events',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('webhook')),
        provider: text('provider').notNull(), // 'stripe' | 'dev' | 'easypost'
        eventId: text('event_id').notNull(),
        eventType: text('event_type').notNull(),
        payload: jsonb('payload').$type<unknown>().notNull(),
        receivedAt: tstz('received_at').notNull().defaultNow(),
        processedAt: tstz('processed_at'),
        error: text('error'),
    },
    (t) => [uniqueIndex('webhook_events_provider_event_uq').on(t.provider, t.eventId)],
);

// ---------------------------------------------------------------------------
// R2: Make AI intents + Build Graph (ADR-0001)
// ---------------------------------------------------------------------------

/** A persisted Make AI CreationIntent ("Continue to Build" turns it into a Build). No raw prompt is stored. */
export const makeIntents = pgTable(
    'make_intents',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('makeIntent')),
        intent: jsonb('intent').$type<CreationIntent>().notNull(),
        model: text('model').notNull(),
        promptSha256: text('prompt_sha256').notNull(),
        promptChars: integer('prompt_chars').notNull(),
        buildId: text('build_id').references(() => builds.id),
        createdAt: createdAt(),
    },
    (t) => [index('make_intents_build_idx').on(t.buildId)],
);

/** Immutable once APPROVED. Every accepted change writes a new version (copy-on-write graph). */
export const designVersions = pgTable(
    'design_versions',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('designVersion')),
        buildId: text('build_id')
            .notNull()
            .references(() => builds.id, { onDelete: 'cascade' }),
        version: integer('version').notNull(),
        status: designVersionStatusEnum('status').notNull().default('DRAFT'),
        summary: text('summary').notNull(),
        parentVersion: integer('parent_version'),
        createdBy: text('created_by').notNull(),
        approvedBy: text('approved_by'),
        approvedAt: tstz('approved_at'),
        createdAt: createdAt(),
    },
    (t) => [uniqueIndex('design_versions_build_version_uq').on(t.buildId, t.version)],
);

export const bgNodes = pgTable(
    'bg_nodes',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('bgNode')),
        buildId: text('build_id')
            .notNull()
            .references(() => builds.id, { onDelete: 'cascade' }),
        designVersion: integer('design_version').notNull(),
        /** Stable logical key across versions, e.g. `part:body`. */
        key: text('key').notNull(),
        type: bgNodeTypeEnum('type').notNull(),
        label: text('label').notNull(),
        data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
        confidence: doublePrecision('confidence'),
        source: bgSourceEnum('source').notNull(),
        provenance: text('provenance'),
        createdAt: createdAt(),
    },
    (t) => [
        uniqueIndex('bg_nodes_version_key_uq').on(t.buildId, t.designVersion, t.key),
        index('bg_nodes_build_type_idx').on(t.buildId, t.type),
        index('bg_nodes_data_gin').using('gin', t.data),
        check('bg_nodes_confidence_ck', sql`${t.confidence} is null or (${t.confidence} >= 0 and ${t.confidence} <= 1)`),
    ],
);

export const bgEdges = pgTable(
    'bg_edges',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('bgEdge')),
        buildId: text('build_id')
            .notNull()
            .references(() => builds.id, { onDelete: 'cascade' }),
        designVersion: integer('design_version').notNull(),
        type: bgEdgeTypeEnum('type').notNull(),
        fromKey: text('from_key').notNull(),
        toKey: text('to_key').notNull(),
        data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
        createdAt: createdAt(),
    },
    (t) => [
        uniqueIndex('bg_edges_version_uq').on(t.buildId, t.designVersion, t.type, t.fromKey, t.toKey),
        index('bg_edges_from_idx').on(t.buildId, t.designVersion, t.fromKey),
    ],
);

// ---------------------------------------------------------------------------
// R2: Sourcing bridge (ADR-0005, workflow 03)
// ---------------------------------------------------------------------------

/** An MCP client allowed to call the Sourcing MCP server (one per Accio Work workspace). Token stored as sha256 only. */
export const sourcingClients = pgTable(
    'sourcing_clients',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('sourcingClient')),
        name: text('name').notNull(),
        tokenHash: text('token_hash').notNull(),
        lastUsedAt: tstz('last_used_at'),
        revokedAt: tstz('revoked_at'),
        /** Stage 1 allowlist: MCP tool short names this workspace may list and call (null = all nine). */
        allowedTools: text('allowed_tools').array(),
        /** Stage 1 allowlist: client IP ranges (CIDR) the token is accepted from (null = any). */
        allowedCidrs: text('allowed_cidrs').array(),
        createdAt: createdAt(),
    },
    (t) => [uniqueIndex('sourcing_clients_token_hash_uq').on(t.tokenHash)],
);

export const sourcingJobs = pgTable(
    'sourcing_jobs',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('sourcingJob')),
        displayId: text('display_id').notNull(),
        buildId: text('build_id')
            .notNull()
            .references(() => builds.id),
        partId: text('part_id').references(() => parts.id),
        designVersion: integer('design_version').notNull(),
        /** The SourcingRequest handed to the agent, frozen at creation. */
        request: jsonb('request').$type<SourcingRequest>().notNull(),
        approvalPolicy: jsonb('approval_policy').$type<ApprovalPolicy>().notNull(),
        status: sourcingJobStatusEnum('status').notNull().default('QUEUED'),
        channel: sourcingChannelEnum('channel').notNull().default('accio'),
        priority: integer('priority').notNull().default(0),
        leaseId: uuid('lease_id'),
        leasedByClientId: text('leased_by_client_id').references(() => sourcingClients.id),
        leaseExpiresAt: tstz('lease_expires_at'),
        leaseCount: integer('lease_count').notNull().default(0),
        summary: text('summary'),
        outcome: text('outcome'),
        createdBy: text('created_by').notNull(),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
        completedAt: tstz('completed_at'),
    },
    (t) => [
        uniqueIndex('sourcing_jobs_display_id_uq').on(t.displayId),
        index('sourcing_jobs_queue_idx').on(t.status, t.priority, t.createdAt),
        index('sourcing_jobs_build_idx').on(t.buildId),
    ],
);

export const suppliers = pgTable(
    'suppliers',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('supplier')),
        name: text('name').notNull(),
        platform: text('platform').notNull(),
        platformRef: text('platform_ref'),
        country: text('country').notNull(),
        verified: boolean('verified').notNull().default(false),
        profileUrl: text('profile_url'),
        capabilities: jsonb('capabilities').$type<string[]>().notNull().default([]),
        createdBy: text('created_by').notNull(),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [
        uniqueIndex('suppliers_platform_ref_uq')
            .on(t.platform, t.platformRef)
            .where(sql`${t.platformRef} is not null`),
    ],
);

export const supplierEvidence = pgTable(
    'supplier_evidence',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('supplierEvidence')),
        supplierId: text('supplier_id')
            .notNull()
            .references(() => suppliers.id, { onDelete: 'cascade' }),
        jobId: text('job_id').references(() => sourcingJobs.id),
        evidence: jsonb('evidence').$type<SupplierEvidenceInput>().notNull(),
        createdAt: createdAt(),
    },
    (t) => [index('supplier_evidence_supplier_idx').on(t.supplierId)],
);

export const supplierOffers = pgTable(
    'supplier_offers',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('supplierOffer')),
        jobId: text('job_id')
            .notNull()
            .references(() => sourcingJobs.id),
        supplierId: text('supplier_id')
            .notNull()
            .references(() => suppliers.id),
        buildId: text('build_id')
            .notNull()
            .references(() => builds.id),
        designVersion: integer('design_version').notNull(),
        idempotencyKey: text('idempotency_key').notNull(),
        quantity: integer('quantity').notNull(),
        currency: text('currency').notNull().default('usd'),
        unitPriceCents: cents('unit_price_cents').notNull(),
        toolingCents: cents('tooling_cents').notNull().default(0),
        sampleCostCents: cents('sample_cost_cents'),
        shippingCents: cents('shipping_cents'),
        moq: integer('moq').notNull(),
        productionLeadDays: integer('production_lead_days').notNull(),
        shippingLeadDays: integer('shipping_lead_days').notNull(),
        incoterm: incotermEnum('incoterm').notNull(),
        material: text('material').notNull(),
        processes: jsonb('processes').$type<string[]>().notNull(),
        certificationsClaimed: jsonb('certifications_claimed').$type<string[]>().notNull().default([]),
        exceptions: jsonb('exceptions').$type<string[]>().notNull().default([]),
        confidence: doublePrecision('confidence').notNull(),
        negotiationStatus: negotiationStatusEnum('negotiation_status').notNull(),
        trustLevel: trustLevelEnum('trust_level').notNull(),
        status: supplierOfferStatusEnum('status').notNull().default('ACTIVE'),
        validUntil: tstz('valid_until'),
        /** The validated tool input, kept verbatim for audit. */
        raw: jsonb('raw').$type<SubmitOfferInput>().notNull(),
        submittedBy: text('submitted_by').notNull(),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [
        uniqueIndex('supplier_offers_idempotency_uq').on(t.jobId, t.idempotencyKey),
        index('supplier_offers_build_idx').on(t.buildId, t.status),
        check('supplier_offers_confidence_ck', sql`${t.confidence} >= 0 and ${t.confidence} <= 1`),
        check('supplier_offers_trust_ck', sql`${t.trustLevel} in ('SUPPLIER_ESTIMATE', 'SUPPLIER_CONFIRMED')`),
    ],
);

export const sourcingNegotiations = pgTable(
    'sourcing_negotiations',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('negotiation')),
        jobId: text('job_id')
            .notNull()
            .references(() => sourcingJobs.id),
        supplierId: text('supplier_id')
            .notNull()
            .references(() => suppliers.id),
        status: negotiationStatusEnum('status').notNull(),
        /** Append-only notes: [{ at, status, note }]. */
        notes: jsonb('notes').$type<{ at: string; status: string; note: string }[]>().notNull().default([]),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [uniqueIndex('sourcing_negotiations_job_supplier_uq').on(t.jobId, t.supplierId)],
);

export const sourcingDocuments = pgTable(
    'sourcing_documents',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('sourcingDocument')),
        jobId: text('job_id')
            .notNull()
            .references(() => sourcingJobs.id),
        supplierId: text('supplier_id').references(() => suppliers.id),
        kind: sourcingDocumentKindEnum('kind').notNull(),
        fileKey: text('file_key').notNull(),
        filename: text('filename').notNull(),
        contentType: text('content_type').notNull(),
        sizeBytes: integer('size_bytes').notNull(),
        sha256: text('sha256').notNull(),
        uploadedBy: text('uploaded_by').notNull(),
        createdAt: createdAt(),
    },
    (t) => [index('sourcing_documents_job_idx').on(t.jobId)],
);

/** Human decisions at the approval boundary (ADR-0005). Agents can only create PENDING rows. */
export const approvals = pgTable(
    'approvals',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('approval')),
        jobId: text('job_id').references(() => sourcingJobs.id),
        buildId: text('build_id')
            .notNull()
            .references(() => builds.id),
        kind: approvalKindEnum('kind').notNull(),
        status: approvalStatusEnum('status').notNull().default('PENDING'),
        approverRole: approverRoleEnum('approver_role').notNull(),
        requestedBy: text('requested_by').notNull(),
        supplierId: text('supplier_id').references(() => suppliers.id),
        supplierOfferId: text('supplier_offer_id').references(() => supplierOffers.id),
        reason: text('reason').notNull(),
        details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
        decidedBy: text('decided_by'),
        decisionNote: text('decision_note'),
        decidedAt: tstz('decided_at'),
        expiresAt: tstz('expires_at'),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [
        index('approvals_pending_idx')
            .on(t.approverRole, t.createdAt)
            .where(sql`${t.status} = 'PENDING'`),
        index('approvals_job_idx').on(t.jobId),
        index('approvals_build_idx').on(t.buildId),
    ],
);

/** Every signed package URL handed to a sourcing agent. */
export const sourcingAccessLog = pgTable(
    'sourcing_access_log',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('sourcingAudit')),
        jobId: text('job_id')
            .notNull()
            .references(() => sourcingJobs.id),
        clientId: text('client_id').references(() => sourcingClients.id),
        supplierId: text('supplier_id').references(() => suppliers.id),
        tier: packageTierEnum('tier').notNull(),
        fileKey: text('file_key').notNull(),
        expiresAt: tstz('expires_at').notNull(),
        createdAt: createdAt(),
    },
    (t) => [index('sourcing_access_log_job_idx').on(t.jobId)],
);

/** Audit log of every MCP tool call (args hashed, never stored raw). */
export const sourcingToolCalls = pgTable(
    'sourcing_tool_calls',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('sourcingAudit')),
        clientId: text('client_id').references(() => sourcingClients.id),
        tool: text('tool').notNull(),
        jobId: text('job_id'),
        ok: boolean('ok').notNull(),
        errorCode: text('error_code'),
        argsSha256: text('args_sha256').notNull(),
        durationMs: integer('duration_ms').notNull(),
        createdAt: createdAt(),
    },
    (t) => [index('sourcing_tool_calls_client_idx').on(t.clientId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// R2 accounts (ADR-0009): users, sessions, passkeys, sign-in challenges, OIDC links,
// guest device preferences, follows. Builds and orders gain owner columns above
// (`builds.owner_user_id`, `builds.device_hash`, `orders.buyer_user_id`).
// ---------------------------------------------------------------------------

export const AUTH_CHALLENGE_KINDS = ['email', 'passkey_register', 'passkey_login', 'oauth'] as const;
export const authChallengeKindEnum = pgEnum('auth_challenge_kind', AUTH_CHALLENGE_KINDS);

export const users = pgTable(
    'users',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('user')),
        /** Always stored lowercased (checked). */
        email: text('email').notNull(),
        emailVerifiedAt: tstz('email_verified_at'),
        displayName: text('display_name'),
        /** Public creator handle; unique when set. */
        handle: text('handle'),
        roles: text('roles').array().$type<UserRole[]>().notNull().default(sql`'{buyer}'::text[]`),
        intent: text('intent').$type<OnboardingIntent>(),
        interests: jsonb('interests').$type<InterestSlug[]>().notNull().default([]),
        onboardedAt: tstz('onboarded_at'),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [
        uniqueIndex('users_email_uq').on(t.email),
        uniqueIndex('users_handle_uq')
            .on(t.handle)
            .where(sql`${t.handle} is not null`),
        check('users_email_lower_ck', sql`${t.email} = lower(${t.email})`),
    ],
);

/** `dm_session` cookie holds a random secret; only its sha256 is stored. */
export const userSessions = pgTable(
    'user_sessions',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('userSession')),
        userId: text('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        secretHash: text('secret_hash').notNull(),
        /** sha256 of the `dm_device` cookie the session was created on (device ownership checks). */
        deviceHash: text('device_hash'),
        createdAt: createdAt(),
        expiresAt: tstz('expires_at').notNull(),
        lastSeenAt: tstz('last_seen_at'),
        userAgent: text('user_agent'),
        revokedAt: tstz('revoked_at'),
    },
    (t) => [uniqueIndex('user_sessions_secret_hash_uq').on(t.secretHash), index('user_sessions_user_idx').on(t.userId), index('user_sessions_device_idx').on(t.deviceHash)],
);

/** WebAuthn credentials (discoverable). `id` is the base64url credential id. */
export const passkeys = pgTable(
    'passkeys',
    {
        id: text('id').primaryKey(),
        userId: text('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        /** COSE public key, base64url. */
        publicKey: text('public_key').notNull(),
        counter: integer('counter').notNull().default(0),
        transports: text('transports').array().$type<string[]>().notNull().default(sql`'{}'::text[]`),
        deviceType: text('device_type').notNull(),
        backedUp: boolean('backed_up').notNull().default(false),
        name: text('name').notNull(),
        createdAt: createdAt(),
        lastUsedAt: tstz('last_used_at'),
    },
    (t) => [index('passkeys_user_idx').on(t.userId)],
);

/** One-shot sign-in challenges: email codes (HMAC-hashed), WebAuthn challenges. */
export const authChallenges = pgTable(
    'auth_challenges',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('authChallenge')),
        kind: authChallengeKindEnum('kind').notNull(),
        email: text('email'),
        userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
        /** HMAC-SHA256(AUTH_SECRET, "<id>.<code>") for email codes. */
        codeHash: text('code_hash'),
        /** WebAuthn challenge (base64url). */
        challenge: text('challenge'),
        attempts: integer('attempts').notNull().default(0),
        expiresAt: tstz('expires_at').notNull(),
        consumedAt: tstz('consumed_at'),
        createdAt: createdAt(),
    },
    (t) => [index('auth_challenges_email_idx').on(t.email, t.createdAt), index('auth_challenges_user_idx').on(t.userId, t.kind)],
);

export const oauthAccounts = pgTable(
    'oauth_accounts',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('oauthAccount')),
        provider: text('provider').notNull(),
        providerUserId: text('provider_user_id').notNull(),
        userId: text('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        createdAt: createdAt(),
    },
    (t) => [uniqueIndex('oauth_accounts_provider_user_uq').on(t.provider, t.providerUserId), index('oauth_accounts_user_idx').on(t.userId)],
);

/** Guest onboarding answers, keyed by the device cookie hash. Merged into the user at sign-in. */
export const devicePreferences = pgTable('device_preferences', {
    deviceHash: text('device_hash').primaryKey(),
    intent: text('intent').$type<OnboardingIntent>(),
    interests: jsonb('interests').$type<InterestSlug[]>().notNull().default([]),
    onboardedAt: tstz('onboarded_at'),
    updatedAt: updatedAt(),
});

export const buildFollows = pgTable(
    'build_follows',
    {
        userId: text('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        buildId: text('build_id')
            .notNull()
            .references(() => builds.id, { onDelete: 'cascade' }),
        createdAt: createdAt(),
    },
    (t) => [primaryKey({ columns: [t.userId, t.buildId] }), index('build_follows_build_idx').on(t.buildId)],
);

// ---------------------------------------------------------------------------
// R2 build attachments (100-1)
// ---------------------------------------------------------------------------

/** Keep in sync with ATTACHMENT_KINDS in src/contracts/workspace.ts. */
export const buildAttachmentKindEnum = pgEnum('build_attachment_kind', ['image', 'cad']);

/**
 * Reference images and CAD files attached to a build (the Build Workspace attachment tray).
 * A row is created with the signed upload URL; `sha256` stays null until the bytes are
 * verified (size cap + magic bytes), so a null sha256 means "upload not verified yet".
 * Bytes live at `storage_key` = `builds/<buildId>/attachments/<attId>/<safe filename>`.
 * Deletes are soft (`deleted_at`); the object is removed from storage at delete time.
 */
export const buildAttachments = pgTable(
    'build_attachments',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('buildAttachment')),
        buildId: text('build_id')
            .notNull()
            .references(() => builds.id, { onDelete: 'cascade' }),
        /** The build's current design version when the file was attached. */
        designVersion: integer('design_version').notNull(),
        kind: buildAttachmentKindEnum('kind').notNull(),
        filename: text('filename').notNull(),
        contentType: text('content_type').notNull(),
        sizeBytes: integer('size_bytes').notNull(),
        sha256: text('sha256'),
        storageKey: text('storage_key').notNull(),
        /** Part created by "Use as a part" (DXF attachments). */
        partId: text('part_id').references(() => parts.id),
        /** Owner once R2 accounts exist; null for guests. */
        createdByUserId: text('created_by_user_id'),
        /** sha256 of the guest device cookie, when present. */
        deviceHash: text('device_hash'),
        createdAt: createdAt(),
        deletedAt: tstz('deleted_at'),
    },
    (t) => [
        index('build_attachments_build_idx')
            .on(t.buildId, t.createdAt)
            .where(sql`${t.deletedAt} is null`),
        check('build_attachments_size_ck', sql`${t.sizeBytes} > 0 and ${t.sizeBytes} <= 52428800`),
    ],
);

// ---------------------------------------------------------------------------
// R2 passport replacements (1000-3)
// ---------------------------------------------------------------------------

/**
 * Traceability for "Order a replacement" on a Product Passport: each replacement quote points
 * back at the passport it came from (`quotes` has no metadata column, so this side table holds
 * it). The replacement part lives on its own build (a copy of the passport's verified file), so
 * the original build's private state is never reachable from a public passport.
 */
export const passportReplacements = pgTable(
    'passport_replacements',
    {
        quoteId: text('quote_id')
            .primaryKey()
            .references(() => quotes.id),
        replacementOfPassportId: text('replacement_of_passport_id')
            .notNull()
            .references(() => passports.id),
        partId: text('part_id')
            .notNull()
            .references(() => parts.id),
        buildId: text('build_id')
            .notNull()
            .references(() => builds.id),
        /** The quote the passport was issued for (what was actually made). */
        sourceQuoteId: text('source_quote_id').notNull(),
        quantity: integer('quantity').notNull(),
        deviceHash: text('device_hash'),
        createdAt: createdAt(),
    },
    (t) => [index('passport_replacements_passport_idx').on(t.replacementOfPassportId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Rate limiting (Stage 1 hardening): shared buckets for every instance
// ---------------------------------------------------------------------------

/**
 * One row per (limiter, key): a fixed window (`count` until `expires_at`) or a token bucket
 * (`tokens` at `updated_at`). Written by one atomic upsert per hit (src/server/rate-limit);
 * `key_hash` is the sha256 of the limited key (an IP or client id), never the key itself.
 * Rows past `expires_at` are equivalent to a fresh bucket and are swept periodically.
 */
export const rateLimitBuckets = pgTable(
    'rate_limit_buckets',
    {
        bucket: text('bucket').notNull(),
        keyHash: text('key_hash').notNull(),
        count: integer('count').notNull().default(0),
        tokens: doublePrecision('tokens').notNull().default(0),
        allowed: boolean('allowed').notNull().default(true),
        updatedAt: tstz('updated_at').notNull().defaultNow(),
        expiresAt: tstz('expires_at').notNull(),
    },
    (t) => [uniqueIndex('rate_limit_buckets_key_uq').on(t.bucket, t.keyHash), index('rate_limit_buckets_expires_idx').on(t.expiresAt)],
);

// ---------------------------------------------------------------------------
// R4 Live (workflow 06, ADR-0003)
// ---------------------------------------------------------------------------
//
// User references are plain `text` user ids (no FK): the `users` table belongs to the
// R2 accounts module. Channel owner display data is denormalized onto the channel row.

export const channelKindEnum = pgEnum('channel_kind', CHANNEL_KINDS);
export const showStatusEnum = pgEnum('show_status', SHOW_STATUSES);
export const showFormatEnum = pgEnum('show_format', SHOW_FORMATS);
export const dropStatusEnum = pgEnum('drop_status', DROP_STATUSES);
export const slotClaimStatusEnum = pgEnum('slot_claim_status', SLOT_CLAIM_STATUSES);

/** Human show numbers: shows.display_number -> `LIVE-<n>`. */
export const liveShowNumberSeq = pgSequence('live_show_number_seq', { startWith: 100, increment: 1 });

export const channels = pgTable(
    'channels',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('channel')),
        handle: text('handle').notNull(),
        name: text('name').notNull(),
        kind: channelKindEnum('kind').notNull().default('creator'),
        categories: jsonb('categories').$type<ChannelCategory[]>().notNull().default([]),
        bio: text('bio'),
        /** Owning user (accounts module). Null for partner-shop / platform channels. */
        ownerUserId: text('owner_user_id'),
        ownerDisplayName: text('owner_display_name'),
        ownerEmail: text('owner_email'),
        /** Partner shop behind a factory channel, when there is one. */
        shopId: text('shop_id').references(() => shops.id),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [
        uniqueIndex('channels_handle_uq').on(t.handle),
        uniqueIndex('channels_owner_uq')
            .on(t.ownerUserId)
            .where(sql`${t.ownerUserId} is not null`),
    ],
);

export const channelFollows = pgTable(
    'channel_follows',
    {
        channelId: text('channel_id')
            .notNull()
            .references(() => channels.id, { onDelete: 'cascade' }),
        userId: text('user_id').notNull(),
        createdAt: createdAt(),
    },
    (t) => [primaryKey({ columns: [t.channelId, t.userId] }), index('channel_follows_user_idx').on(t.userId)],
);

export const shows = pgTable(
    'shows',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('show')),
        displayNumber: integer('display_number')
            .notNull()
            .default(sql`nextval('live_show_number_seq')`),
        channelId: text('channel_id')
            .notNull()
            .references(() => channels.id, { onDelete: 'cascade' }),
        title: text('title').notNull(),
        format: showFormatEnum('format').notNull(),
        status: showStatusEnum('status').notNull().default('SCHEDULED'),
        scheduledFor: tstz('scheduled_for').notNull(),
        startedAt: tstz('started_at'),
        endedAt: tstz('ended_at'),
        /** External HLS source (Owncast / MediaMTX) chosen by the creator. */
        hlsUrl: text('hls_url'),
        /** Recorded replay (LiveKit egress or an uploaded MP4 / HLS), used once the show ENDED. */
        replayUrl: text('replay_url'),
        /** LiveKit room name when LiveKit is configured at start_show. */
        livekitRoom: text('livekit_room'),
        thumbnailUrl: text('thumbnail_url'),
        viewerCount: integer('viewer_count').notNull().default(0),
        peakViewers: integer('peak_viewers').notNull().default(0),
        likeCount: integer('like_count').notNull().default(0),
        /** Last assigned Live Build Protocol seq (advanced under this row's lock). */
        lastSeq: integer('last_seq').notNull().default(0),
        /** Build currently in focus (last `product.focus`). */
        featuredBuildId: text('featured_build_id').references(() => builds.id),
        slowModeSeconds: integer('slow_mode_seconds').notNull().default(0),
        createdBy: text('created_by').notNull(),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [
        uniqueIndex('shows_display_number_uq').on(t.displayNumber),
        index('shows_channel_idx').on(t.channelId, t.scheduledFor),
        index('shows_status_idx').on(t.status, t.scheduledFor),
        check('shows_counts_ck', sql`${t.viewerCount} >= 0 and ${t.likeCount} >= 0 and ${t.lastSeq} >= 0`),
    ],
);

export const showFeaturedBuilds = pgTable(
    'show_featured_builds',
    {
        showId: text('show_id')
            .notNull()
            .references(() => shows.id, { onDelete: 'cascade' }),
        buildId: text('build_id')
            .notNull()
            .references(() => builds.id),
        position: integer('position').notNull().default(0),
        createdAt: createdAt(),
    },
    (t) => [primaryKey({ columns: [t.showId, t.buildId] })],
);

/**
 * The Live Build Protocol log. Append-only: one row per event, `seq` monotonic per show
 * (assigned under the show row lock), `stream_ts_ms` = position in the broadcast.
 * Commerce-affecting events carry an HMAC `sig` (LIVE_EVENT_SIGNING_SECRET).
 */
export const liveEvents = pgTable(
    'live_events',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('liveEvent')),
        showId: text('show_id')
            .notNull()
            .references(() => shows.id, { onDelete: 'cascade' }),
        seq: integer('seq').notNull(),
        streamTsMs: integer('stream_ts_ms').notNull(),
        event: text('event').$type<LiveEventType>().notNull(),
        actorKind: text('actor_kind').$type<LiveActorKind>().notNull(),
        actorId: text('actor_id').notNull(),
        actorName: text('actor_name'),
        buildId: text('build_id'),
        designVersion: integer('design_version'),
        payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
        at: tstz('at').notNull(),
        sig: text('sig'),
    },
    (t) => [uniqueIndex('live_events_show_seq_uq').on(t.showId, t.seq), index('live_events_show_event_idx').on(t.showId, t.event)],
);

export const liveQuestions = pgTable(
    'live_questions',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('liveQuestion')),
        showId: text('show_id')
            .notNull()
            .references(() => shows.id, { onDelete: 'cascade' }),
        mode: text('mode').$type<'creator' | 'make_ai'>().notNull(),
        text: text('text').notNull(),
        askedByUserId: text('asked_by_user_id').notNull(),
        askedByName: text('asked_by_name').notNull(),
        answer: text('answer'),
        answeredBy: text('answered_by').$type<'host' | 'make_ai'>(),
        answeredAt: tstz('answered_at'),
        /** Build the question was about (in focus when it was asked). */
        buildId: text('build_id'),
        createdAt: createdAt(),
    },
    (t) => [index('live_questions_show_idx').on(t.showId, t.createdAt)],
);

export const livePolls = pgTable(
    'live_polls',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('livePoll')),
        showId: text('show_id')
            .notNull()
            .references(() => shows.id, { onDelete: 'cascade' }),
        question: text('question').notNull(),
        options: jsonb('options').$type<string[]>().notNull(),
        status: text('status').$type<'OPEN' | 'CLOSED'>().notNull().default('OPEN'),
        createdBy: text('created_by').notNull(),
        closedAt: tstz('closed_at'),
        createdAt: createdAt(),
    },
    (t) => [index('live_polls_show_idx').on(t.showId, t.createdAt)],
);

export const livePollVotes = pgTable(
    'live_poll_votes',
    {
        pollId: text('poll_id')
            .notNull()
            .references(() => livePolls.id, { onDelete: 'cascade' }),
        userId: text('user_id').notNull(),
        optionIndex: integer('option_index').notNull(),
        createdAt: createdAt(),
    },
    (t) => [primaryKey({ columns: [t.pollId, t.userId] }), check('live_poll_votes_option_ck', sql`${t.optionIndex} >= 0 and ${t.optionIndex} < 4`)],
);

export const liveMutes = pgTable(
    'live_mutes',
    {
        showId: text('show_id')
            .notNull()
            .references(() => shows.id, { onDelete: 'cascade' }),
        userId: text('user_id').notNull(),
        until: tstz('until').notNull(),
        createdBy: text('created_by').notNull(),
        createdAt: createdAt(),
    },
    (t) => [primaryKey({ columns: [t.showId, t.userId] })],
);

/** One like per signed-in viewer per show. */
export const showLikes = pgTable(
    'show_likes',
    {
        showId: text('show_id')
            .notNull()
            .references(() => shows.id, { onDelete: 'cascade' }),
        userId: text('user_id').notNull(),
        createdAt: createdAt(),
    },
    (t) => [primaryKey({ columns: [t.showId, t.userId] })],
);

/** Who is watching (SSE heartbeats); feeds viewer counts when LiveKit is not configured. */
export const livePresence = pgTable(
    'live_presence',
    {
        showId: text('show_id')
            .notNull()
            .references(() => shows.id, { onDelete: 'cascade' }),
        viewerKey: text('viewer_key').notNull(),
        lastSeenAt: tstz('last_seen_at').notNull().defaultNow(),
    },
    (t) => [primaryKey({ columns: [t.showId, t.viewerKey] }), index('live_presence_seen_idx').on(t.showId, t.lastSeenAt)],
);

/**
 * A limited production run sold as Build Slots. `claimed_slots` is maintained under this
 * row's lock (fair queue) and never exceeds `total_slots` (check). `quote_id` is the
 * orderable BINDING quote at quantity = threshold_slots that proves the price covers cost.
 */
export const drops = pgTable(
    'drops',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('drop')),
        showId: text('show_id').references(() => shows.id),
        channelId: text('channel_id')
            .notNull()
            .references(() => channels.id),
        buildId: text('build_id')
            .notNull()
            .references(() => builds.id),
        quoteId: text('quote_id')
            .notNull()
            .references(() => quotes.id),
        title: text('title').notNull(),
        priceCents: cents('price_cents').notNull(),
        currency: text('currency').notNull().default('usd'),
        totalSlots: integer('total_slots').notNull(),
        thresholdSlots: integer('threshold_slots').notNull(),
        perBuyerLimit: integer('per_buyer_limit').notNull(),
        claimedSlots: integer('claimed_slots').notNull().default(0),
        status: dropStatusEnum('status').notNull().default('OPEN'),
        opensAt: tstz('opens_at').notNull(),
        closesAt: tstz('closes_at').notNull(),
        endingNotifiedAt: tstz('ending_notified_at'),
        closedAt: tstz('closed_at'),
        createdBy: text('created_by').notNull(),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [
        index('drops_show_idx').on(t.showId),
        index('drops_open_idx')
            .on(t.closesAt)
            .where(sql`${t.status} = 'OPEN'`),
        check('drops_slots_ck', sql`${t.claimedSlots} >= 0 and ${t.claimedSlots} <= ${t.totalSlots} and ${t.thresholdSlots} <= ${t.totalSlots}`),
    ],
);

export const slotClaims = pgTable(
    'slot_claims',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('slotClaim')),
        dropId: text('drop_id')
            .notNull()
            .references(() => drops.id),
        userId: text('user_id').notNull(),
        buyerEmail: text('buyer_email').notNull(),
        quantity: integer('quantity').notNull(),
        status: slotClaimStatusEnum('status').notNull().default('RESERVED'),
        orderId: text('order_id')
            .notNull()
            .references(() => orders.id),
        /** Where the buyer authorizes the hold (Stripe Checkout or the dev pay page). */
        checkoutUrl: text('checkout_url'),
        idempotencyKey: text('idempotency_key'),
        /** Unauthorized claims expire at this time and their slots return to the drop. */
        expiresAt: tstz('expires_at').notNull(),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [
        index('slot_claims_drop_idx').on(t.dropId, t.status),
        index('slot_claims_user_idx').on(t.userId),
        uniqueIndex('slot_claims_order_uq').on(t.orderId),
        uniqueIndex('slot_claims_idempotency_uq')
            .on(t.dropId, t.userId, t.idempotencyKey)
            .where(sql`${t.idempotencyKey} is not null`),
        check('slot_claims_quantity_ck', sql`${t.quantity} > 0`),
    ],
);

// ---------------------------------------------------------------------------
// R3 Prime ordering + promise (docs/architecture/r3-prime.md)
// ---------------------------------------------------------------------------

export const supplierLegStatusEnum = pgEnum('supplier_leg_status', SUPPLIER_LEG_STATUSES);
export const promiseLegEnum = pgEnum('promise_leg', PROMISE_LEGS);
export const promiseStatusEnum = pgEnum('promise_status', PROMISE_STATUSES);
export const creditStatusEnum = pgEnum('credit_status', CREDIT_STATUSES);
export const paymentPlanKindEnum = pgEnum('payment_plan_kind', PAYMENT_PLAN_KINDS);
export const shopStockKindEnum = pgEnum('shop_stock_kind', SHOP_STOCK_KINDS);

/**
 * Partner shops that receive supplier freight (QA at receipt, then ship to the buyer).
 * Owner input: which partners receive. A supplier-route quote is only made when one is active.
 */
export const receivingSites = pgTable('receiving_sites', {
    shopId: text('shop_id')
        .primaryKey()
        .references(() => shops.id, { onDelete: 'cascade' }),
    active: boolean('active').notNull().default(true),
    /** Fee per inbound receipt + inspection (cents), paid to the partner like a shop payout. */
    receivingFeeCents: cents('receiving_fee_cents').notNull().default(4500),
    /** Per-unit handling for count/visual inspection and repacking (cents). */
    perUnitCents: cents('per_unit_cents').notNull().default(15),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
});

/**
 * A BINDING supplier-route quote: 1:1 with its `quotes` row (route = supplier), with the
 * full composition (source, timestamp, validity, confidence, supplier status, assumptions,
 * excluded costs, design version). Ops-only: buyers see the quotes row through QuoteView.
 */
export const supplierQuotes = pgTable(
    'supplier_quotes',
    {
        quoteId: text('quote_id')
            .primaryKey()
            .references(() => quotes.id, { onDelete: 'cascade' }),
        offerId: text('offer_id')
            .notNull()
            .references(() => supplierOffers.id),
        jobId: text('job_id')
            .notNull()
            .references(() => sourcingJobs.id),
        supplierId: text('supplier_id')
            .notNull()
            .references(() => suppliers.id),
        selectionApprovalId: text('selection_approval_id')
            .notNull()
            .references(() => approvals.id),
        receivingShopId: text('receiving_shop_id').references(() => shops.id),
        composition: jsonb('composition').$type<SupplierQuoteComposition>().notNull(),
        riskScore: doublePrecision('risk_score').notNull(),
        depositPct: doublePrecision('deposit_pct').notNull(),
        createdAt: createdAt(),
    },
    (t) => [index('supplier_quotes_offer_idx').on(t.offerId), check('supplier_quotes_deposit_ck', sql`${t.depositPct} >= 0 and ${t.depositPct} <= 1`)],
);

/**
 * How an order is paid. Absent row = FULL with no credit (every R1 order).
 * DEPOSIT_BALANCE: deposit at checkout, balance when the order is ready to ship.
 * Invariant: deposit + balance = order total; credit is applied to the first charge.
 */
export const orderPaymentPlans = pgTable(
    'order_payment_plans',
    {
        orderId: text('order_id')
            .primaryKey()
            .references(() => orders.id, { onDelete: 'cascade' }),
        kind: paymentPlanKindEnum('kind').notNull(),
        depositCents: cents('deposit_cents').notNull(),
        balanceCents: cents('balance_cents').notNull().default(0),
        creditCents: cents('credit_cents').notNull().default(0),
        creditId: text('credit_id'),
        depositPaymentId: text('deposit_payment_id'),
        balancePaymentId: text('balance_payment_id'),
        depositPaidAt: tstz('deposit_paid_at'),
        balanceRequestedAt: tstz('balance_requested_at'),
        balancePaidAt: tstz('balance_paid_at'),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [check('order_payment_plans_amounts_ck', sql`${t.depositCents} >= 0 and ${t.balanceCents} >= 0 and ${t.creditCents} >= 0 and ${t.creditCents} <= ${t.depositCents}`)],
);

/** Supplier fulfilment leg: created only by an APPROVED PLACE_PURCHASE_ORDER approval. */
export const supplierLegs = pgTable(
    'supplier_legs',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('supplierLeg')),
        orderId: text('order_id')
            .notNull()
            .references(() => orders.id),
        quoteId: text('quote_id')
            .notNull()
            .references(() => quotes.id),
        offerId: text('offer_id')
            .notNull()
            .references(() => supplierOffers.id),
        jobId: text('job_id')
            .notNull()
            .references(() => sourcingJobs.id),
        supplierId: text('supplier_id')
            .notNull()
            .references(() => suppliers.id),
        poApprovalId: text('po_approval_id')
            .notNull()
            .references(() => approvals.id),
        depositApprovalId: text('deposit_approval_id').references(() => approvals.id),
        supplierDepositCents: cents('supplier_deposit_cents').notNull().default(0),
        poNumber: text('po_number').notNull(),
        incoterm: incotermEnum('incoterm').notNull(),
        directShip: boolean('direct_ship').notNull().default(false),
        receivingShopId: text('receiving_shop_id').references(() => shops.id),
        receivingJobId: text('receiving_job_id').references(() => manufacturingJobs.id),
        status: supplierLegStatusEnum('status').notNull().default('PO_PLACED'),
        inboundCarrier: text('inbound_carrier'),
        inboundTracking: text('inbound_tracking'),
        preShipmentInspection: text('pre_shipment_inspection'),
        history: jsonb('history').$type<{ status: string; at: string; note: string | null; actorId: string }[]>().notNull().default([]),
        productionStartedAt: tstz('production_started_at'),
        shippedInboundAt: tstz('shipped_inbound_at'),
        receivedAt: tstz('received_at'),
        deliveredAt: tstz('delivered_at'),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [uniqueIndex('supplier_legs_order_uq').on(t.orderId), uniqueIndex('supplier_legs_po_number_uq').on(t.poNumber), index('supplier_legs_job_idx').on(t.jobId)],
);

/** The Delivery Promise set at checkout, with its per-leg P90 predictions. */
export const orderPromises = pgTable(
    'order_promises',
    {
        orderId: text('order_id')
            .primaryKey()
            .references(() => orders.id, { onDelete: 'cascade' }),
        /** The committed arrival date. */
        promisedDate: date('promised_date', { mode: 'string' }).notNull(),
        /** P90 arrival (incl. buffer) at checkout. */
        p90Date: date('p90_date', { mode: 'string' }).notNull(),
        /** Whether the buyer was shown "Arrives <promisedDate>" (P90 <= promised). */
        shown: boolean('shown').notNull(),
        startDate: date('start_date', { mode: 'string' }).notNull(),
        legs: jsonb('legs').$type<PromiseLegPrediction[]>().notNull(),
        bufferDays: integer('buffer_days').notNull().default(0),
        riskScore: doublePrecision('risk_score').notNull().default(0),
        zone: text('zone'),
        carrierService: text('carrier_service').notNull(),
        status: promiseStatusEnum('status').notNull().default('ON_TRACK'),
        lastP90Date: date('last_p90_date', { mode: 'string' }),
        atRiskAt: tstz('at_risk_at'),
        resolvedAt: tstz('resolved_at'),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [index('order_promises_status_idx').on(t.status)],
);

/** Predicted vs actual per leg (one row per order x leg), the training data of the P90 models. */
export const promiseObservations = pgTable(
    'promise_observations',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('promiseObservation')),
        orderId: text('order_id').references(() => orders.id, { onDelete: 'cascade' }),
        leg: promiseLegEnum('leg').notNull(),
        shopId: text('shop_id'),
        process: text('process'),
        carrierService: text('carrier_service'),
        zone: text('zone'),
        supplierId: text('supplier_id'),
        incoterm: text('incoterm'),
        predictedDays: doublePrecision('predicted_days').notNull(),
        actualDays: doublePrecision('actual_days').notNull(),
        /** 'order' (recorded on delivery) or 'synthetic' (seeded evaluation data). */
        source: text('source').notNull().default('order'),
        observedAt: tstz('observed_at').notNull().defaultNow(),
    },
    (t) => [
        uniqueIndex('promise_observations_order_leg_uq')
            .on(t.orderId, t.leg)
            .where(sql`${t.orderId} is not null`),
        index('promise_observations_leg_idx').on(t.leg, t.observedAt),
    ],
);

/** P90 slip per leg and scope, recomputed by the weekly retraining job. */
export const promiseModels = pgTable(
    'promise_models',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('promiseModel')),
        leg: promiseLegEnum('leg').notNull(),
        /** `*`, `shop:<id>`, `process:<name>`, `carrier:<service>`, `carrier:<service>:<zone>`, `supplier:<id>`, `incoterm:<x>`. */
        scope: text('scope').notNull(),
        slipP90Days: doublePrecision('slip_p90_days').notNull(),
        sampleCount: integer('sample_count').notNull(),
        trainedAt: tstz('trained_at').notNull(),
    },
    (t) => [uniqueIndex('promise_models_leg_scope_uq').on(t.leg, t.scope)],
);

/** Credits owed to buyers (missed promises), redeemable on their next checkout. */
export const buyerCredits = pgTable(
    'buyer_credits',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('buyerCredit')),
        buyerEmail: text('buyer_email').notNull(),
        sourceOrderId: text('source_order_id')
            .notNull()
            .references(() => orders.id),
        amountCents: cents('amount_cents').notNull(),
        reason: text('reason').notNull(),
        responsibleLeg: promiseLegEnum('responsible_leg').notNull(),
        status: creditStatusEnum('status').notNull().default('AVAILABLE'),
        redeemedOrderId: text('redeemed_order_id').references(() => orders.id),
        reservedAt: tstz('reserved_at'),
        redeemedAt: tstz('redeemed_at'),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [
        uniqueIndex('buyer_credits_source_order_uq').on(t.sourceOrderId),
        index('buyer_credits_email_idx').on(t.buyerEmail, t.status),
        check('buyer_credits_amount_ck', sql`${t.amountCents} > 0`),
    ],
);

/** Partner shop inventory: stock sheet and hardware (shop stock sourcing provider). */
export const shopStock = pgTable(
    'shop_stock',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('shopStock')),
        shopId: text('shop_id')
            .notNull()
            .references(() => shops.id, { onDelete: 'cascade' }),
        kind: shopStockKindEnum('kind').notNull(),
        sku: text('sku').notNull(),
        description: text('description').notNull(),
        materialId: text('material_id').references(() => materials.id),
        thicknessOptionId: text('thickness_option_id').references(() => thicknessOptions.id),
        quantity: integer('quantity').notNull().default(0),
        unit: text('unit').notNull().default('sheet'),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [uniqueIndex('shop_stock_shop_sku_uq').on(t.shopId, t.sku), index('shop_stock_thickness_idx').on(t.thicknessOptionId), check('shop_stock_quantity_ck', sql`${t.quantity} >= 0`)],
);

// ---------------------------------------------------------------------------
// R3 Prime experience (docs/architecture/r3-prime-experience.md)
// Membership, build cart + upsells, cart payment groups, B2B invoices, order chat,
// hold requests, ratings + UGC. User references are plain text ids (no FK to users).
// Statuses are text with CHECK constraints (values in src/contracts/prime.ts).
// ---------------------------------------------------------------------------

/** One Prime membership per user (Stripe Billing subscription or the dev double). */
export const memberships = pgTable(
    'memberships',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('membership')),
        userId: text('user_id').notNull(),
        email: text('email').notNull(),
        plan: text('plan').$type<'monthly' | 'annual'>().notNull(),
        status: text('status').$type<'incomplete' | 'trialing' | 'active' | 'past_due' | 'canceled'>().notNull().default('incomplete'),
        provider: paymentProviderEnum('provider').notNull(),
        providerCustomerId: text('provider_customer_id'),
        providerSubscriptionId: text('provider_subscription_id'),
        /** Set once the first trial starts: a user never gets a second trial. */
        trialUsed: boolean('trial_used').notNull().default(false),
        trialStartedAt: tstz('trial_started_at'),
        trialEndsAt: tstz('trial_ends_at'),
        currentPeriodEnd: tstz('current_period_end'),
        cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
        canceledAt: tstz('canceled_at'),
        trialReminderSentAt: tstz('trial_reminder_sent_at'),
        /** Provider event time of the last applied lifecycle event (out-of-order events are ignored). */
        lastEventAt: tstz('last_event_at'),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [
        uniqueIndex('memberships_user_uq').on(t.userId),
        uniqueIndex('memberships_provider_sub_uq').on(t.provider, t.providerSubscriptionId),
        index('memberships_trial_end_idx').on(t.status, t.trialEndsAt),
        check('memberships_status_ck', sql`${t.status} in ('incomplete','trialing','active','past_due','canceled')`),
        check('memberships_plan_ck', sql`${t.plan} in ('monthly','annual')`),
    ],
);

/** Append-only membership lifecycle audit (one row per applied transition). */
export const membershipEvents = pgTable(
    'membership_events',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('membershipEvent')),
        membershipId: text('membership_id')
            .notNull()
            .references(() => memberships.id, { onDelete: 'cascade' }),
        kind: text('kind').notNull(),
        fromStatus: text('from_status'),
        toStatus: text('to_status').notNull(),
        providerEventId: text('provider_event_id'),
        createdAt: createdAt(),
    },
    (t) => [index('membership_events_membership_idx').on(t.membershipId, t.createdAt)],
);

/** Membership benefits applied to an order at checkout (Shop Console priority, promise engine input). */
export const orderBenefits = pgTable('order_benefits', {
    orderId: text('order_id')
        .primaryKey()
        .references(() => orders.id, { onDelete: 'cascade' }),
    userId: text('user_id'),
    membershipId: text('membership_id'),
    priority: boolean('priority').notNull().default(false),
    guaranteedDates: boolean('guaranteed_dates').notNull().default(false),
    shippingWaivedCents: cents('shipping_waived_cents').notNull().default(0),
    materialDiscountCents: cents('material_discount_cents').notNull().default(0),
    createdAt: createdAt(),
});

/** Build cart: guest (device hash) or user (user id). One open cart per owner. */
export const carts = pgTable(
    'carts',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('cart')),
        userId: text('user_id'),
        deviceHash: text('device_hash'),
        status: text('status').$type<'open' | 'checked_out' | 'merged'>().notNull().default('open'),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [
        uniqueIndex('carts_open_user_uq').on(t.userId).where(sql`${t.status} = 'open' and ${t.userId} is not null`),
        uniqueIndex('carts_open_device_uq').on(t.deviceHash).where(sql`${t.status} = 'open' and ${t.userId} is null`),
        check('carts_owner_ck', sql`${t.userId} is not null or ${t.deviceHash} is not null`),
        check('carts_status_ck', sql`${t.status} in ('open','checked_out','merged')`),
    ],
);

/** One BINDING quote per part per cart (adding a newer quote of the same part replaces it). */
export const cartItems = pgTable(
    'cart_items',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('cartItem')),
        cartId: text('cart_id')
            .notNull()
            .references(() => carts.id, { onDelete: 'cascade' }),
        quoteId: text('quote_id')
            .notNull()
            .references(() => quotes.id),
        partId: text('part_id')
            .notNull()
            .references(() => parts.id),
        /** Upsells applied to reach this quote (each one re-quoted by the engine). */
        upsells: jsonb('upsells').$type<string[]>().notNull().default([]),
        addedAt: tstz('added_at').notNull().defaultNow(),
    },
    (t) => [uniqueIndex('cart_items_cart_part_uq').on(t.cartId, t.partId), index('cart_items_quote_idx').on(t.quoteId)],
);

/** Upsell offers computed once per base quote (each offer is a persisted engine quote). */
export const upsellOffers = pgTable(
    'upsell_offers',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('upsellOffer')),
        baseQuoteId: text('base_quote_id')
            .notNull()
            .references(() => quotes.id),
        kind: text('kind').notNull(),
        offerQuoteId: text('offer_quote_id')
            .notNull()
            .references(() => quotes.id),
        title: text('title').notNull(),
        description: text('description').notNull(),
        createdAt: createdAt(),
    },
    (t) => [uniqueIndex('upsell_offers_base_kind_uq').on(t.baseQuoteId, t.kind)],
);

/**
 * One payment for several orders (cart checkout, B2B invoice). Each order still has its
 * own `payments` row (provider_ref = `<group ref>#<n>`); the provider session / invoice
 * reference lives here and webhooks for it are fanned out per order.
 */
export const cartCheckouts = pgTable(
    'cart_checkouts',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('cartCheckout')),
        cartId: text('cart_id'),
        userId: text('user_id'),
        deviceHash: text('device_hash'),
        provider: paymentProviderEnum('provider').notNull(),
        providerRef: text('provider_ref').notNull(),
        mode: text('mode').$type<'card' | 'invoice'>().notNull().default('card'),
        orderIds: jsonb('order_ids').$type<string[]>().notNull(),
        amountCents: cents('amount_cents').notNull(),
        currency: text('currency').notNull().default('usd'),
        status: text('status').$type<'PENDING' | 'SUCCEEDED' | 'FAILED'>().notNull().default('PENDING'),
        failureReason: text('failure_reason'),
        /** HMAC of the confirmation-page token + the token sealed for redirects (like orders). */
        accessTokenHash: text('access_token_hash').notNull(),
        sealedToken: text('sealed_token').notNull(),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [uniqueIndex('cart_checkouts_provider_ref_uq').on(t.provider, t.providerRef)],
);

/** B2B "Pay by invoice (ACH / wire)". Production starts only when the invoice is paid. */
export const invoices = pgTable(
    'invoices',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('invoice')),
        checkoutId: text('checkout_id')
            .notNull()
            .references(() => cartCheckouts.id),
        provider: paymentProviderEnum('provider').notNull(),
        providerInvoiceId: text('provider_invoice_id').notNull(),
        status: text('status').$type<'open' | 'paid' | 'overdue' | 'void'>().notNull().default('open'),
        amountCents: cents('amount_cents').notNull(),
        currency: text('currency').notNull().default('usd'),
        netDays: integer('net_days').notNull(),
        dueDate: date('due_date', { mode: 'string' }).notNull(),
        hostedUrl: text('hosted_url'),
        buyerEmail: text('buyer_email').notNull(),
        company: text('company').notNull(),
        poNumber: text('po_number'),
        paidAt: tstz('paid_at'),
        /** Manual wire: who marked it received and the bank reference (audited). */
        markedPaidBy: text('marked_paid_by'),
        paidReference: text('paid_reference'),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [
        uniqueIndex('invoices_provider_invoice_uq').on(t.provider, t.providerInvoiceId),
        index('invoices_status_idx').on(t.status),
        check('invoices_status_ck', sql`${t.status} in ('open','paid','overdue','void')`),
    ],
);

/** Buyer ↔ shop/ops thread per order. */
export const orderMessages = pgTable(
    'order_messages',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('orderMessage')),
        orderId: text('order_id')
            .notNull()
            .references(() => orders.id, { onDelete: 'cascade' }),
        authorKind: text('author_kind').$type<'buyer' | 'shop' | 'ops' | 'system'>().notNull(),
        /** user id, shop id, 'ops' or 'system'. */
        authorId: text('author_id').notNull(),
        body: text('body').notNull(),
        quickReply: text('quick_reply'),
        attachmentKey: text('attachment_key'),
        createdAt: createdAt(),
    },
    (t) => [
        index('order_messages_order_idx').on(t.orderId, t.createdAt),
        check('order_messages_author_ck', sql`${t.authorKind} in ('buyer','shop','ops','system')`),
        check('order_messages_body_ck', sql`char_length(${t.body}) <= 2000`),
    ],
);

/** Per-party chat state: read marker + notification throttle. party = 'buyer' | 'shop' | 'ops'. */
export const orderChatState = pgTable(
    'order_chat_state',
    {
        orderId: text('order_id')
            .notNull()
            .references(() => orders.id, { onDelete: 'cascade' }),
        party: text('party').notNull(),
        lastReadAt: tstz('last_read_at'),
        lastNotifiedAt: tstz('last_notified_at'),
    },
    (t) => [uniqueIndex('order_chat_state_uq').on(t.orderId, t.party)],
);

/** "Hold production": a request ops must acknowledge. It never stops a job by itself. */
export const holdRequests = pgTable(
    'hold_requests',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('holdRequest')),
        orderId: text('order_id')
            .notNull()
            .references(() => orders.id, { onDelete: 'cascade' }),
        messageId: text('message_id'),
        status: text('status').$type<'requested' | 'acknowledged' | 'declined'>().notNull().default('requested'),
        note: text('note'),
        resolvedBy: text('resolved_by'),
        resolvedAt: tstz('resolved_at'),
        createdAt: createdAt(),
    },
    (t) => [index('hold_requests_status_idx').on(t.status, t.createdAt), index('hold_requests_order_idx').on(t.orderId)],
);

/** One rating per delivered order; public only once ops approve it. */
export const ratings = pgTable(
    'ratings',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('rating')),
        orderId: text('order_id')
            .notNull()
            .references(() => orders.id, { onDelete: 'cascade' }),
        shopId: text('shop_id').references(() => shops.id),
        userId: text('user_id'),
        stars: integer('stars').notNull(),
        tags: jsonb('tags').$type<string[]>().notNull().default([]),
        caption: text('caption'),
        photoKey: text('photo_key'),
        status: text('status').$type<'pending' | 'approved' | 'rejected'>().notNull().default('pending'),
        moderatedBy: text('moderated_by'),
        moderatedAt: tstz('moderated_at'),
        rejectReason: text('reject_reason'),
        createdAt: createdAt(),
    },
    (t) => [
        uniqueIndex('ratings_order_uq').on(t.orderId),
        index('ratings_status_idx').on(t.status, t.createdAt),
        index('ratings_shop_idx').on(t.shopId, t.status),
        check('ratings_stars_ck', sql`${t.stars} between 1 and 5`),
        check('ratings_status_ck', sql`${t.status} in ('pending','approved','rejected')`),
    ],
);
