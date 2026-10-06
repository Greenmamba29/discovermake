/**
 * Shipment + tracking contracts (shared by Shop Console, buyer tracker, admin).
 *
 * POST /api/shop/jobs/:jobId/shipment              CreateShipmentRequest -> ShipmentView (201)
 * POST /api/admin/shipments/:shipmentId/delivered  MarkDeliveredRequest  -> ShipmentView
 * POST /api/webhooks/easypost                      raw EasyPost event (HMAC-verified) -> { received: true }
 */
import { z } from 'zod';
import { CarrierProviderName, ShipmentStatus } from './enums';
import { IsoDate, IsoDateTime, ShipmentId } from './common';

export const Parcel = z.object({
    lengthIn: z.number().positive().max(108),
    widthIn: z.number().positive().max(108),
    heightIn: z.number().positive().max(108),
    weightOz: z.number().positive().max(2400),
});
export type Parcel = z.infer<typeof Parcel>;

export const TrackingEvent = z.object({
    status: ShipmentStatus,
    message: z.string(),
    location: z.string().nullable(),
    occurredAt: IsoDateTime,
});
export type TrackingEvent = z.infer<typeof TrackingEvent>;

export const CreateShipmentRequest = z
    .object({
        parcel: Parcel,
        /**
         * CARRIER=manual only: the shop bought the label elsewhere and enters it here.
         * CARRIER=easypost: omit; the platform buys the label for the quote's shipping method.
         */
        manual: z
            .object({
                carrier: z.string().trim().min(2).max(40), // "UPS"
                service: z.string().trim().min(2).max(60), // "Ground"
                trackingNumber: z.string().trim().min(6).max(64),
                trackingUrl: z.string().url().optional(),
            })
            .optional(),
    })
    .strict();
export type CreateShipmentRequest = z.infer<typeof CreateShipmentRequest>;

export const MarkDeliveredRequest = z.object({
    deliveredAt: IsoDateTime.optional(),
    note: z.string().trim().max(500).optional(),
});
export type MarkDeliveredRequest = z.infer<typeof MarkDeliveredRequest>;

export const ShipmentView = z.object({
    id: ShipmentId,
    orderId: z.string(),
    jobId: z.string(),
    provider: CarrierProviderName,
    carrier: z.string(),
    service: z.string(),
    trackingNumber: z.string(),
    trackingUrl: z.string().url().nullable(),
    /** Short-lived signed URL to the label PDF/PNG (shop + admin views only; null in buyer view). */
    labelUrl: z.string().url().nullable(),
    status: ShipmentStatus,
    events: z.array(TrackingEvent),
    estimatedDeliveryDate: IsoDate.nullable(),
    shippedAt: IsoDateTime.nullable(),
    deliveredAt: IsoDateTime.nullable(),
    createdAt: IsoDateTime,
});
export type ShipmentView = z.infer<typeof ShipmentView>;
