/**
 * Instant quote contracts.
 *
 * POST /api/quotes          CreateQuoteRequest -> QuoteView   (201)
 * GET  /api/quotes/:quoteId                    -> QuoteView
 *
 * A quote is an IMMUTABLE snapshot. Changing any option creates a new quote.
 * Invariants the quote engine guarantees:
 * - sum(lineItems[].totalCents) === subtotalCents
 * - subtotalCents === unitPriceCents * quantity, except when the minimum order
 *   value applies (then a MINIMUM_ORDER line item makes up the difference)
 * - every ladder rung is priced with the same config + rate card as the quote itself
 * - shippingOptions prices are binding for this quote (checkout reads them from the snapshot)
 */
import { z } from 'zod';
import { QuoteRouteKind, QuoteStatus, QuoteTier, ShippingMethod, TrustLevel } from './enums';
import {
    BuildId,
    Cents,
    IsoDate,
    IsoDateTime,
    MaterialId,
    PartId,
    QuoteId,
    ServiceId,
    ThicknessOptionId,
} from './common';
import { DfmResult } from './parts';
import { QuotePromiseView, QuoteSupplierRouteView } from './promise';

export const MAX_QUOTE_QUANTITY = 5000;

export const QuoteServiceSelection = z.object({
    serviceId: ServiceId,
    /** Per-part feature count for PER_FEATURE services (e.g. 4 tapped holes). Ignored otherwise. */
    featureCount: z.number().int().positive().max(500).optional(),
    /** Service-specific option, e.g. `{ thread: "M4" }`. */
    options: z.record(z.string()).optional(),
});
export type QuoteServiceSelection = z.infer<typeof QuoteServiceSelection>;

/** What the buyer configured. Stored verbatim as `quotes.config`. Ids only, never prices. */
export const QuoteConfig = z.object({
    partId: PartId,
    materialId: MaterialId,
    thicknessOptionId: ThicknessOptionId,
    /** Optional single finish (FINISH service). */
    finishServiceId: ServiceId.nullable().default(null),
    /** Secondary ops (SECONDARY_OP services), incl. bending when the part has bend lines. */
    services: z.array(QuoteServiceSelection).max(10).default([]),
    quantity: z.number().int().positive().max(MAX_QUOTE_QUANTITY),
    /**
     * R6: 'print' = a printed part priced by the print quote engine (src/server/quote/printing):
     * `materialId` is a print material (`mat_print_*`), `thicknessOptionId` its layer profile
     * (`thk_print_*`). Absent = 'sheet' (the R1 laser engine). POST /api/quotes only makes sheet quotes.
     */
    process: z.enum(['sheet', 'print']).optional(),
});
export type QuoteConfig = z.infer<typeof QuoteConfig>;

export const CreateQuoteRequest = QuoteConfig;
export type CreateQuoteRequest = z.input<typeof CreateQuoteRequest>;

export const QUOTE_LINE_CODES = [
    'MATERIAL',
    'CUTTING',
    'BENDING',
    'SECONDARY',
    'FINISHING',
    'HANDLING',
    'QA',
    'PACKAGING',
    'SETUP',
    'PLATFORM_FEE',
    'MINIMUM_ORDER',
    // R3 supplier-route quotes (buyer-safe: no supplier identity in labels)
    'PARTNER_PRODUCTION',
    'TOOLING',
    'FREIGHT_DUTIES',
    'RECEIVING_QA',
    'DELIVERY_GUARANTEE',
    // R6 printed parts
    'PRINTING',
    'POST_PROCESSING',
] as const;
export const QuoteLineCode = z.enum(QUOTE_LINE_CODES);
export type QuoteLineCode = z.infer<typeof QuoteLineCode>;

export const QuoteLineItem = z.object({
    code: QuoteLineCode,
    label: z.string(),
    /** One-sentence ⓘ explainer shown next to the fee. */
    explainer: z.string(),
    unitCents: Cents,
    quantity: z.number().int().positive(),
    totalCents: Cents,
});
export type QuoteLineItem = z.infer<typeof QuoteLineItem>;

