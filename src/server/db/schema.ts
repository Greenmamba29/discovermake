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
    boolean,
    check,
    date,
    doublePrecision,
    index,
    integer,
    jsonb,
    pgEnum,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
    uuid,
} from 'drizzle-orm/pg-core';
import {
    BUILD_STATUSES,
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
} from '../../contracts/enums';
import type { Address } from '../../contracts/common';
import type { DfmResult, PartFeatures, PartPreview } from '../../contracts/parts';
import type { QuoteConfig, QuoteConfigSummary, QuoteLadderRung, QuoteLineItem, ShippingOption } from '../../contracts/quotes';
import type { InspectionCheck, InspectionMeasurement, JobPacket } from '../../contracts/shop';
import type { Parcel, TrackingEvent } from '../../contracts/shipments';
import type { PassportSnapshot } from '../../contracts/passport';
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

/** One Build per uploaded part in R1 (ADR-0001 Build Graph tables arrive in R2). */
export const builds = pgTable(
    'builds',
    {
        id: text('id').primaryKey().$defaultFn(() => newId('build')),
        displayId: text('display_id').notNull(),
        name: text('name').notNull(),
        status: buildStatusEnum('status').notNull().default('DRAFT'),
        ownerEmail: text('owner_email'),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [uniqueIndex('builds_display_id_uq').on(t.displayId)],
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
