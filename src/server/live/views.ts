/**
 * Row -> contract mappers for Live (channels, shows, drops).
 */
import { and, count, eq, inArray } from 'drizzle-orm';
import { UserId } from '../../contracts/common';
import { showDisplayId, type ChannelView, type DropView, type ShowView, type VideoSource } from '../../contracts/live';
import { getDb, type DbOrTx } from '../db';
import { channelFollows, channels, drops, shows } from '../db/schema';
import { env } from '../env';
import { isLiveKitConfigured } from './livekit';

export type ChannelRow = typeof channels.$inferSelect;
export type ShowRow = typeof shows.$inferSelect;
export type DropRow = typeof drops.$inferSelect;

function absolute(url: string): string | null {
    try {
        return new URL(url, env().APP_URL).toString();
    } catch {
        return null;
    }
}

/**
 * What the player should play:
 * - SCHEDULED / LIVE: the LiveKit room (when LiveKit is configured and the room exists),
 *   else the creator's HLS source (Owncast / MediaMTX), else nothing yet.
 * - ENDED: the recorded replay (HLS when it ends in .m3u8, else MP4), else nothing.
 */
export function videoSourceFor(show: Pick<ShowRow, 'status' | 'livekitRoom' | 'hlsUrl' | 'replayUrl'>): VideoSource {
    if (show.status === 'ENDED' || show.status === 'CANCELLED') {
        if (show.replayUrl) {
            if (/\.m3u8(\?|$)/i.test(show.replayUrl)) {
                const url = absolute(show.replayUrl);
                if (url) return { kind: 'hls', url };
            }
            // Same-origin path (committed fixture under /public) or an absolute URL (contract MediaUrl).
            if (/^\/[^/]/.test(show.replayUrl)) return { kind: 'mp4', url: show.replayUrl };
            const url = absolute(show.replayUrl);
            if (url) return { kind: 'mp4', url };
        }
        return { kind: 'none' };
    }
    if (show.livekitRoom && isLiveKitConfigured()) return { kind: 'livekit', roomName: show.livekitRoom };
    if (show.hlsUrl) {
        const url = absolute(show.hlsUrl);
        if (url) return { kind: 'hls', url };
    }
    return { kind: 'none' };
}

export function toChannelView(row: ChannelRow, followerCount: number, viewerFollows: boolean): ChannelView {
    return {
        id: row.id,
        handle: row.handle,
        name: row.name,
        kind: row.kind,
        categories: row.categories ?? [],
        bio: row.bio,
        ownerUserId: row.ownerUserId && UserId.safeParse(row.ownerUserId).success ? row.ownerUserId : null,
        followerCount,
        viewerFollows,
        createdAt: row.createdAt.toISOString(),
    };
}

/** Channel views for many channels (follower counts + whether the viewer follows), in one round trip each. */
export async function loadChannelViews(channelIds: string[], viewerId: string | null, db: DbOrTx = getDb()): Promise<Map<string, ChannelView>> {
    const ids = [...new Set(channelIds)];
    const out = new Map<string, ChannelView>();
    if (!ids.length) return out;
    const rows = await db.select().from(channels).where(inArray(channels.id, ids));
    const counts = await db
        .select({ channelId: channelFollows.channelId, n: count() })
        .from(channelFollows)
        .where(inArray(channelFollows.channelId, ids))
        .groupBy(channelFollows.channelId);
    const countBy = new Map(counts.map((c) => [c.channelId, Number(c.n)]));
    const followed = viewerId
        ? new Set(
              (await db.select({ channelId: channelFollows.channelId }).from(channelFollows).where(and(inArray(channelFollows.channelId, ids), eq(channelFollows.userId, viewerId)))).map(
                  (r) => r.channelId,
              ),
          )
        : new Set<string>();
    for (const r of rows) out.set(r.id, toChannelView(r, countBy.get(r.id) ?? 0, followed.has(r.id)));
    return out;
}

export function toShowView(row: ShowRow, channel: ChannelView): ShowView {
    return {
        id: row.id,
        displayId: showDisplayId(row.displayNumber),
        channel,
        title: row.title,
        format: row.format,
        status: row.status,
        scheduledFor: row.scheduledFor.toISOString(),
        startedAt: row.startedAt?.toISOString() ?? null,
        endedAt: row.endedAt?.toISOString() ?? null,
        source: videoSourceFor(row),
        viewerCount: row.viewerCount,
        likeCount: row.likeCount,
        thumbnailUrl: row.thumbnailUrl,
    };
}

export async function toShowViews(rows: ShowRow[], viewerId: string | null, db: DbOrTx = getDb()): Promise<ShowView[]> {
    const channelViews = await loadChannelViews(
        rows.map((r) => r.channelId),
        viewerId,
        db,
    );
    return rows.flatMap((r) => {
        const c = channelViews.get(r.channelId);
        return c ? [toShowView(r, c)] : [];
    });
}

export function toDropView(row: DropRow, viewerClaimedSlots: number, fairQueue?: boolean): DropView {
    return {
        id: row.id,
        showId: row.showId,
        buildId: row.buildId,
        title: row.title,
        priceCents: row.priceCents,
        totalSlots: row.totalSlots,
        claimedSlots: row.claimedSlots,
        thresholdSlots: row.thresholdSlots,
        perBuyerLimit: row.perBuyerLimit,
        status: row.status,
        opensAt: row.opensAt.toISOString(),
        closesAt: row.closesAt.toISOString(),
        viewerClaimedSlots,
        ...(fairQueue ? { fairQueue: true } : {}),
    };
}

/** Load a show row or null. */
export async function loadShow(showId: string, db: DbOrTx = getDb()): Promise<ShowRow | null> {
    const [row] = await db.select().from(shows).where(eq(shows.id, showId)).limit(1);
    return row ?? null;
}

export async function loadChannel(channelId: string, db: DbOrTx = getDb()): Promise<ChannelRow | null> {
    const [row] = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
    return row ?? null;
}
