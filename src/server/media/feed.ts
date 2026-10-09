/**
 * Discover feed (workflow 06 "For You ranking", workflow 07 media objects).
 *
 * Tabs: For you · Live · New · Trending. For You is the heuristic from workflow 06:
 *
 *   rank = interest(viewer, tags) × novelty × creator_quality × engagement × makeability × availability
 *
 *   interest     0.35 + 0.65 × min(1, |viewer ∩ item interests| / min(|item interests|, 2)); 1 without
 *                viewer interests; × 1.3 for a followed channel. Viewer interests are the onboarding
 *                "Pick 5" (signed-in user, else this device).
 *   novelty      0.25 + 0.75 × e^(−age_days / 7)
 *   creator      0.7 + 0.3 × min(1, log10(1 + followers + 2 × paid orders) / 2)
 *   engagement   1 + 0.5 × log10(1 + clicks + 2 × plays + 4 × make_this + 8 × paid orders) (last 14 days)
 *   makeability  0.5 + 0.5 × score/100 (0.75 when unknown)
 *   availability 1 orderable · 0.85 makeable (approved design) · 0.6 otherwise · 1.25 live now
 *
 * Every impression / click / Make This is logged to `feed_events` for a future learned ranker.
 * Pages use a keyset cursor over (score desc, id asc) computed at a fixed `asOf`, so the next
 * page continues where the last one ended even while new items arrive. Candidate sets are the
 * latest 400 published builds and 200 clips: fine for V1; a search engine (Meilisearch) and a
 * vector store (Qdrant, "similar builds") can replace the candidate stage behind this interface.
 */
import 'server-only';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FeedEventInput, FeedItem, FeedResponse, FeedTab } from '../../contracts/media';
import type { ViewerContext } from '../auth/viewer';
import { getDb, type DbOrTx } from '../db';
import { buildPublications, builds, channelFollows, channels, clips, devicePreferences, feedEvents, orders, shows, users } from '../db/schema';
import { RateLimiter } from '../rate-limit';
import { toShowViews } from '../live/views';
import { buildCards, loadBuildCommerce } from './cards';
import { clipCards } from './clips';

export const FEED_PAGE_SIZE = 12;
const BUILD_CANDIDATES = 400;
const CLIP_CANDIDATES = 200;
const DAY_MS = 86_400_000;
const PAID = ['PAID', 'DISPATCHED', 'ACCEPTED', 'IN_PRODUCTION', 'QA_FAILED', 'QA_PASSED', 'SHIPPED', 'DELIVERED', 'COMPLETE'] as const;

/** Shared limiter for feed event logging (per user / device). */
export const feedEventsLimiter = new RateLimiter('media_feed_events', { kind: 'fixed_window', limit: 120, windowMs: 60_000 });

// ---------------------------------------------------------------------------
// Ranking (pure)
// ---------------------------------------------------------------------------

export type Engagement = { clicks: number; plays: number; makeThis: number; orders: number };
export type RankFeatures = {
    interests: readonly string[];
    ageMs: number;
    followers: number;
    paidOrders: number;
    engagement: Engagement;
    makeability: number | null;
    orderable: boolean;
    makeable: boolean;
    liveNow: boolean;
    followedChannel: boolean;
};

export function interestScore(viewer: readonly string[], item: readonly string[], followed = false): number {
    let s = 1;
    if (viewer.length) {
        const v = new Set(viewer);
        const overlap = item.filter((i) => v.has(i)).length;
        s = item.length === 0 ? 0.35 : 0.35 + 0.65 * Math.min(1, overlap / Math.min(item.length, 2));
    }
    return followed ? s * 1.3 : s;
}

export const noveltyScore = (ageMs: number) => 0.25 + 0.75 * Math.exp(-Math.max(0, ageMs) / DAY_MS / 7);
export const creatorQualityScore = (followers: number, paidOrders: number) => 0.7 + 0.3 * Math.min(1, Math.log10(1 + followers + 2 * paidOrders) / 2);
export const engagementWeight = (e: Engagement) => e.clicks + 2 * e.plays + 4 * e.makeThis + 8 * e.orders;
export const engagementScore = (e: Engagement) => 1 + 0.5 * Math.log10(1 + engagementWeight(e));
export const makeabilityScore = (m: number | null) => (m === null ? 0.75 : 0.5 + 0.5 * (Math.max(0, Math.min(100, m)) / 100));
export const availabilityScore = (f: Pick<RankFeatures, 'orderable' | 'makeable' | 'liveNow'>) => (f.liveNow ? 1.25 : f.orderable ? 1 : f.makeable ? 0.85 : 0.6);

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** The For You score. Deterministic: same features, same viewer, same score. */
export function rankScore(f: RankFeatures, viewerInterests: readonly string[]): number {
    return round6(
        interestScore(viewerInterests, f.interests, f.followedChannel) *
            noveltyScore(f.ageMs) *
            creatorQualityScore(f.followers, f.paidOrders) *
            engagementScore(f.engagement) *
            makeabilityScore(f.makeability) *
            availabilityScore(f),
    );
}

