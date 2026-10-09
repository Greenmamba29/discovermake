/** Reorder a printed part (My Builds "Reorder"): a fresh print quote from the ordered quote's print snapshot. */
import { eq } from 'drizzle-orm';
import type { QuoteView } from '../../../contracts/quotes';
import { getDb } from '../../db';
import { printMaterials, quotes } from '../../db/schema';
import { ApiError } from '../../http';
import type { PrintGeometry } from './pricing';
import { createPrintQuote, loadPrintQuoteDetails } from './quotes';

export async function reorderPrintQuote(quoteId: string): Promise<QuoteView> {
    const db = getDb();
    const details = await loadPrintQuoteDetails(quoteId, db);
    const [quote] = await db.select({ quantity: quotes.quantity, partId: quotes.partId }).from(quotes).where(eq(quotes.id, quoteId));
    if (!details || !quote) throw new ApiError('CONFLICT', 'This printed part has no print snapshot to reorder from.', 409);
    const [material] = await db.select({ slug: printMaterials.slug }).from(printMaterials).where(eq(printMaterials.id, details.printMaterialId));
    if (!material) throw new ApiError('CONFLICT', 'That print material is no longer offered.', 409);
    const g = details.geometry as unknown as PrintGeometry;
    return createPrintQuote({
        partId: quote.partId,
        printMaterialSlug: material.slug,
        quantity: quote.quantity,
        geometry: { bboxMm: g.bboxMm, volumeMm3: g.volumeMm3, surfaceAreaMm2: g.surfaceAreaMm2, minWallMm: g.minWallMm, bridgeSpanMm: g.bridgeSpanMm },
        family: details.family,
        stlSha256: details.stlSha256,
        criticalDims: details.criticalDims,
        notes: details.notes,
    });
}
