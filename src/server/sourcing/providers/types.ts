/**
 * Sourcing providers (workflow 03 "Other providers", ADR-0005): one interface, different
 * transports. Instant providers answer synchronously (partner shop stock, catalog distributors);
 * the async provider (Accio Work over the MCP bridge) works a queued job and offers arrive later.
 */
export type ProviderRequest = {
    kind: 'SHEET' | 'HARDWARE';
    /** Free text the provider can search on, e.g. "M4 PEM nut" or "5052 aluminum .063 sheet". */
    description: string;
    /** Exact SKU / manufacturer part number when known. */
    sku?: string;
    /** Catalog thickness option for sheet stock. */
    thicknessOptionId?: string;
    quantity: number;
};

export type ProviderOffer = {
    provider: string;
    /** Where it comes from: `shop:<shopId>` for partner stock, the distributor name otherwise. */
    source: string;
    sku: string;
    description: string;
    /** Unit price in cents when the provider publishes one (partner stock is priced by the rate card). */
    unitPriceCents: number | null;
    availableQuantity: number;
    /** Calendar days until it can be at the shop (0 = on the shelf there). */
    leadDays: number;
    shopId: string | null;
    url: string | null;
};

export interface SourcingProvider {
    readonly name: string;
    /** instant: answers now; async: works a queued job (offers arrive through the bridge). */
    readonly mode: 'instant' | 'async';
    /** Disabled providers are never called. */
    isEnabled(): boolean;
    findOffers(request: ProviderRequest): Promise<ProviderOffer[]>;
}

/** A catalog distributor's partner API (fasteners, electronics, raw stock). */
export interface CatalogDistributorAdapter {
    readonly name: string;
    isConfigured(): boolean;
    search(request: ProviderRequest): Promise<ProviderOffer[]>;
}

/** Fastest first: on-hand at a partner shop, then shortest lead, then cheapest, then source. */
export function rankOffers(offers: readonly ProviderOffer[]): ProviderOffer[] {
    return [...offers].sort(
        (a, b) => a.leadDays - b.leadDays || (a.unitPriceCents ?? Number.MAX_SAFE_INTEGER) - (b.unitPriceCents ?? Number.MAX_SAFE_INTEGER) || a.source.localeCompare(b.source) || a.sku.localeCompare(b.sku),
    );
}
