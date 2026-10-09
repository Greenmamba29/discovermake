/**
 * Live carrier rates at quote time (R3). When CARRIER=easypost and EASYPOST_API_KEY is set,
 * the binding shipping options come from EasyPost rates for the quote's parcel (rated, never
 * bought), cached per parcel + zone for 15 minutes; otherwise, or on any carrier error, the
 * versioned rate table (src/server/quote/shipping.ts) is used unchanged.
 *
 * The destination is unknown at quote time, so rates are taken to a reference ZIP in the
 * middle of the country (worst-case-ish zone for ground) and the platform absorbs variance,
 * exactly like the table. Freight-sized orders always use the table's LTL option.
 */
import type { ShippingMethod } from '../../contracts/enums';
import type { ShippingOption } from '../../contracts/quotes';
import { env } from '../env';
import { addBusinessDays } from '../quote/leadtime';
import { billableWeightKg, PARCEL_MAX_KG, SHIPPING_RATES, shippingOptions, type ShippingInput } from '../quote/shipping';
import { EASYPOST_API_URL, selectRate, type EasyPostRate } from './easypost';

export const LIVE_RATE_TTL_MS = 15 * 60 * 1000;
/** Reference destination for quote-time rating (Lawrence, KS: geographic middle of the lower 48). */
export const REFERENCE_DEST_ZIP = '66044';
/** Handling margin on carrier rates. */
export const LIVE_RATE_MARKUP = 1.1;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type CacheEntry = { at: number; rates: EasyPostRate[] };
const cache = new Map<string, CacheEntry>();

export function clearLiveRateCache(): void {
    cache.clear();
}

const roundUp50 = (cents: number) => Math.ceil(cents / 50) * 50;

/** Parcel (inches / ounces) from the same dimensional model as the rate table. */
export function parcelFor(input: ShippingInput): { lengthIn: number; widthIn: number; heightIn: number; weightOz: number } {
    const cmToIn = (cm: number) => Math.max(1, Math.round((cm / 2.54) * 10) / 10);
    const lengthCm = (Math.max(input.bboxWidthMm, input.bboxHeightMm) + 50) / 10;
    const widthCm = (Math.min(input.bboxWidthMm, input.bboxHeightMm) + 50) / 10;
    const heightCm = (input.thicknessMm * input.quantity * 1.2 + 40) / 10;
    const actualKg = (input.unitMassG * input.quantity * 1.1) / 1000 + 0.3;
    return { lengthIn: cmToIn(lengthCm), widthIn: cmToIn(widthCm), heightIn: cmToIn(heightCm), weightOz: Math.max(1, Math.round(actualKg * 35.274 * 10) / 10) };
}

export function zoneKey(fromZip: string, toZip: string): string {
    return `${fromZip.slice(0, 3)}>${toZip.slice(0, 3)}`;
}

/** Map carrier rates onto our three methods (null when a method has no rate). */
export function optionsFromRates(rates: EasyPostRate[], shipDate: string): ShippingOption[] | null {
    const out: ShippingOption[] = [];
    for (const table of SHIPPING_RATES) {
        const rate = selectRate(rates, table.method as ShippingMethod);
        if (!rate) return null;
        const cents = roundUp50(Math.round(Number.parseFloat(rate.rate) * 100 * LIVE_RATE_MARKUP));
        const days = typeof rate.delivery_days === 'number' && rate.delivery_days > 0 ? rate.delivery_days : table.transitDays;
        out.push({ method: table.method, label: `${table.method === 'STANDARD' ? 'Standard' : table.method === 'EXPEDITED' ? 'Expedited' : 'Express'} · ${rate.carrier} ${rate.service}`, priceCents: cents, transitDays: days, deliveryDate: addBusinessDays(shipDate, days) });
    }
    // Faster methods must never be cheaper than slower ones in the same quote.
    for (let i = 1; i < out.length; i++) if (out[i].priceCents < out[i - 1].priceCents) out[i].priceCents = out[i - 1].priceCents;
    return out;
}

/** Binding shipping options for a quote: live EasyPost rates when configured, else the table. */
export async function quoteShippingOptions(input: ShippingInput, opts: { fromZip: string | null | undefined; toZip?: string; fetch?: FetchLike; now?: number } = { fromZip: null }): Promise<ShippingOption[]> {
    const table = shippingOptions(input);
    const e = env();
    if (e.CARRIER !== 'easypost' || !e.EASYPOST_API_KEY || !opts.fromZip) return table;
    if (billableWeightKg(input) > PARCEL_MAX_KG) return table;
    const parcel = parcelFor(input);
    const toZip = opts.toZip ?? REFERENCE_DEST_ZIP;
    const key = `${parcel.lengthIn}x${parcel.widthIn}x${parcel.heightIn}:${parcel.weightOz}|${zoneKey(opts.fromZip, toZip)}`;
    const now = opts.now ?? Date.now();
    let rates = cache.get(key);
    if (!rates || now - rates.at > LIVE_RATE_TTL_MS) {
        try {
            const f = opts.fetch ?? fetch;
            const res = await f(`${EASYPOST_API_URL}/shipments`, {
                method: 'POST',
                headers: { authorization: `Basic ${Buffer.from(`${e.EASYPOST_API_KEY}:`).toString('base64')}`, 'content-type': 'application/json' },
                body: JSON.stringify({
                    shipment: {
                        from_address: { zip: opts.fromZip, country: 'US' },
                        to_address: { zip: toZip, country: 'US' },
                        parcel: { length: parcel.lengthIn, width: parcel.widthIn, height: parcel.heightIn, weight: parcel.weightOz },
                    },
                }),
                signal: AbortSignal.timeout(5000),
            });
            if (!res.ok) return table;
            const body = (await res.json()) as { rates?: EasyPostRate[] };
            if (!body.rates?.length) return table;
            rates = { at: now, rates: body.rates };
            cache.set(key, rates);
        } catch {
            return table;
        }
    }
    return optionsFromRates(rates.rates, input.shipDate) ?? table;
}
