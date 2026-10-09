/**
 * R3 "Prime" contracts: the Delivery Promise, supplier-route ordering (binding quotes from
 * supplier-confirmed offers, deposit + balance, the supplier fulfilment leg), route
 * comparison, shop stock and buyer credits. See docs/architecture/r3-prime.md.
 *
 * Buyer-facing views never carry the supplier's identity (name, platform, PO number):
 * only region, verification, price, dates and plain status sentences.
 *
 * Routes:
 *   POST /api/builds/:buildId/sourcing/offers/:offerId/quote            -> QuoteView (201, BINDING, routeKind 'supplier')
 *   GET  /api/builds/:buildId/routes?quote=<quoteId>                    -> RouteComparisonView
 *   POST /api/orders/:orderId/balance  (signed order token)             -> BalancePaymentView
 *   POST /api/shop/jobs/:jobId/receive (shop session)                   -> ShopJobDetail
 *   GET|POST /api/shop/stock, PATCH /api/shop/stock/:stockId            -> ShopStockView[] / ShopStockView
 *   POST /api/admin/supplier-legs/:legId/advance  AdvanceSupplierLegRequest -> SupplierLegOpsView
 *   GET|POST /api/admin/promise/retrain (admin or cron)                 -> RetrainPromiseResponse
 */
import { z } from 'zod';
import { Cents, IsoDate, IsoDateTime, ShopId, idOf } from './common';
import {
    CreditStatus,
    Incoterm,
    PaymentPlanKind,
    PromiseLeg,
    PromiseStatus,
    ShippingMethod,
    ShopStockKind,
    SupplierLegStatus,
    TrustLevel,
} from './enums';

export const SupplierLegId = idOf('supplierLeg');
export const ShopStockId = idOf('shopStock');
export const BuyerCreditId = idOf('buyerCredit');

// ---------------------------------------------------------------------------
// Delivery Promise
// ---------------------------------------------------------------------------

/** One leg's P90 prediction in days (business days, except MATERIAL_ARRIVAL: calendar days). */
export const PromiseLegPrediction = z.object({
    leg: PromiseLeg,
    /** The prior from the existing lead-time logic (what the leg "should" take). */
    priorDays: z.number().nonnegative(),
    /** Learned P90 slip on top of the prior (0 without data). */
    slipDays: z.number().nonnegative(),
    /** priorDays + slipDays. */
    p90Days: z.number().nonnegative(),
    source: z.enum(['prior', 'model']),
    /** Observations behind the model (0 for a prior). */
    sampleCount: z.number().int().nonnegative(),
    /** Model scope used, e.g. `shop:shop_x`, `carrier:STANDARD:Z3`, `*`. */
    scope: z.string(),
});
export type PromiseLegPrediction = z.infer<typeof PromiseLegPrediction>;

/** Promise for one shipping method on a quote (checkout shipping cards). */
export const QuotePromiseView = z.object({
    method: ShippingMethod,
    /** The date DiscoverMake commits to (the shipping option's delivery date). */
    date: IsoDate,
    /** Engine P90 arrival incl. the risk buffer. */
    p90Date: IsoDate,
    /** Show "Arrives <date>" only when p90Date <= date; otherwise show ship-date language. */
    show: z.boolean(),
});
export type QuotePromiseView = z.infer<typeof QuotePromiseView>;

/** Promise on a buyer order. */
export const OrderPromiseView = z.object({
    date: IsoDate,
    show: z.boolean(),
    status: PromiseStatus,
    /** Credit issued when the promise was missed. */
    creditCents: Cents.nullable(),
});
export type OrderPromiseView = z.infer<typeof OrderPromiseView>;

export const RetrainPromiseResponse = z.object({
    trainedAt: IsoDateTime,
    observationCount: z.number().int().nonnegative(),
    modelCount: z.number().int().nonnegative(),
    /** Holdout evaluation (every 5th observation by id hash is held out). */
    holdout: z.object({
        observations: z.number().int().nonnegative(),
        orders: z.number().int().nonnegative(),
        legHitRate: z.number().min(0).max(1).nullable(),
        orderHitRate: z.number().min(0).max(1).nullable(),
    }),
    /** Active orders whose remaining-leg P90 was rechecked; how many turned at risk. */
    recheck: z.object({ checked: z.number().int().nonnegative(), atRisk: z.number().int().nonnegative() }),
});
export type RetrainPromiseResponse = z.infer<typeof RetrainPromiseResponse>;

// ---------------------------------------------------------------------------
// Supplier route: binding quote, deposit/balance, fulfilment leg
// ---------------------------------------------------------------------------

