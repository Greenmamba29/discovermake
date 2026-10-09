/**
 * 3D-print instant quote engine (R6 Reconstruct): print catalog, pure pricing + DFM, and
 * persistence onto the R1 `quotes` snapshot (`config.process = 'print'`). See ./quotes.ts.
 */
import { and, eq } from 'drizzle-orm';
import { getDb, type DbOrTx } from '../../db';
import { printQuoteDetails, shopPrintRateCards } from '../../db/schema';

export { PRINT_PROFILES, PRINT_MATERIAL_SEEDS, DEV_PRINT_RATE_CARD_ID, listPrintMaterials, loadPrintMaterialBySlug, seedPrintCatalog, seedPrintShop } from './catalog';
export { PRINT_DFM_VERSION, PRINT_MIN_WALL_MM, runPrintDfm } from './dfm';
export { effectiveMarginPct, effectiveVolumeMm3, fitsBuildVolume, pricePrint, printHoursPerPart, PRINT_LADDER_QUANTITIES, PRINT_PRICING_VERSION, PrintPricingError, type PrintGeometry, type PrintMaterialPricing, type PrintPriceResult, type PrintProcess, type PrintRateCardPricing } from './pricing';
export { createPrintQuote, isPrintQuoteConfig, leadMachineHours, loadPrintQuoteDetails, printMachineLabel, printRouteOf, toPrintMaterial, toPrintRateCard, type CreatePrintQuoteInput, type CriticalDim } from './quotes';

/** Checkout: the print rate card a quote was priced on is still the shop's active one. */
export async function printRateCardIsActive(quoteId: string, db: DbOrTx = getDb()): Promise<boolean> {
    const [row] = await db
        .select({ id: shopPrintRateCards.id })
        .from(printQuoteDetails)
        .innerJoin(shopPrintRateCards, and(eq(shopPrintRateCards.id, printQuoteDetails.printRateCardId), eq(shopPrintRateCards.active, true)))
        .where(eq(printQuoteDetails.quoteId, quoteId));
    return Boolean(row);
}
