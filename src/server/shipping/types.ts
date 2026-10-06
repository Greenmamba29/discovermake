import type { Address } from '../../contracts/common';
import type { CarrierProviderName, ShippingMethod } from '../../contracts/enums';
import type { Parcel, TrackingEvent } from '../../contracts/shipments';

export type BuyLabelInput = {
    from: Address;
    to: Address;
    parcel: Parcel;
    method: ShippingMethod;
    /** Our reference printed on the label (order number). */
    reference: string;
    /** Manual adapter only: what the shop entered. */
    manual?: { carrier: string; service: string; trackingNumber: string; trackingUrl?: string };
};

export type BuyLabelResult = {
    providerShipmentId: string | null;
    carrier: string;
    service: string;
    trackingNumber: string;
    trackingUrl: string | null;
    labelUrl: string | null;
    rateCents: number | null;
    estimatedDeliveryDate: string | null; // YYYY-MM-DD
};

export type TrackingUpdate = {
    /** Provider event id for webhook idempotency. */
    eventId: string;
    providerShipmentId: string | null;
    trackingNumber: string;
    event: TrackingEvent;
};

export interface CarrierAdapter {
    readonly name: CarrierProviderName;
    buyLabel(input: BuyLabelInput): Promise<BuyLabelResult>;
    /** Verify + normalize a tracking webhook. @throws Error on signature failure. Returns null for irrelevant events. */
    parseTrackingWebhook(rawBody: string, headers: Headers): Promise<TrackingUpdate | null>;
}

export class WebhookSignatureError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'WebhookSignatureError';
    }
}