/** Trending: weighted engagement of the last 7 days, recency breaks ties. */
export function trendingScore(e: Engagement, ageMs: number): number {
    return round6(engagementWeight(e) + 0.01 / (1 + Math.max(0, ageMs) / DAY_MS));
}

// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------

const Cursor = z.object({ t: z.string(), s: z.number(), i: z.string(), a: z.number().int() });
type Cursor = z.infer<typeof Cursor>;

export function encodeCursor(c: Cursor): string {
    return Buffer.from(JSON.stringify(c)).toString('base64url');
}

export function decodeCursor(raw: string | null | undefined, tab: FeedTab): Cursor | null {
    if (!raw) return null;
    try {
        const c = Cursor.parse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')));
        return c.t === tab ? c : null;
    } catch {
        return null;
    }
}

type Scored = { kind: FeedItem['kind']; id: string; score: number };

/** Keyset page over (score desc, id asc). */
export function pageAfter<T extends Scored>(items: T[], cursor: Cursor | null, limit: number): { page: T[]; more: boolean } {
    const sorted = [...items].sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const start = cursor ? sorted.filter((x) => x.score < cursor.s || (x.score === cursor.s && x.id > cursor.i)) : sorted;
    return { page: start.slice(0, limit), more: start.length > limit };
}

// ---------------------------------------------------------------------------
// Viewer seeding
// ---------------------------------------------------------------------------

export type FeedViewer = { userId: string | null; deviceHash: string | null };

export async function viewerInterests(v: FeedViewer, db: DbOrTx = getDb()): Promise<FeedResponse['seededBy']> {
    if (v.userId) {
        const [u] = await db.select({ interests: users.interests }).from(users).where(eq(users.id, v.userId));
        if (u?.interests?.length) return { source: 'user', interests: u.interests };
    }
    if (v.deviceHash) {
        const [d] = await db.select({ interests: devicePreferences.interests }).from(devicePreferences).where(eq(devicePreferences.deviceHash, v.deviceHash));
        if (d?.interests?.length) return { source: 'device', interests: d.interests };
    }
    return { source: 'none', interests: [] };
}

// ---------------------------------------------------------------------------
// Candidate features
// ---------------------------------------------------------------------------

async function engagementFor(itemIds: string[], since: Date, db: DbOrTx): Promise<Map<string, Engagement>> {
    const out = new Map<string, Engagement>();
    if (!itemIds.length) return out;
    const rows = await db
        .select({ itemId: feedEvents.itemId, kind: feedEvents.kind, n: sql<number>`count(*)::int` })
        .from(feedEvents)
        .where(and(inArray(feedEvents.itemId, itemIds), gte(feedEvents.createdAt, since), inArray(feedEvents.kind, ['click', 'play', 'make_this', 'remix'])))
        .groupBy(feedEvents.itemId, feedEvents.kind);
    for (const r of rows) {
        const e = out.get(r.itemId) ?? { clicks: 0, plays: 0, makeThis: 0, orders: 0 };
        const n = Number(r.n);
        if (r.kind === 'click') e.clicks += n;
        else if (r.kind === 'play') e.plays += n;
        else e.makeThis += n;
        out.set(r.itemId, e);
    }
    return out;
}

/** Paid orders of each build plus of its direct remixes / copies. */
async function lineageOrders(buildIds: string[], since: Date | null, db: DbOrTx): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!buildIds.length) return out;
    const when = since ? gte(orders.createdAt, since) : undefined;
    const direct = await db
        .select({ id: orders.buildId, n: sql<number>`count(*)::int` })
        .from(orders)
        .where(and(inArray(orders.buildId, buildIds), inArray(orders.status, [...PAID]), when))
        .groupBy(orders.buildId);
    const derived = await db
        .select({ id: builds.derivedFromBuildId, n: sql<number>`count(*)::int` })
        .from(orders)
        .innerJoin(builds, eq(builds.id, orders.buildId))
        .where(and(inArray(builds.derivedFromBuildId, buildIds), inArray(orders.status, [...PAID]), when))
        .groupBy(builds.derivedFromBuildId);
    for (const r of [...direct, ...derived]) if (r.id) out.set(r.id, (out.get(r.id) ?? 0) + Number(r.n));
    return out;
}