export const QuoteLadderRung = z.object({
    quantity: z.number().int().positive(),
    tier: QuoteTier,
    unitPriceCents: Cents,
    totalCents: Cents,
    shipDate: IsoDate,
    /** Percent saved per unit vs. quantity 1 (0..100, integer). */
    savingsPct: z.number().int().min(0).max(100),
});
export type QuoteLadderRung = z.infer<typeof QuoteLadderRung>;

export const ShippingOption = z.object({
    method: ShippingMethod,
    label: z.string(), // "Standard (UPS Ground)"
    priceCents: Cents,
    /** Estimated delivery date = shipDate + transit days. */
    deliveryDate: IsoDate,
    transitDays: z.number().int().positive(),
});
export type ShippingOption = z.infer<typeof ShippingOption>;

/** Human-readable labels for the locked summary (Approve screen, order view, passport). */
export const QuoteConfigSummary = z.object({
    materialName: z.string(),
    thicknessLabel: z.string(),
    processName: z.string(),
    finishName: z.string().nullable(),
    serviceNames: z.array(z.string()),
    quantity: z.number().int().positive(),
    partFilename: z.string(),
    bboxWidthMm: z.number().nonnegative(),
    bboxHeightMm: z.number().nonnegative(),
    /** Estimated mass per part (g), from net area x thickness x density. */
    unitMassG: z.number().nonnegative(),
});
export type QuoteConfigSummary = z.infer<typeof QuoteConfigSummary>;

/** The recommended manufacturing route the quote was priced on (Screen 03). Buyer-safe: no shop costs. */
export const QuoteRoute = z.object({
    shopId: z.string(),
    shopName: z.string(),
    city: z.string(),
    region: z.string(),
    rating: z.number().nullable(),
    processName: z.string(),
    machineLabel: z.string().nullable(),
    certifications: z.array(z.string()),
});
export type QuoteRoute = z.infer<typeof QuoteRoute>;

export const QuoteView = z.object({
    id: QuoteId,
    partId: PartId,
    buildId: BuildId,
    designVersion: z.number().int().positive(),
    config: QuoteConfig,
    summary: QuoteConfigSummary,
    route: QuoteRoute,
    tier: QuoteTier,
    lineItems: z.array(QuoteLineItem),
    ladder: z.array(QuoteLadderRung),
    shippingOptions: z.array(ShippingOption).min(1),
    unitPriceCents: Cents,
    subtotalCents: Cents,
    currency: z.string(),
    trustLevel: TrustLevel,
    status: QuoteStatus,
    /** true iff status === READY && trustLevel === BINDING && now < validUntil. */
    orderable: z.boolean(),
    shipDate: IsoDate,
    leadTimeDays: z.number().int().positive(),
    validUntil: IsoDateTime,
    rulesetVersion: z.string(),
    pricingVersion: z.string(),
    dfm: DfmResult,
    createdAt: IsoDateTime,
    /** R3: 'supplier' = BINDING quote built from a supplier-confirmed offer (deposit + balance). Absent = 'shop'. */
    routeKind: QuoteRouteKind.optional(),
    /** R3: buyer-safe supplier route summary (supplier quotes only). */
    supplierRoute: QuoteSupplierRouteView.optional(),
    /** R3: Delivery Promise per shipping method ("Arrives <date>" only when its P90 fits). */
    promise: z.array(QuotePromiseView).optional(),
});
export type QuoteView = z.infer<typeof QuoteView>;

/** Tier from quantity (Instant Quote screen): 1-9 PROTOTYPE, 10-249 SMALL_BATCH, 250+ PRODUCTION_RUN. */
export function tierForQuantity(quantity: number): QuoteTier {
    if (quantity < 10) return 'PROTOTYPE';
    if (quantity < 250) return 'SMALL_BATCH';
    return 'PRODUCTION_RUN';
}

/** Quantities shown on the price ladder (workflow 02). */
export const LADDER_QUANTITIES = [1, 10, 25, 50, 100, 250] as const;
