/**
 * The build record behind a featured product: build, latest analyzed part, latest
 * orderable BINDING quote, latest APPROVED design version and its graph.
 *
 * `computeFeaturedProduct` turns it into the buyer-safe FeaturedProduct carried by
 * `product.focus`; `loadBuildFacts` is also the ONLY grounding Ask Make AI gets.
 */
import { and, desc, eq, gt } from 'drizzle-orm';
import type { BgNode } from '../../contracts/build-graph';
import type { FeaturedProduct } from '../../contracts/live';
import { latestApprovedVersionRow, latestVersionRow, loadVersionGraph } from '../build-graph';
import { getDb, type DbOrTx } from '../db';
import { builds, parts, quotes } from '../db/schema';
import { ApiError } from '../http';
import { isQuoteOrderable } from '../quote';

export type BuildRow = typeof builds.$inferSelect;
export type PartRow = typeof parts.$inferSelect;
export type QuoteRow = typeof quotes.$inferSelect;

export type BuildFacts = {
    build: BuildRow;
    part: PartRow | null;
    /** Latest orderable BINDING quote for the part (READY, not expired, current design + rules). */
    quote: QuoteRow | null;
    approvedVersion: number | null;
    /** Graph of the approved version, else of the latest version (empty for R1 upload builds). */
    graphVersion: number | null;
    graphApproved: boolean;
    nodes: BgNode[];
};

export async function loadBuildFacts(buildId: string, db: DbOrTx = getDb(), now: Date = new Date()): Promise<BuildFacts | null> {
    const [build] = await db.select().from(builds).where(eq(builds.id, buildId)).limit(1);
    if (!build) return null;
    const [part] = await db
        .select()
        .from(parts)
        .where(and(eq(parts.buildId, buildId), eq(parts.status, 'READY')))
        .orderBy(desc(parts.createdAt))
        .limit(1);
    let quote: QuoteRow | null = null;
    if (part) {
        const candidates = await db
            .select()
            .from(quotes)
            .where(and(eq(quotes.partId, part.id), eq(quotes.status, 'READY'), eq(quotes.trustLevel, 'BINDING'), gt(quotes.validUntil, now)))
            .orderBy(desc(quotes.createdAt))
            .limit(20);
        quote = candidates.find((q) => isQuoteOrderable(q, { designVersion: part.designVersion, rulesetVersion: part.rulesetVersion }, now)) ?? null;
    }
    const approved = await latestApprovedVersionRow(db, buildId);
    const latest = approved ?? (await latestVersionRow(db, buildId));
    const graph = latest ? await loadVersionGraph(db, buildId, latest.version) : { nodes: [] as BgNode[] };
    return {
        build,
        part: part ?? null,
        quote,
        approvedVersion: approved?.version ?? null,
        graphVersion: latest?.version ?? null,
        graphApproved: !!approved,
        nodes: graph.nodes,
    };
}

export function graphLabels(nodes: BgNode[], type: BgNode['type']): string[] {
    return nodes.filter((n) => n.type === type).map((n) => n.label);
}

export function featuredFromFacts(f: BuildFacts): FeaturedProduct {
    const q = f.quote;
    const materialFromGraph = graphLabels(f.nodes, 'MATERIAL')[0] ?? null;
    const materialLabel = q ? `${q.summary.materialName} ${q.summary.thicknessLabel}` : materialFromGraph;
    const specLine = q ? [q.summary.materialName, q.summary.thicknessLabel, q.summary.unitMassG > 0 ? `${Math.round(q.summary.unitMassG)} g` : null].filter(Boolean).join(' · ') : materialFromGraph;
    const makeability = q?.makeabilityScore ?? f.part?.dfm?.makeabilityScore ?? null;
    return {
        buildId: f.build.id,
        designVersion: q?.designVersion ?? f.approvedVersion ?? Math.max(1, f.build.currentVersion),
        name: f.build.name,
        priceCents: q?.unitPriceCents ?? null,
        leadTimeDays: q?.leadTimeDays ?? null,
        materialLabel,
        makeability: makeability === null ? null : Math.max(0, Math.min(100, Math.round(makeability))),
        canMakeThis: !!f.approvedVersion || !!f.part,
        canRemix: !!f.approvedVersion,
        canBuy: !!q,
        quoteId: q?.id ?? null,
        displayId: f.build.displayId,
        partId: f.part?.id ?? null,
        specLine: specLine || null,
        hasApprovedVersion: !!f.approvedVersion,
    };
}

export async function computeFeaturedProduct(buildId: string, db: DbOrTx = getDb()): Promise<FeaturedProduct> {
    const facts = await loadBuildFacts(buildId, db);
    if (!facts) throw new ApiError('NOT_FOUND', 'Build not found');
    return featuredFromFacts(facts);
}