type Candidate = Scored & { features: RankFeatures; publishedMs: number; trend: Engagement };

async function buildCandidates(viewer: FeedViewer, now: Date, db: DbOrTx): Promise<{ cands: Candidate[]; pubs: Map<string, typeof buildPublications.$inferSelect> }> {
    const pubs = await db.select().from(buildPublications).where(eq(buildPublications.visibility, 'public')).orderBy(desc(buildPublications.publishedAt)).limit(BUILD_CANDIDATES);
    if (!pubs.length) return { cands: [], pubs: new Map() };
    const ids = pubs.map((p) => p.buildId);
    const owners = [...new Set(pubs.map((p) => p.ownerUserId))];
    const [commerce, eng14, eng7, ord14, ord7, ordAll, ownerChannels, followed] = await Promise.all([
        loadBuildCommerce(ids, db, now),
        engagementFor(ids, new Date(now.getTime() - 14 * DAY_MS), db),
        engagementFor(ids, new Date(now.getTime() - 7 * DAY_MS), db),
        lineageOrders(ids, new Date(now.getTime() - 14 * DAY_MS), db),
        lineageOrders(ids, new Date(now.getTime() - 7 * DAY_MS), db),
        lineageOrders(ids, null, db),
        db.select({ id: channels.id, owner: channels.ownerUserId }).from(channels).where(inArray(channels.ownerUserId, owners)),
        viewer.userId ? db.select({ channelId: channelFollows.channelId }).from(channelFollows).where(eq(channelFollows.userId, viewer.userId)) : Promise.resolve([] as { channelId: string }[]),
    ]);
    const channelIds = ownerChannels.map((c) => c.id);
    const followerRows = channelIds.length
        ? await db.select({ channelId: channelFollows.channelId, n: sql<number>`count(*)::int` }).from(channelFollows).where(inArray(channelFollows.channelId, channelIds)).groupBy(channelFollows.channelId)
        : [];
    const followersByChannel = new Map(followerRows.map((r) => [r.channelId, Number(r.n)]));
    const channelByOwner = new Map(ownerChannels.map((c) => [c.owner!, c.id]));
    const followedSet = new Set(followed.map((f) => f.channelId));
    const creatorOrders = new Map<string, number>();
    for (const p of pubs) creatorOrders.set(p.ownerUserId, (creatorOrders.get(p.ownerUserId) ?? 0) + (ordAll.get(p.buildId) ?? 0));
    const empty: Engagement = { clicks: 0, plays: 0, makeThis: 0, orders: 0 };
    const cands = pubs.map((p) => {
        const c = commerce.get(p.buildId);
        const channelId = channelByOwner.get(p.ownerUserId);
        const publishedMs = (p.publishedAt ?? p.createdAt).getTime();
        const features: RankFeatures = {
            interests: p.interests ?? [],
            ageMs: now.getTime() - publishedMs,
            followers: channelId ? (followersByChannel.get(channelId) ?? 0) : 0,
            paidOrders: creatorOrders.get(p.ownerUserId) ?? 0,
            engagement: { ...(eng14.get(p.buildId) ?? empty), orders: ord14.get(p.buildId) ?? 0 },
            makeability: c?.quote?.makeabilityScore ?? c?.part?.dfm?.makeabilityScore ?? null,
            orderable: !!c?.quote,
            makeable: !!c?.part,
            liveNow: false,
            followedChannel: !!channelId && followedSet.has(channelId),
        };
        return { kind: 'build' as const, id: p.buildId, score: 0, features, publishedMs, trend: { ...(eng7.get(p.buildId) ?? empty), orders: ord7.get(p.buildId) ?? 0 } };
    });
    return { cands, pubs: new Map(pubs.map((p) => [p.buildId, p])) };
}

