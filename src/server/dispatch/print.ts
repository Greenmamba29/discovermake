/**
 * Dispatch for printed parts (R6). A print quote (`config.process = 'print'`) dispatches like
 * any other order (one OFFERED job, signed packet, inspection plan, PAID -> DISPATCHED) but is
 * matched to PRINTERS instead of laser beds:
 *
 *   candidates = ACTIVE shops with an active 3D_PRINT capability for the quote's print material
 *                whose build volume fits the part, an active print rate card and an active shop
 *                rate card, minus excluded (declined / expired) shops;
 *   score      = estimated print cost on the shop's print card + the R1 queue / quality penalties.
 *
 * The packet names the STL (its sha256 from the print quote snapshot) and the print settings;
 * the inspection plan checks the buyer's confirmed CALIPER dimensions (they are the spec).
 */
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { InspectionCheck } from '../../contracts/shop';
import type { DbOrTx } from '../db';
import { builds, manufacturingJobs, orders, parts, printMaterials, printQuoteDetails, quotes, shopPrintCapabilities, shopPrintRateCards, shopRateCards, shops } from '../db/schema';
import { fitsBuildVolume, pricePrint, type PrintGeometry } from '../quote/printing/pricing';
import { isPrintQuoteConfig, toPrintMaterial, toPrintRateCard } from '../quote/printing/quotes';
import { sampleSizeFor } from './inspection-plan';
import { scoreCandidate } from './match';
import { packingInstructions, type UnsignedPacket } from './packet';

type OrderRow = typeof orders.$inferSelect;
type ShopRow = typeof shops.$inferSelect;

/** Printed-part tolerance: ±0.3 mm up to 50 mm, ±0.6% beyond (FDM/SLS shop practice, uncalibrated). */
export function printTolMm(nominalMm: number): number {
    return Math.round(Math.max(0.3, nominalMm * 0.006) * 100) / 100;
}

export type PrintCandidate = { shop: ShopRow; score: number; estimatedCostCents: number; capabilityId: string };

export function buildPrintInspectionChecks(input: { criticalDims: { param: string; label: string; nominalMm: number }[]; quantity: number; materialName: string }): InspectionCheck[] {
    const checks: InspectionCheck[] = input.criticalDims.slice(0, 10).map((d) => {
        const nominal = Math.round(d.nominalMm * 100) / 100;
        const tol = printTolMm(nominal);
        return {
            id: `chk_dim_${d.param.replace(/_mm$/, '')}`.slice(0, 40),
            kind: 'DIMENSION',
            label: `${d.label} ${nominal} mm (buyer's caliper reading)`,
            nominalMm: nominal,
            tolPlusMm: tol,
            tolMinusMm: tol,
            critical: true,
            instructions: 'Measure with calibrated calipers where the buyer measured the original part.',
        };
    });
    checks.push({
        id: 'chk_print_visual',
        kind: 'VISUAL',
        label: `Print quality (${input.materialName})`,
        nominalMm: null,
        tolPlusMm: null,
        tolMinusMm: null,
        critical: false,
        instructions: 'No layer separation, stringing or support scars on visible faces; the bore is clean.',
    });
    checks.push({ id: 'chk_count', kind: 'COUNT', label: `Quantity ${input.quantity}`, nominalMm: null, tolPlusMm: null, tolMinusMm: null, critical: true, instructions: 'Count the parts going into the box.' });
    return checks;
}

export type PrintDispatchPlan = {
    quote: typeof quotes.$inferSelect;
    part: typeof parts.$inferSelect;
    candidates: PrintCandidate[];
    buildPacket: (jobId: string, order: OrderRow, issuedAt: Date) => { packet: UnsignedPacket; checks: InspectionCheck[]; sampleSize: number };
};

