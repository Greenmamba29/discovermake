/**
 * Batch loaders shared by Discover, channels, search and the build page: published builds as
 * `BuildCard`s (cover / preview, orderable price, creator, remix count) and creator refs.
 */
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { BuildCard, CreatorRef, PublicationView, RemixLicense } from '../../contracts/media';
import { getDb, type DbOrTx } from '../db';
import { buildPublications, builds, channels, parts, quotes, users } from '../db/schema';
import { isQuoteOrderable } from '../quote';

export type PublicationRow = typeof buildPublications.$inferSelect;
type QuoteRow = typeof quotes.$inferSelect;
type PartRow = typeof parts.$inferSelect;

/** Same-origin cover URL (streams the chosen image attachment of a public build). */
export function coverUrlFor(pub: Pick<PublicationRow, 'buildId' | 'coverAttachmentId'>): string | null {
    return pub.coverAttachmentId ? `/api/media/builds/${encodeURIComponent(pub.buildId)}/cover` : null;
}

export async function loadCreatorRefs(userIds: string[], db: DbOrTx = getDb()): Promise<Map<string, CreatorRef>> {
    const ids = [...new Set(userIds.filter(Boolean))];
    const out = new Map<string, CreatorRef>();
    if (!ids.length) return out;
    const [userRows, channelRows] = await Promise.all([
        db.select({ id: users.id, displayName: users.displayName, handle: users.handle }).from(users).where(inArray(users.id, ids)),
        db.select({ ownerUserId: channels.ownerUserId, handle: channels.handle, name: channels.name }).from(channels).where(inArray(channels.ownerUserId, ids)),
    ]);
    const channelBy = new Map(channelRows.map((c) => [c.ownerUserId!, c]));
    for (const u of userRows) {
        const c = channelBy.get(u.id);
        out.set(u.id, { userId: u.id, displayName: u.displayName, handle: u.handle, channelHandle: c?.handle ?? null, channelName: c?.name ?? null });
    }
    for (const id of ids) if (!out.has(id)) out.set(id, { userId: id, displayName: null, handle: null, channelHandle: null, channelName: null });
    return out;
}

export function creatorName(c: CreatorRef | null | undefined): string | null {
    if (!c) return null;
    return c.displayName ?? (c.handle ? `@${c.handle}` : c.channelName);
}

export type BuildCommerce = { part: PartRow | null; quote: QuoteRow | null };

/** Latest READY part and its latest orderable BINDING quote, for many builds at once. */
export async function loadBuildCommerce(buildIds: string[], db: DbOrTx = getDb(), now: Date = new Date()): Promise<Map<string, BuildCommerce>> {
    const ids = [...new Set(buildIds)];
    const out = new Map<string, BuildCommerce>();
    if (!ids.length) return out;
    const partRows = await db
        .select()
        .from(parts)
        .where(and(inArray(parts.buildId, ids), eq(parts.status, 'READY')))
        .orderBy(desc(parts.createdAt));
    const latestPart = new Map<string, PartRow>();
    for (const p of partRows) if (!latestPart.has(p.buildId)) latestPart.set(p.buildId, p);
    const partIds = [...latestPart.values()].map((p) => p.id);
    const quoteRows = partIds.length
        ? await db
              .select()
              .from(quotes)
              .where(and(inArray(quotes.partId, partIds), eq(quotes.status, 'READY'), eq(quotes.trustLevel, 'BINDING'), gt(quotes.validUntil, now)))
              .orderBy(desc(quotes.createdAt))
        : [];
    for (const id of ids) {
        const part = latestPart.get(id) ?? null;
        const quote = part ? (quoteRows.find((q) => q.partId === part.id && isQuoteOrderable(q, { designVersion: part.designVersion, rulesetVersion: part.rulesetVersion }, now)) ?? null) : null;
        out.set(id, { part, quote });
    }
    return out;
}

export async function remixCounts(buildIds: string[], db: DbOrTx = getDb()): Promise<Map<string, number>> {
    const ids = [...new Set(buildIds)];
    if (!ids.length) return new Map();
    const rows = await db
        .select({ parent: builds.derivedFromBuildId, n: sql<number>`count(*)::int` })
        .from(builds)
        .where(inArray(builds.derivedFromBuildId, ids))
        .groupBy(builds.derivedFromBuildId);
    return new Map(rows.map((r) => [r.parent!, Number(r.n)]));
}

/** Cards for published builds, in the order of `pubs`. */
export async function buildCards(pubs: PublicationRow[], db: DbOrTx = getDb()): Promise<BuildCard[]> {
    if (!pubs.length) return [];
    const ids = pubs.map((p) => p.buildId);
    const [buildRows, commerce, creators, remixes] = await Promise.all([
        db.select({ id: builds.id, displayId: builds.displayId }).from(builds).where(inArray(builds.id, ids)),
        loadBuildCommerce(ids, db),
        loadCreatorRefs(pubs.map((p) => p.ownerUserId), db),
        remixCounts(ids, db),
    ]);
    const displayBy = new Map(buildRows.map((b) => [b.id, b.displayId]));
    return pubs.flatMap((p) => {
        const displayId = displayBy.get(p.buildId);
        if (!displayId) return [];
        const c = commerce.get(p.buildId);
        const preview = c?.part?.preview ?? null;
        const makeability = c?.quote?.makeabilityScore ?? c?.part?.dfm?.makeabilityScore ?? null;
        return [
            {
                buildId: p.buildId,
                displayId,
                title: p.title,
                tags: p.tags ?? [],
                interests: p.interests ?? [],
                license: p.license as RemixLicense,
                royaltyPct: p.royaltyPct,
                coverUrl: coverUrlFor(p),
                previewSvg: preview?.svgPath ?? null,
                previewSize: preview ? { widthMm: preview.widthMm, heightMm: preview.heightMm } : null,
                priceCents: c?.quote?.unitPriceCents ?? null,
                currency: c?.quote?.currency ?? 'usd',
                makeability: makeability === null ? null : Math.max(0, Math.min(100, Math.round(makeability))),
                orderable: !!c?.quote,
                partId: c?.part?.id ?? null,
                remixCount: remixes.get(p.buildId) ?? 0,
                creator: creators.get(p.ownerUserId)!,
                publishedAt: (p.publishedAt ?? p.createdAt).toISOString(),
            },
        ];
    });
}

export async function publicationView(pub: PublicationRow, db: DbOrTx = getDb()): Promise<PublicationView> {
    const [build] = await db.select({ displayId: builds.displayId }).from(builds).where(eq(builds.id, pub.buildId));
    const creators = await loadCreatorRefs([pub.ownerUserId], db);
    return {
        buildId: pub.buildId,
        displayId: build?.displayId ?? 'DM-00000',
        visibility: pub.visibility,
        license: pub.license,
        royaltyPct: pub.royaltyPct,
        title: pub.title,
        description: pub.description,
        tags: pub.tags ?? [],
        interests: pub.interests ?? [],
        coverUrl: coverUrlFor(pub),
        publishedAt: pub.publishedAt?.toISOString() ?? null,
        updatedAt: pub.updatedAt.toISOString(),
        creator: creators.get(pub.ownerUserId)!,
    };
}

export async function loadPublication(buildId: string, db: DbOrTx = getDb()): Promise<PublicationRow | null> {
    const [row] = await db.select().from(buildPublications).where(eq(buildPublications.buildId, buildId)).limit(1);
    return row ?? null;
}
