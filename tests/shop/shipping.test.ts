import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { orders, passports, shipments, webhookEvents } from '@/server/db/schema';
import { resetEnvCache } from '@/server/env';
import { applyTrackingUpdate, archiveShipmentLabel, labelUrlFor, EasyPostCarrier, easyPostSignature, getCarrier, ManualCarrier, processCarrierWebhook, selectRate, WebhookSignatureError } from '@/server/shipping';
import { createShipment } from '@/server/shops';
import { POST as easypostWebhook } from '@/app/api/webhooks/easypost/route';
import { useTestDb } from '../support/db';
import { createQaPassedJob, quietConsole } from './fixtures';

const FROM = { name: 'Shop', line1: '1600 N 5th St', city: 'Philadelphia', region: 'PA', postalCode: '19122', country: 'US' as const };
const TO = { name: 'Ada', line1: '100 Market St', city: 'Philadelphia', region: 'PA', postalCode: '19106', country: 'US' as const };
const parcel = { lengthIn: 10, widthIn: 8, heightIn: 2, weightOz: 24 };

function trackerEvent(id: string, trackingCode: string, status: string, datetime: string) {
    return JSON.stringify({
        id,
        object: 'Event',
        description: 'tracker.updated',
        result: {
            object: 'Tracker',
            id: 'trk_123',
            tracking_code: trackingCode,
            status,
            shipment_id: null,
            tracking_details: [{ message: status === 'delivered' ? 'Delivered, front door' : 'Departed facility', status, datetime, tracking_location: { city: 'Philadelphia', state: 'PA' } }],
        },
    });
}

