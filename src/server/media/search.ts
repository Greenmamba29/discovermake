/**
 * Discover search: Postgres full-text search over published builds, channels and clips.
 *
 *   builds   to_tsvector('english', build_publications.search_text)   (GIN index)
 *   clips    to_tsvector('english', clips.search_text)                (GIN index)
 *   channels to_tsvector('english', name || handle || bio)            (small table, no index yet)
 *
 * Words match by prefix (`lamp` finds `lamps`, `bra` finds `bracket`). When the `pg_trgm`
 * extension is installed (`CREATE EXTENSION pg_trgm`, a trusted extension on Postgres 13+), a
 * trigram similarity match also catches typos; without it the search is FTS only. A search
 * engine (Meilisearch) can replace this module behind the same `searchMedia` interface.
 */
import 'server-only';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { SearchResponse } from '../../contracts/media';
import { getDb, type DbOrTx } from '../db';
import { buildPublications, channels, clips, shows } from '../db/schema';
import { loadChannelViews } from '../live/views';
import { buildCards } from './cards';
import { clipCards } from './clips';

const globalForTrgm = globalThis as unknown as { __dmTrgm?: { at: number; value: boolean } };

/** Is pg_trgm installed? Cached for a minute per process. */
export async function hasTrigram(db: DbOrTx = getDb()): Promise<boolean> {
    const cached = globalForTrgm.__dmTrgm;
    if (cached && Date.now() - cached.at < 60_000) return cached.value;
    let value = false;
    try {
        const rows = (await db.execute(sql`select 1 as ok from pg_extension where extname = 'pg_trgm'`)) as unknown as unknown[];
        value = rows.length > 0;
    } catch {
        value = false;
    }
    globalForTrgm.__dmTrgm = { at: Date.now(), value };
    return value;
}

export function resetTrigramCache(): void {
    globalForTrgm.__dmTrgm = undefined;
}

/** `bent lamp!` -> `bent:* & lamp:*` (only [a-z0-9] tokens, at most 6). Null when nothing is searchable. */
export function prefixTsQuery(q: string): string | null {
    const tokens = q
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/[\s-]+/)
        .filter((t) => t.length >= 2)
        .slice(0, 6);
    return tokens.length ? tokens.map((t) => `${t}:*`).join(' & ') : null;
}

export async function searchMedia(q: string, opts: { limit?: number; viewerId?: string | null } = {}): Promise<SearchResponse> {
    const db = getDb();
    const query = q.trim().slice(0, 100);
    const limit = Math.max(1, Math.min(opts.limit ?? 12, 30));
    const tsq = prefixTsQuery(query);
    const trgm = await hasTrigram(db);
    const mode: SearchResponse['mode'] = trgm ? 'fts+trgm' : 'fts';
    if (!tsq) return { q: query, builds: [], channels: [], clips: [], mode };

    const buildDoc = sql`to_tsvector('english', ${buildPublications.searchText})`;
    const buildMatch = trgm ? sql`(${buildDoc} @@ to_tsquery('english', ${tsq}) or similarity(${buildPublications.searchText}, ${query}) > 0.25)` : sql`${buildDoc} @@ to_tsquery('english', ${tsq})`;
    const buildRank = trgm ? sql`ts_rank(${buildDoc}, to_tsquery('english', ${tsq})) + similarity(${buildPublications.searchText}, ${query})` : sql`ts_rank(${buildDoc}, to_tsquery('english', ${tsq}))`;
    const pubRows = await db
        .select()
        .from(buildPublications)
        .where(and(eq(buildPublications.visibility, 'public'), buildMatch))
        .orderBy(desc(buildRank), desc(buildPublications.publishedAt))
        .limit(limit);

    const channelText = sql`(${channels.name} || ' ' || ${channels.handle} || ' ' || coalesce(${channels.bio}, ''))`;
    const channelDoc = sql`to_tsvector('english', ${channelText})`;
    const channelMatch = trgm ? sql`(${channelDoc} @@ to_tsquery('english', ${tsq}) or similarity(${channelText}, ${query}) > 0.25)` : sql`${channelDoc} @@ to_tsquery('english', ${tsq})`;
    const channelRows = await db.select({ id: channels.id }).from(channels).where(channelMatch).orderBy(desc(sql`ts_rank(${channelDoc}, to_tsquery('english', ${tsq}))`)).limit(limit);

    const clipDoc = sql`to_tsvector('english', ${clips.searchText})`;
    const clipMatch = trgm ? sql`(${clipDoc} @@ to_tsquery('english', ${tsq}) or similarity(${clips.searchText}, ${query}) > 0.25)` : sql`${clipDoc} @@ to_tsquery('english', ${tsq})`;
    const clipRows = await db
        .select({ clip: clips })
        .from(clips)
        .innerJoin(shows, eq(shows.id, clips.showId))
        .where(and(eq(shows.status, 'ENDED'), clipMatch))
        .orderBy(desc(sql`ts_rank(${clipDoc}, to_tsquery('english', ${tsq}))`), desc(clips.createdAt))
        .limit(limit);

    const channelViews = await loadChannelViews(
        channelRows.map((c) => c.id),
        opts.viewerId ?? null,
        db,
    );
    const ordered = channelRows.map((c) => channelViews.get(c.id)).filter((c): c is NonNullable<typeof c> => !!c);
    return { q: query, builds: await buildCards(pubRows, db), channels: ordered, clips: await clipCards(clipRows.map((r) => r.clip), db), mode };
}

/** Builds similar to `buildId` by tag / interest overlap (Qdrant can replace this behind the same call). */
export async function similarBuilds(buildId: string, limit = 6): Promise<string[]> {
    const db = getDb();
    const [me] = await db.select().from(buildPublications).where(eq(buildPublications.buildId, buildId));
    if (!me) return [];
    const mine = new Set([...(me.tags ?? []), ...(me.interests ?? [])]);
    if (!mine.size) return [];
    const others = await db.select().from(buildPublications).where(and(eq(buildPublications.visibility, 'public'), sql`${buildPublications.buildId} <> ${buildId}`)).orderBy(desc(buildPublications.publishedAt)).limit(400);
    return others
        .map((o) => ({ id: o.buildId, overlap: [...new Set([...(o.tags ?? []), ...(o.interests ?? [])])].filter((t) => mine.has(t)).length }))
        .filter((o) => o.overlap > 0)
        .sort((a, b) => b.overlap - a.overlap || (a.id < b.id ? -1 : 1))
        .slice(0, limit)
        .map((o) => o.id);
}

