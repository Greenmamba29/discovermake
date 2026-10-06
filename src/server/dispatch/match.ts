/**
 * Shop matching for dispatch (workflow 05 · Dispatch).
 *
 * Candidates = ACTIVE shops with an active rate card and an active capability for
 * the quote's thickness option + its cutting process whose machine bed fits the part
 * (rotation allowed). When bending is ordered, the shop must also have a press brake
 * capability for that thickness option long enough for the longest bend line.
 *
 * Score (lower wins, integer cents-equivalent):
 *   estimated shop cost from the shop's rate card (machine time, setup, handling, QA,
 *   packaging, bends, finishing)                        -- workflow 02 coefficients
 *   + queue_days x QUEUE_DAY_PENALTY_CENTS             -- promise risk
 *   + open jobs x QUEUE_DEPTH_PENALTY_CENTS            -- load balance
 *   + (5 - rating) x QUALITY_PENALTY_CENTS             -- unrated shops count as 4.0
 * Ties go to the shop the quote was priced on, then by shop id.
 * Weights are R1 defaults (uncalibrated) and documented here on purpose.
 */
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { ProcessKind } from '../../contracts/enums';
import type { DbOrTx } from '../db';
import { manufacturingJobs, shopCapabilities, shopRateCards, shops } from '../db/schema';

export const QUEUE_DAY_PENALTY_CENTS = 1500;
export const QUEUE_DEPTH_PENALTY_CENTS = 500;
export const QUALITY_PENALTY_CENTS = 1000;
export const UNRATED_SHOP_RATING = 4.0;
export const PRESS_BRAKE_PROCESS_ID = 'prc_press_brake';

const SQ_MM_PER_FT2 = 92_903.04;

export type RateCardRow = typeof shopRateCards.$inferSelect;
export type ShopRow = typeof shops.$inferSelect;
export type CapabilityRow = typeof shopCapabilities.$inferSelect;

export type JobRequirements = {
    thicknessOptionId: string;
    processId: string;
    processKind: ProcessKind;
    bboxWidthMm: number;
    bboxHeightMm: number;
    cutLengthMm: number;
    pierceCount: number;
    netAreaMm2: number;
    feedRateMmPerMin: number;
    pierceTimeS: number;
    quantity: number;
    /** Bending ordered: number of bends per part and longest bend line. */
    bending: { bendCount: number; longestBendMm: number } | null;
    finished: boolean;
    /** Shop the quote was priced on (tie-break). */
    quotedShopId: string;
};

export type Candidate = {
    shop: ShopRow;
    capability: CapabilityRow;
    rateCard: RateCardRow;
    queueDepth: number;
    estimatedCostCents: number;
    score: number;
};

export function fitsBed(w: number, h: number, bedW: number, bedH: number): boolean {
    return (w <= bedW && h <= bedH) || (w <= bedH && h <= bedW);
}

/** Estimated shop cost of the job on this rate card (ranking only; payouts come from the binding quote). */
export function estimateShopCostCents(req: JobRequirements, rc: Pick<RateCardRow, 'fiberLaserCentsPerHour' | 'co2LaserCentsPerHour' | 'brakeCentsPerBend' | 'brakeSetupCents' | 'orderSetupCents' | 'partHandlingCents' | 'finishingCentsPerFt2' | 'finishBatchSetupCents' | 'qaCentsPerPart' | 'packagingBaseCents'>): number {
    const cutMinutes = (req.feedRateMmPerMin > 0 ? req.cutLengthMm / req.feedRateMmPerMin : 0) + (req.pierceCount * req.pierceTimeS) / 60;
    const hourly = req.processKind === 'CO2_LASER' ? rc.co2LaserCentsPerHour : rc.fiberLaserCentsPerHour;
    const machine = (cutMinutes / 60) * hourly * req.quantity;
    const perPart = (rc.partHandlingCents + rc.qaCentsPerPart) * req.quantity;
    const bends = req.bending ? rc.brakeSetupCents + rc.brakeCentsPerBend * req.bending.bendCount * req.quantity : 0;
    const finishing = req.finished ? rc.finishBatchSetupCents + (req.netAreaMm2 / SQ_MM_PER_FT2) * 2 * rc.finishingCentsPerFt2 * req.quantity : 0;
    return Math.round(machine + perPart + bends + finishing + rc.orderSetupCents + rc.packagingBaseCents);
}