/** Buyer-safe summary of a supplier-route quote (QuoteView.supplierRoute). */
export const QuoteSupplierRouteView = z.object({
    /** "Verified partner · Vietnam". Never the supplier's name or platform. */
    label: z.string(),
    country: z.string(),
    verified: z.boolean(),
    /** Partner who receives, inspects and ships to the buyer (null for direct ship). */
    receivingPartner: z.object({ name: z.string(), city: z.string(), region: z.string() }).nullable(),
    depositPct: z.number().min(0).max(1),
    assumptions: z.array(z.string()),
    excludedCosts: z.array(z.string()),
});
export type QuoteSupplierRouteView = z.infer<typeof QuoteSupplierRouteView>;

/** Ops-only composition of a supplier-route binding quote (stored on `supplier_quotes`). */
export const SupplierQuoteComposition = z.object({
    source: z.object({ offerId: z.string(), jobId: z.string(), supplierId: z.string(), selectionApprovalId: z.string() }),
    designVersion: z.number().int().positive(),
    quantity: z.number().int().positive(),
    createdAt: IsoDateTime,
    validUntil: IsoDateTime,
    confidence: z.number().min(0).max(1),
    supplierStatus: z.object({ verified: z.boolean(), country: z.string(), trustLevel: TrustLevel, incoterm: Incoterm, firstOrder: z.boolean() }),
    landed: z.object({
        goodsCents: Cents,
        toolingCents: Cents,
        freightCents: Cents,
        dutiesCents: Cents,
        totalCents: Cents,
    }),
    receivingFeeCents: Cents,
    marginPct: z.number().min(0),
    marginCents: Cents,
    risk: z.object({ score: z.number().min(0).max(1), tier: z.enum(['LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH']), reservePct: z.number().min(0), factors: z.array(z.string()) }),
    riskReserveCents: Cents,
    roundingCents: Cents,
    subtotalCents: Cents,
    unitPriceCents: Cents,
    assumptions: z.array(z.string()),
    excludedCosts: z.array(z.string()),
});
export type SupplierQuoteComposition = z.infer<typeof SupplierQuoteComposition>;

/** One step of the buyer's supplier-route tracker ("one plain status sentence per step"). */
export const SupplierRouteStep = z.object({
    key: z.enum(['PO_PLACED', 'IN_PRODUCTION_AT_SUPPLIER', 'SHIPPED_INBOUND', 'RECEIVED_AT_PARTNER', 'SHIPPED_TO_YOU', 'DELIVERED']),
    sentence: z.string(),
    state: z.enum(['done', 'current', 'upcoming', 'failed']),
    at: IsoDateTime.nullable(),
});
export type SupplierRouteStep = z.infer<typeof SupplierRouteStep>;

/** Buyer view of the money + leg of a supplier-route order (OrderView.supplierRoute). */
export const OrderSupplierRouteView = z.object({
    label: z.string(),
    legStatus: SupplierLegStatus.nullable(),
    directShip: z.boolean(),
    steps: z.array(SupplierRouteStep),
    payment: z.object({
        kind: PaymentPlanKind,
        depositCents: Cents,
        balanceCents: Cents,
        creditCents: Cents,
        depositPaid: z.boolean(),
        balancePaid: z.boolean(),
        /** Present while the balance is due: the hosted payment page for it. */
        balancePayUrl: z.string().url().nullable(),
    }),
});
export type OrderSupplierRouteView = z.infer<typeof OrderSupplierRouteView>;

export const BalancePaymentView = z.object({
    orderId: z.string(),
    amountCents: Cents,
    currency: z.string(),
    providerRef: z.string(),
    redirectUrl: z.string().url(),
});
export type BalancePaymentView = z.infer<typeof BalancePaymentView>;

/** Ops view of a supplier fulfilment leg (Sourcing desk job detail). */
export const SupplierLegOpsView = z.object({
    id: SupplierLegId,
    orderId: z.string(),
    orderNumber: z.string(),
    status: SupplierLegStatus,
    poNumber: z.string(),
    supplier: z.object({ id: z.string(), name: z.string(), country: z.string() }),
    offerId: z.string(),
    incoterm: Incoterm,
    directShip: z.boolean(),
    inboundCarrier: z.string().nullable(),
    inboundTracking: z.string().nullable(),
    receivingShop: z.object({ id: ShopId, name: z.string() }).nullable(),
    receivingJobId: z.string().nullable(),
    supplierDeposit: z.object({ approvalId: z.string().nullable(), status: z.string(), amountCents: Cents }),
    preShipmentInspection: z.enum(['PASS', 'FAIL']).nullable(),
    /** Statuses ops may move the leg to now (supplier-side updates). */
    allowedNext: z.array(SupplierLegStatus),
    history: z.array(z.object({ status: SupplierLegStatus, at: IsoDateTime, note: z.string().nullable() })),
    createdAt: IsoDateTime,
});
export type SupplierLegOpsView = z.infer<typeof SupplierLegOpsView>;

