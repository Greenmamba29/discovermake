/**
 * Address validation at checkout (non-blocking warnings + "Use suggested address").
 *
 * - CARRIER=easypost with EASYPOST_API_KEY: EasyPost address verification
 *   (POST /v2/addresses, verify[]=delivery). Corrections become the suggestion.
 * - Otherwise, or when EasyPost is unreachable: local heuristics
 *   (ZIP prefix vs state, PO box with freight, missing unit for multi-unit buildings).
 * Nothing here blocks checkout: the buyer may keep the address as typed.
 */
import type { Address } from '../../contracts/common';
import type { AddressCheckResponse, AddressWarning } from '../../contracts/prime';
import { env } from '../env';
import { zipState } from '../geo/us-geo';
import { EASYPOST_API_URL } from './easypost';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const PO_BOX = /\b(p\.?\s*o\.?\s*box|post\s+office\s+box|pob\s+\d)/i;
const MULTI_UNIT = /\b(apartments?|apts?|tower|towers|condos?|condominiums?|lofts?|suites?|plaza|residences|building|bldg|flats)\b/i;
const HAS_UNIT = /(#\s*\w+|\b(apt|apartment|unit|suite|ste|fl|floor|rm|room)\.?\s*[\w-]+)/i;

/** Pure local heuristics. */
export function heuristicAddressCheck(address: Address, opts: { freight?: boolean } = {}): AddressCheckResponse {
    const warnings: AddressWarning[] = [];
    let suggestion: Address | null = null;
    const st = zipState(address.postalCode);
    if (st && st !== address.region.toUpperCase()) {
        warnings.push({ code: 'ZIP_STATE_MISMATCH', message: `ZIP ${address.postalCode} is in ${st}, not ${address.region.toUpperCase()}. Check the ZIP code or the state.` });
        suggestion = { ...address, region: st };
    }
    const lines = `${address.line1} ${address.line2 ?? ''}`;
    if (opts.freight && PO_BOX.test(lines)) {
        warnings.push({ code: 'PO_BOX_FREIGHT', message: 'This order ships by freight, which cannot deliver to a PO box. Use a street address with someone to receive it.' });
    }
    if (!address.line2?.trim() && MULTI_UNIT.test(address.line1) && !HAS_UNIT.test(address.line1)) {
        warnings.push({ code: 'MISSING_UNIT', message: 'This looks like a multi-unit building. Add an apartment, suite or unit number so the carrier can deliver.' });
    }
    return { source: 'heuristic', warnings, suggestion };
}

type EasyPostVerifiedAddress = {
    street1?: string | null;
    street2?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    verifications?: { delivery?: { success?: boolean; errors?: { message?: string }[] } };
};

/** EasyPost verification with heuristic fallback (any error → heuristics). */
export async function checkAddress(address: Address, opts: { freight?: boolean; fetch?: FetchLike } = {}): Promise<AddressCheckResponse> {
    const local = heuristicAddressCheck(address, opts);
    const e = env();
    if (e.CARRIER !== 'easypost' || !e.EASYPOST_API_KEY) return local;
    try {
        const f = opts.fetch ?? fetch;
        const res = await f(`${EASYPOST_API_URL}/addresses`, {
            method: 'POST',
            headers: { authorization: `Basic ${Buffer.from(`${e.EASYPOST_API_KEY}:`).toString('base64')}`, 'content-type': 'application/json' },
            body: JSON.stringify({
                address: { street1: address.line1, street2: address.line2, city: address.city, state: address.region, zip: address.postalCode, country: 'US', company: address.company, name: address.name },
                verify: ['delivery'],
            }),
            signal: AbortSignal.timeout(4000),
        });
        if (!res.ok) return local;
        const v = (await res.json()) as EasyPostVerifiedAddress;
        const warnings: AddressWarning[] = local.warnings.filter((w) => w.code === 'PO_BOX_FREIGHT');
        const delivery = v.verifications?.delivery;
        if (delivery && delivery.success === false) {
            const why = delivery.errors?.map((x) => x.message).filter(Boolean).join('; ');
            warnings.push({ code: 'UNDELIVERABLE', message: `The carrier could not confirm this address${why ? ` (${why})` : ''}. Check it before paying.` });
            return { source: 'easypost', warnings, suggestion: null };
        }
        const suggested: Address = {
            ...address,
            line1: v.street1?.trim() || address.line1,
            line2: v.street2?.trim() || address.line2,
            city: v.city?.trim() || address.city,
            region: (v.state?.trim() || address.region).toUpperCase(),
            postalCode: v.zip?.trim() || address.postalCode,
        };
        const norm = (s: string | undefined) => (s ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
        const changed = (['line1', 'line2', 'city', 'region', 'postalCode'] as const).some((k) => norm(suggested[k]) !== norm(address[k]));
        if (changed) warnings.push({ code: 'CORRECTED', message: 'The carrier suggests a corrected version of this address.' });
        return { source: 'easypost', warnings, suggestion: changed ? suggested : null };
    } catch {
        return local;
    }
}