/** The print dispatch plan for an order, or null when its quote is not a print quote. */
export async function planPrintDispatch(tx: DbOrTx, order: OrderRow, excludeShopIds: string[]): Promise<PrintDispatchPlan | null> {
    const [quote] = await tx.select().from(quotes).where(eq(quotes.id, order.quoteId));
    if (!quote || !isPrintQuoteConfig(quote.config)) return null;
    const [[details], [part], [build]] = await Promise.all([
        tx.select().from(printQuoteDetails).where(eq(printQuoteDetails.quoteId, quote.id)),
        tx.select().from(parts).where(eq(parts.id, quote.partId)),
        tx.select().from(builds).where(eq(builds.id, order.buildId)),
    ]);
    if (!details || !part || !build) throw new Error(`Print order ${order.orderNumber} is missing its print details, part or build`);
    if (part.designVersion !== quote.designVersion) {
        throw new Error(`Part ${part.id} is at design version ${part.designVersion} but order ${order.orderNumber} paid for version ${quote.designVersion}; refund or re-quote instead of dispatching`);
    }
    const [materialRow] = await tx.select().from(printMaterials).where(eq(printMaterials.id, details.printMaterialId));
    if (!materialRow) throw new Error(`Print material ${details.printMaterialId} not found`);
    const material = toPrintMaterial(materialRow);
    const geometry = details.geometry as unknown as PrintGeometry;

    const rows = await tx
        .select({ cap: shopPrintCapabilities, shop: shops, card: shopPrintRateCards })
        .from(shopPrintCapabilities)
        .innerJoin(shops, eq(shops.id, shopPrintCapabilities.shopId))
        .innerJoin(shopPrintRateCards, and(eq(shopPrintRateCards.shopId, shops.id), eq(shopPrintRateCards.active, true)))
        .innerJoin(shopRateCards, and(eq(shopRateCards.shopId, shops.id), eq(shopRateCards.active, true)))
        .where(
            and(
                eq(shopPrintCapabilities.printMaterialId, details.printMaterialId),
                eq(shopPrintCapabilities.active, true),
                eq(shops.status, 'ACTIVE'),
                excludeShopIds.length ? notInArray(shops.id, excludeShopIds) : undefined,
            ),
        );
    const eligible = rows.filter((r) => fitsBuildVolume(geometry.bboxMm, r.cap));
    let candidates: PrintCandidate[] = [];
    if (eligible.length) {
        const shopIds = [...new Set(eligible.map((r) => r.shop.id))];
        const depthRows = await tx
            .select({ shopId: manufacturingJobs.shopId, n: sql<number>`count(*)::int` })
            .from(manufacturingJobs)
            .where(and(inArray(manufacturingJobs.shopId, shopIds), inArray(manufacturingJobs.status, ['OFFERED', 'ACCEPTED', 'IN_PRODUCTION', 'QA_FAILED', 'QA_PASSED'])))
            .groupBy(manufacturingJobs.shopId);
        const depth = new Map(depthRows.map((d) => [d.shopId, d.n]));
        candidates = eligible.map((r) => {
            const estimatedCostCents = Math.round(pricePrint({ geometry, material, rateCard: toPrintRateCard(r.card), quantity: order.quantity }).rawCostCents);
            return { shop: r.shop, capabilityId: r.cap.id, estimatedCostCents, score: scoreCandidate({ estimatedCostCents, queueDays: r.shop.queueDays, queueDepth: depth.get(r.shop.id) ?? 0, rating: r.shop.rating }) };
        });
        candidates.sort((a, b) => a.score - b.score || (a.shop.id === quote.shopId ? -1 : b.shop.id === quote.shopId ? 1 : a.shop.id.localeCompare(b.shop.id)));
    }

    const [bx, by, bz] = geometry.bboxMm;
    return {
        quote,
        part,
        candidates,
        buildPacket: (jobId, o, issuedAt) => {
            const checks = buildPrintInspectionChecks({ criticalDims: details.criticalDims, quantity: o.quantity, materialName: materialRow.name });
            const sampleSize = sampleSizeFor(o.quantity);
            const packet: UnsignedPacket = {
                packetVersion: 1,
                jobId,
                orderNumber: o.orderNumber,
                buildDisplayId: build.displayId,
                quoteId: quote.id,
                designVersion: quote.designVersion,
                part: {
                    filename: part.filename,
                    bboxWidthMm: Math.max(bx, by),
                    bboxHeightMm: Math.min(bx, by),
                    cutLengthMm: 0,
                    pierceCount: 0,
                    holeCount: 0,
                    bendCount: 0,
                    fileSha256: part.fileSha256,
                    flatPatternSvgPath: null,
                },
                material: { id: materialRow.id, name: materialRow.name, thicknessOptionId: quote.config.thicknessOptionId, thicknessMm: details.layerHeightMm, thicknessLabel: quote.summary.thicknessLabel },
                process: { id: `print_${details.process.toLowerCase()}`, name: quote.summary.processName },
                finish: null,
                services: [],
                quantity: o.quantity,
                qaNotes: [`Inspect ${sampleSize} part(s): first article plus every 25th.`, ...checks.map((c) => (c.critical ? `${c.label} (critical)` : c.label)), 'Upload at least one photo of the inspected parts with the results.'],
                packing: {
                    instructions: packingInstructions({ materialCategory: 'PRINT', finished: false, bent: false, quantity: o.quantity }) + ' Bag printed parts individually so the faces do not scuff.',
                    shippingMethod: o.shippingMethod,
                },
                buyerNotes: o.notes,
                shipBy: o.promisedShipDate,
                shipTo: o.shippingAddress,
                issuedAt: issuedAt.toISOString(),
                print: {
                    process: details.process === 'SLS' ? 'SLS' : 'FDM',
                    family: details.family,
                    layerHeightMm: details.layerHeightMm,
                    bboxMm: [bx, by, bz],
                    volumeMm3: geometry.volumeMm3,
                    minWallMm: geometry.minWallMm,
                    printHoursPerPart: details.printHoursPerPart,
                    unitMassG: details.unitMassG,
                    orientation: 'As modelled: z = 0 face on the bed (bore or flange down).',
                    stlSha256: details.stlSha256,
                },
            };
            return { packet, checks, sampleSize };
        },
    };
}
