/**
 * EasyPost carrier adapter (REST via fetch; no SDK dependency).
 *
 * Labels:   POST /v2/shipments (addresses + parcel + reference) -> pick a rate for the
 *           order's shipping method -> POST /v2/shipments/:id/buy.
 * Tracking: tracker webhooks (`tracker.created` / `tracker.updated`) verified with
 *           `X-Hmac-Signature: hmac-sha256-hex=<HMAC-SHA256(EASYPOST_WEBHOOK_SECRET, raw body)>`.
 * Auth:     HTTP Basic with the API key as username (EASYPOST_API_KEY).
 */
import { createHmac } from 'node:crypto';
import type { Address } from '../../contracts/common';
import type { ShipmentStatus, ShippingMethod } from '../../contracts/enums';
import { safeEqual } from '../auth/tokens';
import { ApiError } from '../http';
import { WebhookSignatureError, type BuyLabelInput, type BuyLabelResult, type CarrierAdapter, type TrackingUpdate } from './types';

export const EASYPOST_API_URL = 'https://api.easypost.com/v2';

export type EasyPostRate = {
    id: string;
    carrier: string;
    service: string;
    rate: string;
    currency?: string;
    delivery_days?: number | null;
    delivery_date?: string | null;
};

type EasyPostShipment = {
    id: string;
    rates?: EasyPostRate[];
    selected_rate?: EasyPostRate | null;
    tracking_code?: string | null;
    tracker?: { public_url?: string | null; est_delivery_date?: string | null } | null;
    postage_label?: { label_url?: string | null } | null;
    messages?: { message?: string }[];
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function epAddress(a: Address) {
    return {
        name: a.name,
        company: a.company,
        street1: a.line1,
        street2: a.line2,
        city: a.city,
        state: a.region,
        zip: a.postalCode,
        country: a.country,
        phone: a.phone,
    };
}

const dollarsToCents = (rate: string) => Math.round(Number.parseFloat(rate) * 100);

/**
 * Pick the rate for the buyer's paid shipping method:
 *   STANDARD  cheapest rate
 *   EXPEDITED cheapest rate delivering in <= 3 days (else the fastest)
 *   EXPRESS   cheapest rate delivering in <= 1 day (else the fastest)
 */
export function selectRate(rates: EasyPostRate[], method: ShippingMethod): EasyPostRate | null {
    const valid = rates.filter((r) => Number.isFinite(Number.parseFloat(r.rate)));
    if (!valid.length) return null;
    const cheapest = (list: EasyPostRate[]) => [...list].sort((a, b) => Number.parseFloat(a.rate) - Number.parseFloat(b.rate))[0] ?? null;
    if (method === 'STANDARD') return cheapest(valid);
    const maxDays = method === 'EXPRESS' ? 1 : 3;
    const qualifying = valid.filter((r) => typeof r.delivery_days === 'number' && r.delivery_days <= maxDays);
    if (qualifying.length) return cheapest(qualifying);
    const known = valid.filter((r) => typeof r.delivery_days === 'number');
    if (known.length) return [...known].sort((a, b) => (a.delivery_days as number) - (b.delivery_days as number) || Number.parseFloat(a.rate) - Number.parseFloat(b.rate))[0];
    return cheapest(valid);
}

const TRACKER_STATUS: Record<string, ShipmentStatus> = {
    pre_transit: 'LABEL_CREATED',
    in_transit: 'IN_TRANSIT',
    available_for_pickup: 'OUT_FOR_DELIVERY',
    out_for_delivery: 'OUT_FOR_DELIVERY',
    delivered: 'DELIVERED',
    return_to_sender: 'RETURNED',
    failure: 'EXCEPTION',
    error: 'EXCEPTION',
    cancelled: 'CANCELLED',
};

/** EasyPost's documented signature: HMAC-SHA256 over the raw body with the NFKD-normalized secret. */
export function easyPostSignature(secret: string, rawBody: string): string {
    return `hmac-sha256-hex=${createHmac('sha256', secret.normalize('NFKD')).update(rawBody, 'utf8').digest('hex')}`;
}

export class EasyPostCarrier implements CarrierAdapter {
    readonly name = 'easypost' as const;

    constructor(
        private readonly opts: { apiKey: string | undefined; webhookSecret: string | undefined; fetch?: FetchLike; baseUrl?: string },
    ) {}

    private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
        if (!this.opts.apiKey) throw new Error('CARRIER=easypost requires EASYPOST_API_KEY');
        const f = this.opts.fetch ?? fetch;
        const res = await f(`${this.opts.baseUrl ?? EASYPOST_API_URL}${path}`, {
            method,
            headers: {
                authorization: `Basic ${Buffer.from(`${this.opts.apiKey}:`).toString('base64')}`,
                'content-type': 'application/json',
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await res.text();
        let data: unknown = null;
        try {
            data = text ? JSON.parse(text) : null;
        } catch {
            data = null;
        }
        if (!res.ok) {
            const msg = (data as { error?: { message?: string } } | null)?.error?.message ?? text.slice(0, 300);
            throw new ApiError('CONFLICT', `EasyPost ${method} ${path} failed (HTTP ${res.status}): ${msg}`, 502);
        }
        return data as T;
    }

    async buyLabel(input: BuyLabelInput): Promise<BuyLabelResult> {
        if (input.manual) {
            throw new ApiError('VALIDATION_FAILED', 'CARRIER=easypost buys the label for the paid shipping method; do not send manual tracking details');
        }
        const shipment = await this.call<EasyPostShipment>('POST', '/shipments', {
            shipment: {
                to_address: epAddress(input.to),
                from_address: epAddress(input.from),
                parcel: { length: input.parcel.lengthIn, width: input.parcel.widthIn, height: input.parcel.heightIn, weight: input.parcel.weightOz },
                reference: input.reference,
                options: { label_format: 'PDF', print_custom_1: input.reference },
            },
        });
        const rate = selectRate(shipment.rates ?? [], input.method);
        if (!rate) {
            const why = shipment.messages?.map((m) => m.message).filter(Boolean).join('; ');
            throw new ApiError('CONFLICT', `No carrier rate is available for this parcel${why ? `: ${why}` : ''}`);
        }
        const bought = await this.call<EasyPostShipment>('POST', `/shipments/${encodeURIComponent(shipment.id)}/buy`, { rate: { id: rate.id } });
        const selected = bought.selected_rate ?? rate;
        if (!bought.tracking_code) throw new Error(`EasyPost shipment ${bought.id} was bought without a tracking code`);
        const edd = selected.delivery_date ?? bought.tracker?.est_delivery_date ?? null;
        return {
            providerShipmentId: bought.id,
            carrier: selected.carrier,
            service: selected.service,
            trackingNumber: bought.tracking_code,
            trackingUrl: bought.tracker?.public_url ?? null,
            labelUrl: bought.postage_label?.label_url ?? null,
            rateCents: dollarsToCents(selected.rate),
            estimatedDeliveryDate: edd ? new Date(edd).toISOString().slice(0, 10) : null,
        };
    }

    async parseTrackingWebhook(rawBody: string, headers: Headers): Promise<TrackingUpdate | null> {
        const secret = this.opts.webhookSecret;
        if (!secret) throw new WebhookSignatureError('EASYPOST_WEBHOOK_SECRET is not configured; refusing unverified webhooks');
        const presented = headers.get('x-hmac-signature');
        if (!presented || !safeEqual(presented.trim(), easyPostSignature(secret, rawBody))) {
            throw new WebhookSignatureError('Invalid EasyPost webhook signature');
        }
        let body: {
            id?: string;
            description?: string;
            result?: {
                object?: string;
                id?: string;
                tracking_code?: string;
                status?: string;
                shipment_id?: string | null;
                updated_at?: string;
                tracking_details?: { message?: string; status?: string; datetime?: string; tracking_location?: { city?: string | null; state?: string | null } | null }[];
            };
        };
        try {
            body = JSON.parse(rawBody);
        } catch {
            throw new WebhookSignatureError('Webhook body is not JSON');
        }
        const result = body.result;
        if (!body.id || !result || result.object !== 'Tracker' || !result.tracking_code) return null;
        if (body.description !== 'tracker.updated' && body.description !== 'tracker.created') return null;
        const status = result.status ? TRACKER_STATUS[result.status] : undefined;
        if (!status) return null;
        const details = result.tracking_details ?? [];
        const last = details[details.length - 1];
        const loc = last?.tracking_location;
        const location = loc && (loc.city || loc.state) ? [loc.city, loc.state].filter(Boolean).join(', ') : null;
        const when = last?.datetime ?? result.updated_at ?? new Date().toISOString();
        const occurredAt = Number.isNaN(new Date(when).getTime()) ? new Date().toISOString() : new Date(when).toISOString();
        return {
            eventId: body.id,
            providerShipmentId: result.shipment_id ?? null,
            trackingNumber: result.tracking_code,
            event: { status, message: last?.message ?? result.status ?? status, location, occurredAt },
        };
    }
}
