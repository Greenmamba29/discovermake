/**
 * R3 additions to QuoteView: route kind, the buyer-safe supplier route summary and the
 * Delivery Promise per shipping method. Loaded by getQuoteImpl (dynamic import, no cycle).
 */
import { eq } from 'drizzle-orm';
import type { QuoteSupplierRouteView } from '../../contracts/promise';
import type { QuoteView } from '../../contracts/quotes';
import { getDb, type DbOrTx } from '../db';
import { quotes, shops, supplierQuotes } from '../db/schema';
import { quotePromises } from '../promise/engine';
import { routeOfferLabel } from '../sourcing/views';

type QuoteRow = typeof quotes.$inferSelect;

export async function supplierRouteForQuote(quoteId: string, db: DbOrTx = getDb()): Promise<QuoteSupplierRouteView | null> {
    const [row] = await db.select().from(supplierQuotes).where(eq(supplierQuotes.quoteId, quoteId));
    if (!row) return null;
    const c = row.composition;
    const [partner] = row.receivingShopId ? await db.select({ name: shops.name, city: shops.city, region: shops.region }).from(shops).where(eq(shops.id, row.receivingShopId)) : [];
    return {
        label: routeOfferLabel({ verified: c.supplierStatus.verified, country: c.supplierStatus.country }),
        country: c.supplierStatus.country,
        verified: c.supplierStatus.verified,
        receivingPartner: partner ?? null,
        depositPct: row.depositPct,
        assumptions: c.assumptions,
        excludedCosts: c.excludedCosts,
    };
}

export async function quoteViewExtras(row: QuoteRow, now: Date): Promise<Pick<QuoteView, 'routeKind' | 'supplierRoute' | 'promise'>> {
    const supplierRoute = await supplierRouteForQuote(row.id);
    let promise: QuoteView['promise'];
    try {
        promise = await quotePromises(row, { now });
    } catch (err) {
        // A promise is an addition: never fail the quote view because of it.
        console.error(`[promise] could not compute the promise for quote ${row.id}`, err);
        promise = undefined;
    }
    return supplierRoute ? { routeKind: 'supplier', supplierRoute, promise } : { routeKind: 'shop', promise };
}