export const AdvanceSupplierLegRequest = z.object({
    to: SupplierLegStatus,
    inboundCarrier: z.string().trim().min(1).max(80).optional(),
    inboundTracking: z.string().trim().min(1).max(120).optional(),
    /** Direct ship only: a pre-shipment inspection at origin (third-party or supplier report reviewed by ops). */
    preShipmentInspection: z.enum(['PASS', 'FAIL']).optional(),
    note: z.string().trim().max(1000).optional(),
});
export type AdvanceSupplierLegRequest = z.infer<typeof AdvanceSupplierLegRequest>;

export const ReceiveFreightRequest = z.object({
    note: z.string().trim().max(500).optional(),
});
export type ReceiveFreightRequest = z.infer<typeof ReceiveFreightRequest>;

// ---------------------------------------------------------------------------
// Route comparison (Manufacturing Route: Suppliers · Processes · Impact)
// ---------------------------------------------------------------------------

export const RouteCandidateView = z.object({
    id: z.string(),
    kind: z.enum(['shop', 'supplier']),
    /** Partner shops show their name (R1 rule); suppliers only "Verified partner · Vietnam". */
    label: z.string(),
    location: z.string(),
    trustLevel: TrustLevel,
    totalCents: Cents,
    unitCents: Cents,
    quantity: z.number().int().positive(),
    /** P90 arrival date from the Delivery Promise engine. */
    arrivesBy: IsoDate,
    /** 0..1 (rating / verification). */
    quality: z.number().min(0).max(1),
    rating: z.number().nullable(),
    verified: z.boolean(),
    co2Kg: z.number().nonnegative(),
    filledFromStock: z.boolean(),
    capabilities: z.array(z.string()),
    certifications: z.array(z.string()),
    /** Lower is better. */
    score: z.number(),
    recommended: z.boolean(),
    orderable: z.boolean(),
});
export type RouteCandidateView = z.infer<typeof RouteCandidateView>;

export const RouteComparisonView = z.object({
    quoteId: z.string(),
    candidates: z.array(RouteCandidateView),
    recommendedId: z.string().nullable(),
    weights: z.object({ cost: z.number(), date: z.number(), quality: z.number(), co2: z.number() }),
    processes: z.array(z.object({ step: z.string(), detail: z.string() })),
    impact: z.object({
        materialKgCo2e: z.number().nonnegative(),
        method: z.string(),
    }),
});
export type RouteComparisonView = z.infer<typeof RouteComparisonView>;

// ---------------------------------------------------------------------------
// Shop stock
// ---------------------------------------------------------------------------

export const ShopStockView = z.object({
    id: ShopStockId,
    kind: ShopStockKind,
    sku: z.string(),
    description: z.string(),
    materialId: z.string().nullable(),
    thicknessOptionId: z.string().nullable(),
    quantity: z.number().int().nonnegative(),
    unit: z.string(),
    updatedAt: IsoDateTime,
});
export type ShopStockView = z.infer<typeof ShopStockView>;

export const UpsertShopStockRequest = z.object({
    kind: ShopStockKind,
    sku: z
        .string()
        .trim()
        .min(1)
        .max(80)
        .regex(/^[A-Za-z0-9._-]+$/, 'letters, digits, dot, dash or underscore'),
    description: z.string().trim().min(1).max(200),
    thicknessOptionId: idOf('thickness').optional(),
    quantity: z.number().int().nonnegative().max(1_000_000),
    unit: z.enum(['sheet', 'pcs', 'box']).default('sheet'),
});
export type UpsertShopStockRequest = z.infer<typeof UpsertShopStockRequest>;

export const UpdateShopStockRequest = z.object({ quantity: z.number().int().nonnegative().max(1_000_000) });
export type UpdateShopStockRequest = z.infer<typeof UpdateShopStockRequest>;

// ---------------------------------------------------------------------------
// Buyer credits
// ---------------------------------------------------------------------------

export const BuyerCreditView = z.object({
    id: BuyerCreditId,
    amountCents: Cents,
    status: CreditStatus,
    reason: z.string(),
    createdAt: IsoDateTime,
});
export type BuyerCreditView = z.infer<typeof BuyerCreditView>;
