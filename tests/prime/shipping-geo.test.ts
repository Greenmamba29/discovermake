import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '@/server/env';
import { distanceKm, greatCirclePath, interpolate } from '@/server/geo/great-circle';
import { routeProgress, statusSentence } from '@/server/geo/tracking-map';
import { geocodeUs, zipState } from '@/server/geo/us-geo';
import { checkAddress, heuristicAddressCheck } from '@/server/shipping/address-check';
import { clearLiveRateCache, LIVE_RATE_TTL_MS, quoteShippingOptions } from '@/server/shipping/live-rates';
import { shippingOptions } from '@/server/quote/shipping';

const ADDRESS = { name: 'Ada', line1: '100 Market St', city: 'Philadelphia', region: 'PA', postalCode: '19106', country: 'US' as const };

describe('offline geocoding + great circle', () => {
    it('maps ZIP prefixes to states and geocodes cities, falling back to the state centroid', () => {
        expect(zipState('19106')).toBe('PA');
        expect(zipState('94105-1234')).toBe('CA');
        expect(zipState('08102')).toBe('NJ');
        expect(zipState('99999')).toBe('AK');
        expect(zipState('abcde')).toBeNull();
        expect(geocodeUs({ city: 'San Francisco', region: 'CA' })).toMatchObject({ precision: 'city', state: 'CA' });
        expect(geocodeUs({ city: 'Smallville', region: 'KS' })).toMatchObject({ precision: 'state', state: 'KS' });
        expect(geocodeUs({ city: 'Nowhere', region: null, postalCode: '73301' })).toMatchObject({ state: 'TX' });
        expect(geocodeUs({})).toBeNull();
    });

    it('draws a great-circle line with sane distances', () => {
        const phl = geocodeUs({ city: 'Philadelphia', region: 'PA' })!;
        const sf = geocodeUs({ city: 'San Francisco', region: 'CA' })!;
        const km = distanceKm(phl, sf);
        expect(km).toBeGreaterThan(4000);
        expect(km).toBeLessThan(4200);
        const path = greatCirclePath(phl, sf, 32);
        expect(path).toHaveLength(33);
        expect(path[0]).toEqual([Math.round(phl.lng * 1e5) / 1e5, Math.round(phl.lat * 1e5) / 1e5]);
        // The great circle bows north of the straight lat/lng line in the northern hemisphere.
        const mid = interpolate(phl, sf, 0.5);
        expect(mid.lat).toBeGreaterThan((phl.lat + sf.lat) / 2);
    });

    it('estimates progress and writes one plain status sentence', () => {
        const base = { carrier: 'UPS', estimatedDeliveryDate: '2026-10-16', deliveredAt: null, shippedAt: new Date('2026-10-12T12:00:00Z'), createdAt: new Date('2026-10-12T10:00:00Z') };
        expect(routeProgress({ ...base, status: 'LABEL_CREATED' })).toBeLessThan(0.1);
        const mid = routeProgress({ ...base, status: 'IN_TRANSIT' }, new Date('2026-10-14T14:30:00Z'));
        expect(mid).toBeGreaterThan(0.3);
        expect(mid).toBeLessThan(0.7);
        expect(routeProgress({ ...base, status: 'DELIVERED' })).toBe(1);
        expect(statusSentence({ ...base, status: 'IN_TRANSIT' }, 'Austin')).toBe('On the way with UPS · arrives Fri, Oct 16');
        expect(statusSentence({ ...base, status: 'OUT_FOR_DELIVERY' }, 'Austin')).toBe('Out for delivery in Austin today');
    });
});

describe('address heuristics', () => {
    it('warns on ZIP vs state, PO box with freight, missing unit; never blocks', () => {
        expect(heuristicAddressCheck(ADDRESS).warnings).toEqual([]);
        const mismatch = heuristicAddressCheck({ ...ADDRESS, region: 'NJ' });
        expect(mismatch.warnings.map((w) => w.code)).toEqual(['ZIP_STATE_MISMATCH']);
        expect(mismatch.suggestion?.region).toBe('PA');
        expect(heuristicAddressCheck({ ...ADDRESS, line1: 'PO Box 123' }, { freight: true }).warnings.map((w) => w.code)).toEqual(['PO_BOX_FREIGHT']);
        expect(heuristicAddressCheck({ ...ADDRESS, line1: 'P.O. Box 123' }).warnings).toEqual([]);
        expect(heuristicAddressCheck({ ...ADDRESS, line1: '200 Riverside Towers' }).warnings.map((w) => w.code)).toEqual(['MISSING_UNIT']);
        expect(heuristicAddressCheck({ ...ADDRESS, line1: '200 Riverside Towers Apt 4B' }).warnings).toEqual([]);
        expect(heuristicAddressCheck({ ...ADDRESS, line1: '200 Riverside Towers', line2: 'Unit 9' }).warnings).toEqual([]);
    });

    it('uses heuristics without EasyPost (CARRIER=manual in tests)', async () => {
        const r = await checkAddress({ ...ADDRESS, region: 'NJ' });
        expect(r.source).toBe('heuristic');
    });
});

describe('live carrier rates at quote time', () => {
    const input = { shipDate: '2026-10-15', unitMassG: 120, quantity: 10, bboxWidthMm: 120, bboxHeightMm: 80, thicknessMm: 2.3 };
    afterEach(() => {
        delete process.env.EASYPOST_API_KEY;
        process.env.CARRIER = 'manual';
        resetEnvCache();
        clearLiveRateCache();
    });

    it('falls back to the rate table without EasyPost', async () => {
        expect(await quoteShippingOptions(input, { fromZip: '19122' })).toEqual(shippingOptions(input));
    });

    it('uses EasyPost rates when configured, caches 15 min per parcel + zone, and falls back on errors', async () => {
        process.env.CARRIER = 'easypost';
        process.env.EASYPOST_API_KEY = 'EZTK_test';
        resetEnvCache();
        const rates = [
            { id: 'r1', carrier: 'USPS', service: 'GroundAdvantage', rate: '8.10', delivery_days: 4 },
            { id: 'r2', carrier: 'UPS', service: '2ndDayAir', rate: '21.40', delivery_days: 2 },
            { id: 'r3', carrier: 'UPS', service: 'NextDayAir', rate: '44.00', delivery_days: 1 },
        ];
        const fetchOk = vi.fn(async () => new Response(JSON.stringify({ id: 'shp_x', rates }), { status: 200 }));
        const now = Date.now();
        const live = await quoteShippingOptions(input, { fromZip: '19122', fetch: fetchOk, now });
        expect(live.map((o) => [o.method, o.priceCents, o.transitDays])).toEqual([
            ['STANDARD', 900, 4],
            ['EXPEDITED', 2400, 2],
            ['EXPRESS', 4850, 1],
        ]);
        await quoteShippingOptions(input, { fromZip: '19133', fetch: fetchOk, now: now + 1000 }); // same zone (191) -> cached
        expect(fetchOk).toHaveBeenCalledTimes(1);
        await quoteShippingOptions(input, { fromZip: '19122', fetch: fetchOk, now: now + LIVE_RATE_TTL_MS + 1 });
        expect(fetchOk).toHaveBeenCalledTimes(2);

        clearLiveRateCache();
        const failing = vi.fn(async () => new Response('nope', { status: 500 }));
        expect(await quoteShippingOptions(input, { fromZip: '19122', fetch: failing })).toEqual(shippingOptions(input));
        const throwing = vi.fn(async () => {
            throw new Error('network down');
        });
        expect(await quoteShippingOptions(input, { fromZip: '19122', fetch: throwing })).toEqual(shippingOptions(input));
    });
});
