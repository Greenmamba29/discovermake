/**
 * Manual carrier (CARRIER=manual): TEST DOUBLE. The shop bought the label elsewhere
 * and types carrier + service + tracking number into the Shop Console. Delivery is
 * confirmed by ops (POST /api/admin/shipments/:id/delivered or /api/admin/orders/:id/delivered).
 * Refuses to run when NODE_ENV=production.
 */
import { assertNotProduction } from '../env';
import { ApiError } from '../http';
import type { BuyLabelInput, BuyLabelResult, CarrierAdapter, TrackingUpdate } from './types';

const TRACKING_URLS: Record<string, (n: string) => string> = {
    UPS: (n) => `https://www.ups.com/track?tracknum=${encodeURIComponent(n)}`,
    USPS: (n) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(n)}`,
    FEDEX: (n) => `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(n)}`,
    DHL: (n) => `https://www.dhl.com/us-en/home/tracking/tracking-express.html?tracking-id=${encodeURIComponent(n)}`,
};

/** Public tracking page for well-known carriers; null when unknown. */
export function publicTrackingUrl(carrier: string, trackingNumber: string): string | null {
    const key = carrier.replace(/[^a-z]/gi, '').toUpperCase();
    const fn = TRACKING_URLS[key];
    return fn ? fn(trackingNumber) : null;
}

export class ManualCarrier implements CarrierAdapter {
    readonly name = 'manual' as const;

    constructor() {
        assertNotProduction('Manual carrier (CARRIER=manual)');
    }

    async buyLabel(input: BuyLabelInput): Promise<BuyLabelResult> {
        assertNotProduction('Manual carrier (CARRIER=manual)');
        if (!input.manual) {
            throw new ApiError('VALIDATION_FAILED', 'CARRIER=manual: enter the carrier, service and tracking number of the label you bought');
        }
        const { carrier, service, trackingNumber, trackingUrl } = input.manual;
        return {
            providerShipmentId: null,
            carrier,
            service,
            trackingNumber,
            trackingUrl: trackingUrl ?? publicTrackingUrl(carrier, trackingNumber),
            labelUrl: null,
            rateCents: null,
            estimatedDeliveryDate: null,
        };
    }

    /** Manual shipments have no tracking webhooks. */
    async parseTrackingWebhook(): Promise<TrackingUpdate | null> {
        return null;
    }
}
