/**
 * Creator dashboards `/studio/insights` (SoundCloud Insights, DoorDash Merchant product mix,
 * Square best sellers): earnings from the creator subledger, orders and remixes from the
 * lineage, show stats from the Live tables.
 *
 * Show "views" are max(peak concurrent viewers, presence rows still on file): presence rows are
 * pruned, so this is a floor until a durable view log exists (deferred, see r5-media.md).
 */
import 'server-only';
import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { showDisplayId } from '../../contracts/live';
import type { InsightRange, InsightsView } from '../../contracts/media';
import { getDb } from '../db';
import { auctionBids, auctions, buildPublications, builds, channels, clips, creatorEarnings, drops, livePresence, orders, shows, slotClaims } from '../db/schema';
import { remixTree } from './publish';

const DAY_MS = 86_400_000;
const RANGE_DAYS: Record<InsightRange, number | null> = { '7d': 7, '30d': 30, '90d': 90, all: null };
const ROYALTY_KINDS = new Set(['REMIX_ROYALTY', 'MAKE_THIS_ROYALTY', 'ROYALTY_REVERSAL']);

export function rangeStart(range: InsightRange, now: Date): Date | null {
    const days = RANGE_DAYS[range];
    if (days === null) return null;
    const d = new Date(now.getTime() - (days - 1) * DAY_MS);
    d.setUTCHours(0, 0, 0, 0);
    return d;
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export async function creatorInsights(userId: string, range: InsightRange, now: Date = new Date()): Promise<InsightsView> {
    const db = getDb();
    const from = rangeStart(range, now);
    const since = (col: Parameters<typeof gte>[0]) => (from ? gte(col, from) : undefined);

    const earningRows = await db
        .select({ e: creatorEarnings, title: builds.name })
        .from(creatorEarnings)
        .innerJoin(builds, eq(builds.id, sql`coalesce(${creatorEarnings.sourceBuildId}, ${creatorEarnings.buildId})`))
        .where(and(eq(creatorEarnings.creatorUserId, userId), since(creatorEarnings.createdAt)))
        .orderBy(desc(creatorEarnings.createdAt));

    const pubs = await db.select().from(buildPublications).where(eq(buildPublications.ownerUserId, userId));
    const pubIds = pubs.map((p) => p.buildId);
    const pubTitle = new Map(pubs.map((p) => [p.buildId, p.title]));

    // Totals + series
    let earningsCents = 0;
    let royaltiesCents = 0;
    let liveRevenueCents = 0;
    const orderIds = new Set<string>();
    const seriesDays = RANGE_DAYS[range] ?? 30;
    const seriesStart = new Date(now.getTime() - (seriesDays - 1) * DAY_MS);
    seriesStart.setUTCHours(0, 0, 0, 0);
    const series = Array.from({ length: seriesDays }, (_, i) => ({ date: dayKey(new Date(seriesStart.getTime() + i * DAY_MS)), royaltiesCents: 0, liveRevenueCents: 0, orders: 0 }));
    const seriesBy = new Map(series.map((s) => [s.date, s]));
    const mix = new Map<string, { title: string; earningsCents: number; orders: Set<string> }>();
    for (const { e, title } of earningRows) {
        earningsCents += e.amountCents;
        const royalty = ROYALTY_KINDS.has(e.kind);
        if (royalty) royaltiesCents += e.amountCents;
        else liveRevenueCents += e.amountCents;
        if (e.amountCents > 0) orderIds.add(e.orderId);
        const point = seriesBy.get(dayKey(e.createdAt));
        if (point) {
            if (royalty) point.royaltiesCents += e.amountCents;
            else point.liveRevenueCents += e.amountCents;
            if (e.amountCents > 0) point.orders += 1;
        }
        const key = e.sourceBuildId ?? e.buildId;
        const m = mix.get(key) ?? { title: pubTitle.get(key) ?? title, earningsCents: 0, orders: new Set<string>() };
        m.earningsCents += e.amountCents;
        if (e.amountCents > 0) m.orders.add(e.orderId);
        mix.set(key, m);
    }
    const mixTotal = [...mix.values()].reduce((s, m) => s + Math.max(0, m.earningsCents), 0);
    const productMix = [...mix.entries()]
        .map(([buildId, m]) => ({ buildId, title: m.title, earningsCents: m.earningsCents, sharePct: mixTotal > 0 ? Math.round((Math.max(0, m.earningsCents) / mixTotal) * 1000) / 10 : 0, orders: m.orders.size }))
        .sort((a, b) => b.earningsCents - a.earningsCents)
        .slice(0, 8);

    // Remixes + best sellers (lineage orders in range)
    const derived = pubIds.length
        ? await db
              .select({ id: builds.id, parent: builds.derivedFromBuildId, createdAt: builds.createdAt })
              .from(builds)
              .where(and(inArray(builds.derivedFromBuildId, pubIds), since(builds.createdAt)))
        : [];
    const remixesBy = new Map<string, number>();
    for (const d of derived) remixesBy.set(d.parent!, (remixesBy.get(d.parent!) ?? 0) + 1);
    const paid = ['PAID', 'DISPATCHED', 'ACCEPTED', 'IN_PRODUCTION', 'QA_FAILED', 'QA_PASSED', 'SHIPPED', 'DELIVERED', 'COMPLETE'] as const;
    const allDerived = pubIds.length ? await db.select({ id: builds.id, parent: builds.derivedFromBuildId }).from(builds).where(inArray(builds.derivedFromBuildId, pubIds)) : [];
    const lineageIds = [...pubIds, ...allDerived.map((d) => d.id)];
    const orderRows = lineageIds.length
        ? await db
              .select({ buildId: orders.buildId, n: sql<number>`count(*)::int` })
              .from(orders)
              .where(and(inArray(orders.buildId, lineageIds), inArray(orders.status, [...paid]), since(orders.createdAt)))
              .groupBy(orders.buildId)
        : [];
    const parentOf = new Map(allDerived.map((d) => [d.id, d.parent!]));
    const ordersBy = new Map<string, number>();
    for (const r of orderRows) {
        const root = pubIds.includes(r.buildId) ? r.buildId : parentOf.get(r.buildId);
        if (root) ordersBy.set(root, (ordersBy.get(root) ?? 0) + Number(r.n));
    }
    const topBuilds = pubs
        .map((p) => ({ buildId: p.buildId, title: p.title, orders: ordersBy.get(p.buildId) ?? 0, earningsCents: mix.get(p.buildId)?.earningsCents ?? 0, remixes: remixesBy.get(p.buildId) ?? 0, published: p.visibility === 'public' }))
        .sort((a, b) => b.earningsCents - a.earningsCents || b.orders - a.orders || b.remixes - a.remixes)
        .slice(0, 10);

    const treeRoots = topBuilds.filter((b) => b.remixes > 0 || (allDerived.some((d) => d.parent === b.buildId))).slice(0, 5);
    const remixTreeView = await Promise.all(treeRoots.map((b) => remixTree(b.buildId, { depth: 2, db })));

    // Shows
    const [channel] = await db.select({ id: channels.id }).from(channels).where(eq(channels.ownerUserId, userId)).limit(1);
    const showRows = channel
        ? await db
              .select()
              .from(shows)
              .where(and(eq(shows.channelId, channel.id), from ? sql`coalesce(${shows.startedAt}, ${shows.scheduledFor}) >= ${from}` : undefined))
              .orderBy(desc(shows.scheduledFor))
              .limit(20)
        : [];
    const showIds = showRows.map((s) => s.id);
    const [presence, slotRows, clipRows, dropEarnings, auctionEarnings] = showIds.length
        ? await Promise.all([
              db.select({ showId: livePresence.showId, n: count() }).from(livePresence).where(inArray(livePresence.showId, showIds)).groupBy(livePresence.showId),
              db
                  .select({ showId: drops.showId, n: sql<number>`coalesce(sum(${slotClaims.quantity}), 0)::int` })
                  .from(slotClaims)
                  .innerJoin(drops, eq(drops.id, slotClaims.dropId))
                  .where(and(inArray(drops.showId, showIds), inArray(slotClaims.status, ['AUTHORIZED', 'CAPTURED'])))
                  .groupBy(drops.showId),
              db.select({ showId: clips.showId, n: count() }).from(clips).where(inArray(clips.showId, showIds)).groupBy(clips.showId),
              db
                  .select({ showId: drops.showId, n: sql<number>`coalesce(sum(${creatorEarnings.amountCents}), 0)::int` })
                  .from(creatorEarnings)
                  .innerJoin(slotClaims, eq(slotClaims.orderId, creatorEarnings.orderId))
                  .innerJoin(drops, eq(drops.id, slotClaims.dropId))
                  .where(and(eq(creatorEarnings.creatorUserId, userId), inArray(drops.showId, showIds)))
                  .groupBy(drops.showId),
              db
                  .select({ showId: auctions.showId, n: sql<number>`coalesce(sum(${creatorEarnings.amountCents}), 0)::int` })
                  .from(creatorEarnings)
                  .innerJoin(auctionBids, eq(auctionBids.orderId, creatorEarnings.orderId))
                  .innerJoin(auctions, eq(auctions.id, auctionBids.auctionId))
                  .where(and(eq(creatorEarnings.creatorUserId, userId), inArray(auctions.showId, showIds)))
                  .groupBy(auctions.showId),
          ])
        : [[], [], [], [], []];
    const by = <T extends { showId: string | null; n: number | string }>(rows: T[]) => new Map(rows.map((r) => [r.showId ?? '', Number(r.n)]));
    const presenceBy = by(presence);
    const slotsBy = by(slotRows);
    const clipsBy = by(clipRows);
    const dropRevBy = by(dropEarnings);
    const aucRevBy = by(auctionEarnings);
    let showViews = 0;
    let likes = 0;
    let slots = 0;
    const showStats = showRows.map((s) => {
        const unique = Math.max(s.peakViewers, presenceBy.get(s.id) ?? 0);
        const claimed = slotsBy.get(s.id) ?? 0;
        showViews += unique;
        likes += s.likeCount;
        slots += claimed;
        return {
            showId: s.id,
            displayId: showDisplayId(s.displayNumber),
            title: s.title,
            status: s.status,
            startedAt: s.startedAt?.toISOString() ?? null,
            peakViewers: s.peakViewers,
            uniqueViewers: unique,
            likes: s.likeCount,
            slotsClaimed: claimed,
            slotConversionPct: unique > 0 ? Math.round((claimed / unique) * 1000) / 10 : null,
            revenueCents: (dropRevBy.get(s.id) ?? 0) + (aucRevBy.get(s.id) ?? 0),
            clips: clipsBy.get(s.id) ?? 0,
        };
    });

    return {
        range,
        from: from?.toISOString() ?? null,
        to: now.toISOString(),
        currency: 'usd',
        totals: {
            earningsCents,
            royaltiesCents,
            liveRevenueCents,
            orders: orderIds.size,
            remixes: derived.length,
            showViews,
            likes,
            slotConversionPct: showViews > 0 ? Math.round((slots / showViews) * 1000) / 10 : null,
        },
        series,
        productMix,
        topBuilds,
        remixTree: remixTreeView,
        shows: showStats,
    };
}
