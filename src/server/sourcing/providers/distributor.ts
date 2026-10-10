/**
 * Catalog distributor provider.
 *
 * `MouserDistributor` calls the Mouser Search API v1 keyword search
 * (`POST https://api.mouser.com/api/v1/search/keyword?apiKey=<MOUSER_API_KEY>`, body
 * `{ SearchByKeywordRequest: { keyword, records, startingRecord, searchOptions, searchWithYourSignUpLanguage } }`),
 * and normalizes `SearchResults.Parts[]` (MouserPartNumber, Description, AvailabilityInStock,
 * LeadTime "N Days", PriceBreaks[{ Quantity, Price "$0.10", Currency }], ProductDetailUrl).
 * Mouser publishes the API to registered customers; the key is an owner input.
 *
 * Unconfigured (no MOUSER_API_KEY) the provider is disabled and the adapter is never called.
 * `FixtureDistributor` is a deterministic local catalog for tests only (refuses production).
 */
import { assertNotProduction, env } from '../../env';
import type { CatalogDistributorAdapter, ProviderOffer, ProviderRequest, SourcingProvider } from './types';

export const MOUSER_KEYWORD_URL = 'https://api.mouser.com/api/v1/search/keyword';
/** Days for in-stock distributor parts to reach a partner shop (ground). */
export const DISTRIBUTOR_STOCK_LEAD_DAYS = 3;

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

type MouserPart = {
    MouserPartNumber?: string;
    ManufacturerPartNumber?: string;
    Description?: string;
    AvailabilityInStock?: string | null;
    LeadTime?: string | null;
    PriceBreaks?: { Quantity?: number; Price?: string; Currency?: string }[];
    ProductDetailUrl?: string | null;
};

/** "$1,234.56" -> 123456 cents; null when unparseable. */
export function parsePriceCents(price: string | undefined): number | null {
    if (!price) return null;
    const n = Number(price.replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

/** Unit price at `quantity`: the largest price break whose quantity is <= the order quantity. */
export function priceAtQuantity(breaks: MouserPart['PriceBreaks'], quantity: number): number | null {
    const usable = (breaks ?? []).filter((b) => (b.Currency ?? 'USD').toUpperCase() === 'USD' && typeof b.Quantity === 'number' && b.Quantity <= quantity).sort((a, b) => (b.Quantity ?? 0) - (a.Quantity ?? 0));
    return parsePriceCents(usable[0]?.Price ?? breaks?.[0]?.Price);
}

/** Normalize a Mouser keyword-search response. Pure. */
export function parseMouserResponse(body: unknown, request: ProviderRequest): ProviderOffer[] {
    const b = body as { Errors?: { Message?: string }[]; SearchResults?: { Parts?: MouserPart[] } } | null;
    if (b?.Errors?.length) throw new Error(`Mouser: ${b.Errors.map((e) => e.Message ?? 'error').join('; ')}`);
    const parts = b?.SearchResults?.Parts ?? [];
    return parts
        .filter((p) => p.MouserPartNumber)
        .map((p) => {
            const inStock = Number((p.AvailabilityInStock ?? '0').replace(/[^0-9]/g, '')) || 0;
            const lead = Number((p.LeadTime ?? '').match(/(\d+)/)?.[1] ?? NaN);
            return {
                provider: 'mouser',
                source: 'mouser',
                sku: p.MouserPartNumber as string,
                description: p.Description ?? p.ManufacturerPartNumber ?? (p.MouserPartNumber as string),
                unitPriceCents: priceAtQuantity(p.PriceBreaks, request.quantity),
                availableQuantity: inStock,
                leadDays: inStock >= request.quantity ? DISTRIBUTOR_STOCK_LEAD_DAYS : Number.isFinite(lead) ? lead + DISTRIBUTOR_STOCK_LEAD_DAYS : 60,
                shopId: null,
                url: p.ProductDetailUrl ?? null,
            };
        });
}

export class MouserDistributor implements CatalogDistributorAdapter {
    readonly name = 'mouser';

    constructor(
        private readonly opts: { apiKey?: string; fetch?: FetchLike; timeoutMs?: number } = {},
    ) {}

    private key(): string | undefined {
        return this.opts.apiKey ?? env().MOUSER_API_KEY;
    }

    isConfigured(): boolean {
        return Boolean(this.key());
    }

    async search(request: ProviderRequest): Promise<ProviderOffer[]> {
        const key = this.key();
        if (!key) throw new Error('Mouser is not configured (MOUSER_API_KEY)');
        const doFetch: FetchLike = this.opts.fetch ?? ((url, init) => fetch(url, init));
        const url = `${MOUSER_KEYWORD_URL}?apiKey=${encodeURIComponent(key)}`;
        const res = await doFetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({
                SearchByKeywordRequest: { keyword: (request.sku ?? request.description).slice(0, 100), records: 10, startingRecord: 0, searchOptions: 'InStock', searchWithYourSignUpLanguage: 'false' },
            }),
            signal: AbortSignal.timeout(this.opts.timeoutMs ?? 8000),
        });
        if (!res.ok) throw new Error(`Mouser search failed with HTTP ${res.status}`);
        return parseMouserResponse(await res.json(), request);
    }
}

/** Deterministic local catalog. Tests only. */
export class FixtureDistributor implements CatalogDistributorAdapter {
    readonly name = 'fixture';
    static readonly CATALOG: readonly { sku: string; description: string; unitPriceCents: number; inStock: number; leadDays: number }[] = [
        { sku: 'FIX-PEM-M4', description: 'M4 self-clinching nut, steel, zinc', unitPriceCents: 18, inStock: 5000, leadDays: 2 },
        { sku: 'FIX-SCREW-M4X10', description: 'M4 x 10 socket head cap screw, stainless', unitPriceCents: 9, inStock: 12000, leadDays: 2 },
        { sku: 'FIX-LED-STRIP-1M', description: 'LED strip 24 V, 1 m, warm white', unitPriceCents: 1450, inStock: 40, leadDays: 4 },
    ];

    constructor() {
        assertNotProduction('fixture distributor');
    }

    isConfigured(): boolean {
        return true;
    }

    async search(request: ProviderRequest): Promise<ProviderOffer[]> {
        const q = (request.sku ?? request.description).toLowerCase();
        return FixtureDistributor.CATALOG.filter((p) => p.sku.toLowerCase() === q || p.description.toLowerCase().includes(q)).map((p) => ({
            provider: 'fixture',
            source: 'fixture',
            sku: p.sku,
            description: p.description,
            unitPriceCents: p.unitPriceCents,
            availableQuantity: p.inStock,
            leadDays: p.inStock >= request.quantity ? p.leadDays : p.leadDays + 21,
            shopId: null,
            url: null,
        }));
    }
}

/** Wraps a distributor adapter as a SourcingProvider: disabled (and never called) when unconfigured. */
export class CatalogDistributorProvider implements SourcingProvider {
    readonly mode = 'instant' as const;

    constructor(private readonly adapter: CatalogDistributorAdapter) {}

    get name(): string {
        return `distributor:${this.adapter.name}`;
    }

    isEnabled(): boolean {
        return this.adapter.isConfigured();
    }

    async findOffers(request: ProviderRequest): Promise<ProviderOffer[]> {
        if (!this.isEnabled()) return [];
        return this.adapter.search(request);
    }
}
