/**
 * Sourcing provider registry. Instant providers are asked in order (partner shop stock first,
 * then catalog distributors that are configured); Accio Work stays the long-tail provider through
 * the existing MCP bridge (`AccioProvider.enqueue` queues a sourcing job the agent group leases).
 */
import type { CreateSourcingJobInput } from '../jobs';
import { CatalogDistributorProvider, MouserDistributor } from './distributor';
import { ShopStockProvider } from './shop-stock';
import { rankOffers, type ProviderOffer, type ProviderRequest, type SourcingProvider } from './types';

export * from './types';
export { CatalogDistributorProvider, FixtureDistributor, MouserDistributor, parseMouserResponse, parsePriceCents, priceAtQuantity, MOUSER_KEYWORD_URL } from './distributor';
export { ShopStockProvider, listShopStock, toShopStockView, updateShopStockQuantity, upsertShopStock } from './shop-stock';

/** Accio Work: async, offers arrive over MCP (src/server/sourcing/mcp.ts). */
export class AccioProvider implements SourcingProvider {
    readonly name = 'accio';
    readonly mode = 'async' as const;

    isEnabled(): boolean {
        return true;
    }

    async findOffers(): Promise<ProviderOffer[]> {
        return [];
    }

    /** Queue the request for the Accio Work agent group (or return the open job). */
    async enqueue(input: CreateSourcingJobInput) {
        const { createSourcingJob } = await import('../jobs');
        return createSourcingJob({ ...input, channel: 'accio', reuseOpen: true });
    }
}

export function defaultProviders(): SourcingProvider[] {
    return [new ShopStockProvider(), new CatalogDistributorProvider(new MouserDistributor()), new AccioProvider()];
}

/** Ask every enabled instant provider; a failing provider is skipped (and logged), never fatal. */
export async function findInstantOffers(request: ProviderRequest, providers: readonly SourcingProvider[] = defaultProviders()): Promise<ProviderOffer[]> {
    const results = await Promise.all(
        providers
            .filter((p) => p.mode === 'instant' && p.isEnabled())
            .map(async (p) => {
                try {
                    return await p.findOffers(request);
                } catch (err) {
                    console.error(`[sourcing] provider ${p.name} failed`, err);
                    return [];
                }
            }),
    );
    return rankOffers(results.flat());
}