export function scoreCandidate(input: { estimatedCostCents: number; queueDays: number; queueDepth: number; rating: number | null }): number {
    const rating = input.rating ?? UNRATED_SHOP_RATING;
    return Math.round(
        input.estimatedCostCents +
            input.queueDays * QUEUE_DAY_PENALTY_CENTS +
            input.queueDepth * QUEUE_DEPTH_PENALTY_CENTS +
            Math.max(0, 5 - rating) * QUALITY_PENALTY_CENTS,
    );
}

/** Ranked candidates (best first). Excluded shops never appear. */
export async function findCandidates(db: DbOrTx, req: JobRequirements, excludeShopIds: string[]): Promise<Candidate[]> {
    const rows = await db
        .select({ capability: shopCapabilities, shop: shops, rateCard: shopRateCards })
        .from(shopCapabilities)
        .innerJoin(shops, eq(shops.id, shopCapabilities.shopId))
        .innerJoin(shopRateCards, and(eq(shopRateCards.shopId, shops.id), eq(shopRateCards.active, true)))
        .where(
            and(
                eq(shopCapabilities.thicknessOptionId, req.thicknessOptionId),
                eq(shopCapabilities.processId, req.processId),
                eq(shopCapabilities.active, true),
                eq(shops.status, 'ACTIVE'),
                excludeShopIds.length ? notInArray(shops.id, excludeShopIds) : undefined,
            ),
        );

    let eligible = rows.filter((r) => fitsBed(req.bboxWidthMm, req.bboxHeightMm, r.capability.bedWidthMm, r.capability.bedHeightMm));

    if (req.bending && eligible.length) {
        const brakes = await db
            .select()
            .from(shopCapabilities)
            .where(
                and(
                    eq(shopCapabilities.thicknessOptionId, req.thicknessOptionId),
                    eq(shopCapabilities.processId, PRESS_BRAKE_PROCESS_ID),
                    eq(shopCapabilities.active, true),
                    inArray(
                        shopCapabilities.shopId,
                        eligible.map((r) => r.shop.id),
                    ),
                ),
            );
        const longest = req.bending.longestBendMm;
        const ok = new Set(brakes.filter((b) => (b.maxBendLengthMm ?? Math.max(b.bedWidthMm, b.bedHeightMm)) >= longest).map((b) => b.shopId));
        eligible = eligible.filter((r) => ok.has(r.shop.id));
    }
    if (!eligible.length) return [];

    // One row per shop (a shop could list two machines for the same option: keep the larger bed).
    const byShop = new Map<string, (typeof eligible)[number]>();
    for (const r of eligible) {
        const prev = byShop.get(r.shop.id);
        if (!prev || r.capability.bedWidthMm * r.capability.bedHeightMm > prev.capability.bedWidthMm * prev.capability.bedHeightMm) byShop.set(r.shop.id, r);
    }

    const shopIds = [...byShop.keys()];
    const depthRows = await db
        .select({ shopId: manufacturingJobs.shopId, n: sql<number>`count(*)::int` })
        .from(manufacturingJobs)
        .where(and(inArray(manufacturingJobs.shopId, shopIds), inArray(manufacturingJobs.status, ['OFFERED', 'ACCEPTED', 'IN_PRODUCTION', 'QA_FAILED', 'QA_PASSED'])))
        .groupBy(manufacturingJobs.shopId);
    const depth = new Map(depthRows.map((d) => [d.shopId, d.n]));

    const candidates: Candidate[] = [...byShop.values()].map((r) => {
        const queueDepth = depth.get(r.shop.id) ?? 0;
        const estimatedCostCents = estimateShopCostCents(req, r.rateCard);
        return {
            shop: r.shop,
            capability: r.capability,
            rateCard: r.rateCard,
            queueDepth,
            estimatedCostCents,
            score: scoreCandidate({ estimatedCostCents, queueDays: r.shop.queueDays, queueDepth, rating: r.shop.rating }),
        };
    });

    candidates.sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        if (a.shop.id === req.quotedShopId) return -1;
        if (b.shop.id === req.quotedShopId) return 1;
        return a.shop.id < b.shop.id ? -1 : 1;
    });
    return candidates;
}