describe('EasyPost adapter (no network)', () => {
    it('selects a rate per paid shipping method', () => {
        const rates = [
            { id: 'r1', carrier: 'USPS', service: 'GroundAdvantage', rate: '7.10', delivery_days: 5 },
            { id: 'r2', carrier: 'UPS', service: '2ndDayAir', rate: '21.40', delivery_days: 2 },
            { id: 'r3', carrier: 'UPS', service: 'NextDayAir', rate: '48.00', delivery_days: 1 },
            { id: 'r4', carrier: 'FedEx', service: 'Express2Day', rate: '19.90', delivery_days: 2 },
        ];
        expect(selectRate(rates, 'STANDARD')?.id).toBe('r1');
        expect(selectRate(rates, 'EXPEDITED')?.id).toBe('r4');
        expect(selectRate(rates, 'EXPRESS')?.id).toBe('r3');
        expect(selectRate([], 'STANDARD')).toBeNull();
    });

    it('buys a label through the REST API with basic auth', async () => {
        const calls: { url: string; init?: RequestInit }[] = [];
        const fake = async (url: string, init?: RequestInit) => {
            calls.push({ url, init });
            if (url.endsWith('/shipments')) {
                return new Response(JSON.stringify({ id: 'shp_ep1', rates: [{ id: 'rate_1', carrier: 'USPS', service: 'GroundAdvantage', rate: '8.25', delivery_days: 4 }] }), { status: 200 });
            }
            return new Response(
                JSON.stringify({
                    id: 'shp_ep1',
                    tracking_code: '9400100000000000000000',
                    selected_rate: { id: 'rate_1', carrier: 'USPS', service: 'GroundAdvantage', rate: '8.25', delivery_date: '2026-10-10T00:00:00Z' },
                    tracker: { public_url: 'https://track.easypost.com/djE6dHJrXzEyMw' },
                    postage_label: { label_url: 'https://easypost-files.s3.amazonaws.com/files/postage_label/label.pdf' },
                }),
                { status: 200 },
            );
        };
        const carrier = new EasyPostCarrier({ apiKey: 'EZTK_test', webhookSecret: 's', fetch: fake });
        const label = await carrier.buyLabel({ from: FROM, to: TO, parcel, method: 'STANDARD', reference: 'DMO-ABC123' });
        expect(label).toMatchObject({ providerShipmentId: 'shp_ep1', carrier: 'USPS', trackingNumber: '9400100000000000000000', rateCents: 825, estimatedDeliveryDate: '2026-10-10' });
        expect(calls[0].url).toBe('https://api.easypost.com/v2/shipments');
        expect((calls[0].init?.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from('EZTK_test:').toString('base64')}`);
        expect(JSON.parse(String(calls[0].init?.body)).shipment.to_address.zip).toBe('19106');
        expect(calls[1].url).toBe('https://api.easypost.com/v2/shipments/shp_ep1/buy');
        await expect(carrier.buyLabel({ from: FROM, to: TO, parcel, method: 'STANDARD', reference: 'x', manual: { carrier: 'UPS', service: 'G', trackingNumber: '123456' } })).rejects.toMatchObject({
            code: 'VALIDATION_FAILED',
        });
    });

    it('verifies tracker webhook signatures and normalizes the event', async () => {
        const carrier = new EasyPostCarrier({ apiKey: 'k', webhookSecret: 'whsec_test' });
        const body = trackerEvent('evt_1', 'TRK1', 'in_transit', '2026-10-08T15:00:00Z');
        const ok = await carrier.parseTrackingWebhook(body, new Headers({ 'x-hmac-signature': easyPostSignature('whsec_test', body) }));
        expect(ok).toEqual({
            eventId: 'evt_1',
            providerShipmentId: null,
            trackingNumber: 'TRK1',
            event: { status: 'IN_TRANSIT', message: 'Departed facility', location: 'Philadelphia, PA', occurredAt: '2026-10-08T15:00:00.000Z' },
        });
        await expect(carrier.parseTrackingWebhook(body, new Headers({ 'x-hmac-signature': easyPostSignature('wrong', body) }))).rejects.toBeInstanceOf(WebhookSignatureError);
        await expect(carrier.parseTrackingWebhook(body, new Headers())).rejects.toBeInstanceOf(WebhookSignatureError);
        await expect(new EasyPostCarrier({ apiKey: 'k', webhookSecret: undefined }).parseTrackingWebhook(body, new Headers())).rejects.toBeInstanceOf(WebhookSignatureError);
    });

    it('manual carrier refuses to run in production', () => {
        const prev = process.env.NODE_ENV;
        (process.env as Record<string, string>).NODE_ENV = 'production';
        try {
            expect(() => new ManualCarrier()).toThrow(/production/);
        } finally {
            (process.env as Record<string, string | undefined>).NODE_ENV = prev;
        }
    });
});

describe('tracking updates drive delivery', () => {
    const ctx = useTestDb({ seed: true });
    beforeAll(() => quietConsole());
    afterEach(() => {
        process.env.CARRIER = 'manual';
        delete process.env.EASYPOST_WEBHOOK_SECRET;
        resetEnvCache();
    });

    it('applies in-transit and delivered updates idempotently; delivered completes the order', async () => {
        const job = await createQaPassedJob(ctx.db);
        const s = await createShipment(job.shopId, job.jobId, { parcel, manual: { carrier: 'UPS', service: 'Ground', trackingNumber: '1ZTRACKING0001' } });
        const transit = { eventId: 'evt_t1', providerShipmentId: null, trackingNumber: '1ZTRACKING0001', event: { status: 'IN_TRANSIT' as const, message: 'Departed facility', location: 'Philadelphia, PA', occurredAt: new Date().toISOString() } };
        await applyTrackingUpdate(transit);
        await applyTrackingUpdate(transit);
        let [row] = await ctx.db.select().from(shipments).where(eq(shipments.id, s.id));
        expect(row.status).toBe('IN_TRANSIT');
        expect(row.events.filter((e) => e.status === 'IN_TRANSIT')).toHaveLength(1);

        await applyTrackingUpdate({ ...transit, eventId: 'evt_t2', event: { ...transit.event, status: 'DELIVERED', message: 'Delivered' } });
        [row] = await ctx.db.select().from(shipments).where(eq(shipments.id, s.id));
        expect(row.status).toBe('DELIVERED');
        const [o] = await ctx.db.select().from(orders).where(eq(orders.id, job.order.id));
        expect(o.status).toBe('COMPLETE');
        expect(await ctx.db.select().from(passports).where(eq(passports.orderId, job.order.id))).toHaveLength(1);
    });

    it('only downloads labels from carrier hosts and refuses redirects elsewhere or oversized files', async () => {
        const job = await createQaPassedJob(ctx.db);
        const s = await createShipment(job.shopId, job.jobId, { parcel, manual: { carrier: 'USPS', service: 'Priority', trackingNumber: '9400LABEL0002' } });
        const calls: string[] = [];

        // A non-carrier host is never fetched.
        await ctx.db.update(shipments).set({ provider: 'easypost', labelUrl: 'https://169.254.169.254/latest/meta-data' }).where(eq(shipments.id, s.id));
        const never = (async (url: string | URL | Request) => {
            calls.push(String(url));
            return new Response('x');
        }) as typeof fetch;
        expect(await archiveShipmentLabel(s.id, never)).toBeNull();
        expect(calls).toEqual([]);

        // A carrier URL that redirects to an internal address is rejected.
        const providerUrl = 'https://easypost-files.s3.amazonaws.com/files/postage_label/redirect.pdf';
        await ctx.db.update(shipments).set({ labelUrl: providerUrl }).where(eq(shipments.id, s.id));
        const redirecting = (async (url: string | URL | Request) => {
            calls.push(String(url));
            return new Response(null, { status: 302, headers: { location: 'http://10.0.0.5/secret' } });
        }) as typeof fetch;
        await expect(archiveShipmentLabel(s.id, redirecting)).rejects.toThrow(/allowed carrier host/);
        expect(calls).toEqual([providerUrl]);

        // A label larger than the cap is rejected while streaming.
        const huge = (async () => new Response(new Uint8Array(11 * 1024 * 1024), { status: 200, headers: { 'content-type': 'application/pdf' } })) as typeof fetch;
        await expect(archiveShipmentLabel(s.id, huge)).rejects.toThrow(/too large/);
        const [row] = await ctx.db.select().from(shipments).where(eq(shipments.id, s.id));
        expect(row.labelKey).toBeNull();
    });

    it('copies a purchased label into our storage and serves it only as a short-lived signed link', async () => {
        const job = await createQaPassedJob(ctx.db);
        const s = await createShipment(job.shopId, job.jobId, { parcel, manual: { carrier: 'USPS', service: 'Priority', trackingNumber: '9400LABEL0001' } });
        const providerUrl = 'https://easypost-files.s3.amazonaws.com/files/postage_label/label.pdf';
        await ctx.db.update(shipments).set({ provider: 'easypost', labelUrl: providerUrl }).where(eq(shipments.id, s.id));
        const pdf = new TextEncoder().encode('%PDF-1.4 label');
        const fetchFn = (async (url: string | URL | Request) => {
            expect(String(url)).toBe(providerUrl);
            return new Response(pdf, { status: 200, headers: { 'content-type': 'application/pdf' } });
        }) as typeof fetch;

        const key = await archiveShipmentLabel(s.id, fetchFn);
        expect(key).toBe(`labels/${s.id}.pdf`);
        expect(await archiveShipmentLabel(s.id, fetchFn)).toBe(key); // idempotent
        const [row] = await ctx.db.select().from(shipments).where(eq(shipments.id, s.id));
        expect(row.labelKey).toBe(key);
        const link = await labelUrlFor(row);
        expect(link).toMatch(new RegExp(`^http://localhost:3100/api/storage/local/labels/${s.id}\\.pdf\\?`));
        expect(link).not.toContain('easypost-files');
        const { getStorage } = await import('@/server/storage');
        expect((await getStorage().getObject(key!))?.toString('utf8')).toBe('%PDF-1.4 label');
    });

    it('POST /api/webhooks/easypost verifies, dedupes and delivers', async () => {
        process.env.CARRIER = 'easypost';
        process.env.EASYPOST_WEBHOOK_SECRET = 'whsec_route';
        resetEnvCache();
        expect(getCarrier().name).toBe('easypost');

        const job = await createQaPassedJob(ctx.db);
        // Label recorded by the manual adapter; the tracker is matched by tracking number.
        process.env.CARRIER = 'manual';
        resetEnvCache();
        await createShipment(job.shopId, job.jobId, { parcel, manual: { carrier: 'USPS', service: 'Priority', trackingNumber: '9400TRACK0002' } });
        process.env.CARRIER = 'easypost';
        resetEnvCache();

        const body = trackerEvent('evt_route_1', '9400TRACK0002', 'delivered', new Date(Date.now() - 60_000).toISOString());
        const call = (sig: string) =>
            easypostWebhook(new Request('http://localhost:3100/api/webhooks/easypost', { method: 'POST', headers: { 'x-hmac-signature': sig, 'content-type': 'application/json' }, body }), {
                params: Promise.resolve({}),
            });

        expect((await call('hmac-sha256-hex=deadbeef')).status).toBe(401);
        const ok = await call(easyPostSignature('whsec_route', body));
        expect(ok.status).toBe(200);
        expect(await ok.json()).toEqual({ received: true });
        const [o] = await ctx.db.select().from(orders).where(eq(orders.id, job.order.id));
        expect(o.status).toBe('COMPLETE');
        const hooks = await ctx.db.select().from(webhookEvents).where(eq(webhookEvents.eventId, 'evt_route_1'));
        expect(hooks).toHaveLength(1);
        expect(hooks[0].processedAt).not.toBeNull();
        expect(await processCarrierWebhook(body, new Headers({ 'x-hmac-signature': easyPostSignature('whsec_route', body) }))).toEqual({ status: 'duplicate' });
    });
});
