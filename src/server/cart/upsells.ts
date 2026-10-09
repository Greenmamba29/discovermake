/**
 * "Complete your build" upsells (DoorDash pattern). Every offer is a real quote from the
 * quote engine (`createQuote`) for a modified configuration of the base quote, so its
 * price is exactly what checkout will charge; the client only ever names the kind.
 *
 *   spare_part      quantity + 1 (the marginal unit price on the same rate card + ladder model)
 *   finish_upgrade  powder coat (matte black) when the material takes it and no finish is set
 *   hardware_kit    loose fasteners matched to the part's round clearance holes (features.holes)
 *
 * Offers are computed once per base quote and stored in `upsell_offers`; only offers whose
 * quote is orderable (READY + BINDING + fresh) are returned.
 */
import { and, eq } from 'drizzle-orm';
import type { HoleFeature } from '../../contracts/parts';
import type { UpsellKind, UpsellOffer } from '../../contracts/prime';
import { MAX_QUOTE_QUANTITY, type CreateQuoteRequest } from '../../contracts/quotes';
import { getDb } from '../db';
import { materials, parts, quotes, services, upsellOffers } from '../db/schema';
import { ApiError } from '../http';
import { createQuote, isQuoteOrderable } from '../quote';
import { serviceCompatible } from '../quote/catalog';

export const HARDWARE_KIT_SLUG = 'hardware-kit';
export const UPSELL_FINISH_SLUG = 'powder-coat-matte-black';

/** ISO metric clearance-hole ranges (close..loose fit, mm). */
export const METRIC_CLEARANCE: readonly { size: string; minMm: number; maxMm: number }[] = [
    { size: 'M3', minMm: 3.2, maxMm: 3.7 },
    { size: 'M4', minMm: 4.3, maxMm: 4.9 },
    { size: 'M5', minMm: 5.3, maxMm: 5.9 },
    { size: 'M6', minMm: 6.4, maxMm: 7.0 },
    { size: 'M8', minMm: 8.4, maxMm: 9.2 },
    { size: 'M10', minMm: 10.5, maxMm: 11.2 },
];

/** Pure: the fastener size matching the most round holes, with that hole count (null when none match). */
export function matchHardware(holes: readonly HoleFeature[]): { size: string; count: number } | null {
    let best: { size: string; count: number } | null = null;
    for (const c of METRIC_CLEARANCE) {
        const count = holes.filter((h) => h.circular && h.diameterMm >= c.minMm && h.diameterMm <= c.maxMm).length;
        if (count > 0 && (!best || count > best.count)) best = { size: c.size, count };
    }
    return best;
}

type QuoteRow = typeof quotes.$inferSelect;

type Candidate = { kind: UpsellKind; title: string; description: string; config: CreateQuoteRequest };

async function candidatesFor(base: QuoteRow): Promise<Candidate[]> {
    const db = getDb();
    const c = base.config;
    const out: Candidate[] = [];
    if (c.quantity < MAX_QUOTE_QUANTITY) {
        out.push({
            kind: 'spare_part',
            title: 'Add a spare',
            description: `One more ${base.summary.partFilename} from the same run, at the marginal price.`,
            config: { ...c, quantity: c.quantity + 1 },
        });
    }
    const [material] = await db.select().from(materials).where(eq(materials.id, c.materialId)).limit(1);
    const svcRows = await db.select().from(services).where(eq(services.active, true));
    if (material && !c.finishServiceId) {
        const finish = svcRows.find((s) => s.slug === UPSELL_FINISH_SLUG && s.kind === 'FINISH' && serviceCompatible(s, material));
        if (finish) {
            out.push({
                kind: 'finish_upgrade',
                title: `Upgrade to ${finish.name.toLowerCase()}`,
                description: 'Durable electrostatic powder coat on both sides, oven cured.',
                config: { ...c, finishServiceId: finish.id },
            });
        }
    }
    const kit = svcRows.find((s) => s.slug === HARDWARE_KIT_SLUG && s.kind === 'SECONDARY_OP');
    if (material && kit && serviceCompatible(kit, material) && !c.services.some((s) => s.serviceId === kit.id) && c.services.length < 10) {
        const [part] = await db.select({ features: parts.features }).from(parts).where(eq(parts.id, base.partId)).limit(1);
        const match = part?.features ? matchHardware(part.features.holes) : null;
        if (match) {
            out.push({
                kind: 'hardware_kit',
                title: `Add a ${match.size} hardware kit`,
                description: `${match.count} sets of ${match.size} stainless screws, nuts and washers per part, matched to your ${match.count} clearance hole${match.count === 1 ? '' : 's'}.`,
                config: { ...c, services: [...c.services, { serviceId: kit.id, featureCount: match.count, options: { size: match.size } }] },
            });
        }
    }
    return out;
}

async function freshness(quoteId: string) {
    const [r] = await getDb()
        .select({ quote: quotes, part: { designVersion: parts.designVersion, rulesetVersion: parts.rulesetVersion } })
        .from(quotes)
        .innerJoin(parts, eq(parts.id, quotes.partId))
        .where(eq(quotes.id, quoteId))
        .limit(1);
    return r ?? null;
}

/** Upsell offers for a base quote, each priced by the quote engine. */
export async function getUpsellOffers(baseQuoteId: string): Promise<UpsellOffer[]> {
    const db = getDb();
    const base = await freshness(baseQuoteId);
    if (!base) throw new ApiError('NOT_FOUND', 'Quote not found');
    if (!isQuoteOrderable(base.quote, base.part)) return [];

    const existing = await db.select().from(upsellOffers).where(eq(upsellOffers.baseQuoteId, baseQuoteId));
    const have = new Set(existing.map((e) => e.kind));
    for (const cand of await candidatesFor(base.quote)) {
        if (have.has(cand.kind)) continue;
        let offerQuoteId: string;
        try {
            offerQuoteId = (await createQuote(cand.config)).id;
        } catch (err) {
            if (err instanceof ApiError) continue; // not quotable (validation / no partner): no offer
            throw err;
        }
        await db
            .insert(upsellOffers)
            .values({ baseQuoteId, kind: cand.kind, offerQuoteId, title: cand.title, description: cand.description })
            .onConflictDoNothing({ target: [upsellOffers.baseQuoteId, upsellOffers.kind] });
    }

    const rows = await db.select().from(upsellOffers).where(eq(upsellOffers.baseQuoteId, baseQuoteId));
    const offers: UpsellOffer[] = [];
    const order: UpsellKind[] = ['hardware_kit', 'spare_part', 'finish_upgrade'];
    for (const row of rows.sort((a, b) => order.indexOf(a.kind as UpsellKind) - order.indexOf(b.kind as UpsellKind))) {
        const offer = await freshness(row.offerQuoteId);
        if (!offer || !isQuoteOrderable(offer.quote, offer.part)) continue;
        offers.push({
            kind: row.kind as UpsellKind,
            title: row.title,
            description: row.description,
            deltaCents: offer.quote.subtotalCents - base.quote.subtotalCents,
            offerQuoteId: offer.quote.id,
            offerSubtotalCents: offer.quote.subtotalCents,
        });
    }
    return offers;
}

/** The base quote an upsell offer came from (null when the quote is not an offer). */
export async function baseQuoteOf(offerQuoteId: string): Promise<string | null> {
    const [row] = await getDb().select({ base: upsellOffers.baseQuoteId }).from(upsellOffers).where(and(eq(upsellOffers.offerQuoteId, offerQuoteId))).limit(1);
    return row?.base ?? null;
}