async function clipCandidates(viewer: FeedViewer, now: Date, db: DbOrTx): Promise<{ cands: Candidate[]; rows: Map<string, typeof clips.$inferSelect> }> {
    const rows = await db
        .select({ clip: clips })
        .from(clips)
        .innerJoin(shows, eq(shows.id, clips.showId))
        .where(eq(shows.status, 'ENDED'))
        .orderBy(desc(clips.createdAt))
        .limit(CLIP_CANDIDATES);
    if (!rows.length) return { cands: [], rows: new Map() };
    const list = rows.map((r) => r.clip);
    const ids = list.map((c) => c.id);
    const buildIds = [...new Set(list.map((c) => c.buildId).filter((b): b is string => !!b))];
    const channelIds = [...new Set(list.map((c) => c.channelId))];
    const [pubRows, commerce, eng14, eng7, followerRows, followed] = await Promise.all([
        buildIds.length ? db.select({ buildId: buildPublications.buildId, interests: buildPublications.interests, visibility: buildPublications.visibility }).from(buildPublications).where(inArray(buildPublications.buildId, buildIds)) : [],
        loadBuildCommerce(buildIds, db, now),
        engagementFor(ids, new Date(now.getTime() - 14 * DAY_MS), db),
        engagementFor(ids, new Date(now.getTime() - 7 * DAY_MS), db),
        db.select({ channelId: channelFollows.channelId, n: sql<number>`count(*)::int` }).from(channelFollows).where(inArray(channelFollows.channelId, channelIds)).groupBy(channelFollows.channelId),
        viewer.userId ? db.select({ channelId: channelFollows.channelId }).from(channelFollows).where(eq(channelFollows.userId, viewer.userId)) : Promise.resolve([] as { channelId: string }[]),
    ]);
    const interestsBy = new Map(pubRows.filter((p) => p.visibility === 'public').map((p) => [p.buildId, p.interests ?? []]));
    const followersBy = new Map(followerRows.map((r) => [r.channelId, Number(r.n)]));
    const followedSet = new Set(followed.map((f) => f.channelId));
    const empty: Engagement = { clicks: 0, plays: 0, makeThis: 0, orders: 0 };
    const cands = list.map((c) => {
        const com = c.buildId ? commerce.get(c.buildId) : null;
        const createdMs = c.createdAt.getTime();
        const features: RankFeatures = {
            interests: c.buildId ? (interestsBy.get(c.buildId) ?? []) : [],
            ageMs: now.getTime() - createdMs,
            followers: followersBy.get(c.channelId) ?? 0,
            paidOrders: 0,
            engagement: eng14.get(c.id) ?? empty,
            makeability: com?.quote?.makeabilityScore ?? null,
            orderable: !!com?.quote,
            makeable: !!com?.part,
            liveNow: false,
            followedChannel: followedSet.has(c.channelId),
        };
        return { kind: 'clip' as const, id: c.id, score: 0, features, publishedMs: createdMs, trend: eng7.get(c.id) ?? empty };
    });
    return { cands, rows: new Map(list.map((c) => [c.id, c])) };
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

async function hydrate(page: Scored[], ctx: { pubs?: Map<string, typeof buildPublications.$inferSelect>; clipRows?: Map<string, typeof clips.$inferSelect>; viewerId: string | null }, db: DbOrTx): Promise<FeedItem[]> {
    const buildPubs = page.filter((p) => p.kind === 'build').map((p) => ctx.pubs?.get(p.id)).filter((p): p is typeof buildPublications.$inferSelect => !!p);
    const clipRowList = page.filter((p) => p.kind === 'clip').map((p) => ctx.clipRows?.get(p.id)).filter((c): c is typeof clips.$inferSelect => !!c);
    const showIds = page.filter((p) => p.kind === 'show').map((p) => p.id);
    const [cards, clipViews, showRows] = await Promise.all([buildCards(buildPubs, db), clipCards(clipRowList, db), showIds.length ? db.select().from(shows).where(inArray(shows.id, showIds)) : []]);
    const showViews = await toShowViews(showRows, ctx.viewerId, db);
    const cardBy = new Map(cards.map((c) => [c.buildId, c]));
    const clipBy = new Map(clipViews.map((c) => [c.id, c]));
    const showBy = new Map(showViews.map((s) => [s.id, s]));
    return page.flatMap((p): FeedItem[] => {
        if (p.kind === 'build') {
            const build = cardBy.get(p.id);
            return build ? [{ kind: 'build', id: build.buildId, score: p.score, build }] : [];
        }
        if (p.kind === 'clip') {
            const clip = clipBy.get(p.id);
            return clip ? [{ kind: 'clip', id: clip.id, score: p.score, clip }] : [];
        }
        const show = showBy.get(p.id);
        return show ? [{ kind: 'show', id: show.id, score: p.score, show }] : [];
    });
}

async function liveShowCandidates(now: Date, tab: FeedTab, db: DbOrTx): Promise<Scored[]> {
    const rows = await db
        .select({ id: shows.id, status: shows.status, viewerCount: shows.viewerCount, scheduledFor: shows.scheduledFor, endedAt: shows.endedAt })
        .from(shows)
        .where(inArray(shows.status, tab === 'live' ? ['LIVE', 'SCHEDULED', 'ENDED'] : ['LIVE']))
        .orderBy(desc(shows.scheduledFor))
        .limit(200);
    return rows.flatMap((r): Scored[] => {
        if (r.status === 'LIVE') return [{ kind: 'show', id: r.id, score: 4e13 + r.viewerCount }];
        if (r.status === 'SCHEDULED' && r.scheduledFor.getTime() >= now.getTime() - 3_600_000 && r.scheduledFor.getTime() <= now.getTime() + 14 * DAY_MS) return [{ kind: 'show', id: r.id, score: 3e13 - r.scheduledFor.getTime() }];
        if (r.status === 'ENDED' && r.endedAt && r.endedAt.getTime() >= now.getTime() - 30 * DAY_MS) return [{ kind: 'show', id: r.id, score: 1e13 + r.endedAt.getTime() }];
        return [];
    });
}

export async function feedPage(input: { tab: FeedTab; cursor?: string | null; limit?: number; viewer: FeedViewer; now?: Date }): Promise<FeedResponse> {
    const db = getDb();
    const limit = Math.max(1, Math.min(input.limit ?? FEED_PAGE_SIZE, 30));
    const cursor = decodeCursor(input.cursor, input.tab);
    const now = cursor ? new Date(cursor.a) : (input.now ?? new Date());
    const seededBy = await viewerInterests(input.viewer, db);
    let scored: Scored[] = [];
    let pubs: Map<string, typeof buildPublications.$inferSelect> | undefined;
    let clipRows: Map<string, typeof clips.$inferSelect> | undefined;

    if (input.tab === 'live') {
        const [showsScored, clipC] = await Promise.all([liveShowCandidates(now, 'live', db), clipCandidates(input.viewer, now, db)]);
        clipRows = clipC.rows;
        scored = [...showsScored, ...clipC.cands.map((c) => ({ kind: c.kind, id: c.id, score: 2e13 + c.publishedMs }))];
    } else {
        const [b, c, live] = await Promise.all([buildCandidates(input.viewer, now, db), clipCandidates(input.viewer, now, db), input.tab === 'for_you' ? liveShowCandidates(now, input.tab, db) : Promise.resolve([] as Scored[])]);
        pubs = b.pubs;
        clipRows = c.rows;
        const all = [...b.cands, ...c.cands];
        if (input.tab === 'new') scored = all.map((x) => ({ kind: x.kind, id: x.id, score: x.publishedMs }));
        else if (input.tab === 'trending') scored = all.map((x) => ({ kind: x.kind, id: x.id, score: trendingScore(x.trend, x.features.ageMs) }));
        else {
            scored = all.map((x) => ({ kind: x.kind, id: x.id, score: rankScore(x.features, seededBy.interests) }));
            // Live shows ride on top of For You (availability 1.25 × novelty 1): a small, honest boost.
            scored.push(...live.map((l) => ({ ...l, score: round6(10 + (l.score - 4e13) / 1e6) })));
        }
    }
    const { page, more } = pageAfter(scored, cursor, limit);
    const items = await hydrate(page, { pubs, clipRows, viewerId: input.viewer.userId }, db);
    const last = page[page.length - 1];
    return { tab: input.tab, items, nextCursor: more && last ? encodeCursor({ t: input.tab, s: last.score, i: last.id, a: now.getTime() }) : null, seededBy };
}

// ---------------------------------------------------------------------------
// Feed events
// ---------------------------------------------------------------------------

export function viewerKeyFor(v: FeedViewer): string {
    if (v.userId) return v.userId;
    if (v.deviceHash) return `dev:${v.deviceHash.slice(0, 24)}`;
    return 'anon';
}

export async function recordFeedEvents(v: FeedViewer, events: FeedEventInput[], db: DbOrTx = getDb()): Promise<number> {
    if (!events.length) return 0;
    const viewerKey = viewerKeyFor(v);
    await db.insert(feedEvents).values(
        events.map((e) => ({ viewerKey, userId: v.userId, kind: e.kind, itemKind: e.itemKind, itemId: e.itemId, tab: e.tab, position: e.position ?? null, score: e.score ?? null })),
    );
    return events.length;
}

export function feedViewerFrom(viewer: ViewerContext | null, deviceHash: string | null): FeedViewer {
    return { userId: viewer?.user.id ?? null, deviceHash };
}

