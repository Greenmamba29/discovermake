/**
 * Buyer order view (tracker + production screens).
 *
 * GET /api/orders/:orderId   auth: signed order token via `x-order-token` header or `?t=` query
 *                            -> OrderView
 *
 * The UI polls this every ~3 s while the order is active (acceptance: milestones
 * visible to the buyer within 5 s). Every timeline entry comes from a real
 * domain_events row; nothing here is fabricated client-side.
 */
import { z } from 'zod';
import { InspectionOutcome, OrderStatus, OrderType, ShippingMethod, UniversalStatus } from './enums';
import { Address, BuildDisplayId, BuildId, Cents, IsoDate, IsoDateTime, OrderId, QuoteId } from './common';
import { QuoteConfigSummary } from './quotes';
import { PartPreview } from './parts';
import { MilestoneView } from './shop';
import { ShipmentView } from './shipments';

export const ORDER_TOKEN_HEADER = 'x-order-token';
export const ORDER_TOKEN_QUERY = 't';

/** Tracker stepper keys (workflow 04 · screen 06). */
export const TRACKING_STEPS = ['DESIGN', 'MATERIALS', 'PRODUCTION', 'QA', 'SHIPPING', 'DELIVERED'] as const;
export const TrackingStepKey = z.enum(TRACKING_STEPS);
export type TrackingStepKey = z.infer<typeof TrackingStepKey>;

export const TrackingStep = z.object({
    key: TrackingStepKey,
    label: z.string(),
    state: z.enum(['done', 'current', 'upcoming', 'failed']),
    at: IsoDateTime.nullable(),
});
export type TrackingStep = z.infer<typeof TrackingStep>;

export const TimelineEntry = z.object({
    eventId: z.string(),
    eventType: z.string(),
    /** Plain-language sentence, e.g. "Cutting started at Philadelphia Precision Works". */
    label: z.string(),
    actorKind: z.string(),
    at: IsoDateTime,
});
export type TimelineEntry = z.infer<typeof TimelineEntry>;

export const OrderView = z.object({
    id: OrderId,
    orderNumber: z.string(),
    status: OrderStatus,
    universalStatus: UniversalStatus,
    /** One plain-language status sentence (Uber rule), e.g. "Cutting now · Ships Thu". */
    statusLabel: z.string(),
    /** 0..100 */
    progressPct: z.number().int().min(0).max(100),
    orderType: OrderType,
    build: z.object({ id: BuildId, displayId: BuildDisplayId, name: z.string() }),
    quoteId: QuoteId,
    designVersion: z.number().int().positive(),
    summary: QuoteConfigSummary,
    preview: PartPreview.nullable(),
    unitPriceCents: Cents,
    subtotalCents: Cents,
    shippingCents: Cents,
    taxCents: Cents,
    totalCents: Cents,
    currency: z.string(),
    shippingMethod: ShippingMethod,
    shippingAddress: Address,
    buyer: z.object({ name: z.string(), email: z.string() }),
    promisedShipDate: IsoDate,
    steps: z.array(TrackingStep).length(TRACKING_STEPS.length),
    timeline: z.array(TimelineEntry),
    shop: z
        .object({
            name: z.string(),
            city: z.string(),
            region: z.string(),
            rating: z.number().nullable(),
        })
        .nullable(),
    milestones: z.array(MilestoneView),
    inspection: z
        .object({
            outcome: InspectionOutcome,
            at: IsoDateTime,
        })
        .nullable(),
    shipment: ShipmentView.nullable(),
    passport: z
        .object({
            id: z.string(),
            url: z.string().url(),
            activatedAt: IsoDateTime,
        })
        .nullable(),
    createdAt: IsoDateTime,
    paidAt: IsoDateTime.nullable(),
    deliveredAt: IsoDateTime.nullable(),
});
export type OrderView = z.infer<typeof OrderView>;
