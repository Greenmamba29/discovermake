/**
 * Viewer counts without LiveKit: every open event stream heartbeats a presence row; the
 * count is the number of rows seen in the last PRESENCE_WINDOW_MS. When the count changes
 * the show row is updated and a `viewer.count` event is appended (at most once per beat).
 * With LiveKit configured, room participant webhooks set the count instead.
 */
import { and, count, eq, gt, lt, sql } from 'drizzle-orm';
import { getDb, withTx } from '../db';
import { livePresence, shows } from '../db/schema';
import { appendLiveEvent, SYSTEM_LIVE_ACTOR } from './events';

export const PRESENCE_WINDOW_MS = 45_000;

export async function touchPresence(showId: string, viewerKey: string, now: Date = new Date()): Promise<void> {
    await getDb()
        .insert(livePresence)
        .values({ showId, viewerKey, lastSeenAt: now })
        .onConflictDoUpdate({ target: [livePresence.showId, livePresence.viewerKey], set: { lastSeenAt: now } });
}

export async function dropPresence(showId: string, viewerKey: string): Promise<void> {
    await getDb()
        .delete(livePresence)
        .where(and(eq(livePresence.showId, showId), eq(livePresence.viewerKey, viewerKey)));
}

/** Recount viewers; when the number changed, persist it and announce `viewer.count`. */
export async function refreshViewerCount(showId: string, now: Date = new Date()): Promise<number> {
    const db = getDb();
    const since = new Date(now.getTime() - PRESENCE_WINDOW_MS);
    await db.delete(livePresence).where(and(eq(livePresence.showId, showId), lt(livePresence.lastSeenAt, new Date(now.getTime() - 10 * PRESENCE_WINDOW_MS))));
    const [c] = await db
        .select({ n: count() })
        .from(livePresence)
        .where(and(eq(livePresence.showId, showId), gt(livePresence.lastSeenAt, since)));
    const n = Number(c?.n ?? 0);
    return setViewerCount(showId, n, now);
}

export async function setViewerCount(showId: string, n: number, now: Date = new Date()): Promise<number> {
    await withTx(async (tx) => {
        const [show] = await tx.select({ viewerCount: shows.viewerCount, status: shows.status }).from(shows).where(eq(shows.id, showId)).for('update');
        if (!show || show.viewerCount === n || show.status !== 'LIVE') return;
        await tx
            .update(shows)
            .set({ viewerCount: n, peakViewers: sql`greatest(${shows.peakViewers}, ${n})` })
            .where(eq(shows.id, showId));
        await appendLiveEvent(showId, { event: 'viewer.count', actor: SYSTEM_LIVE_ACTOR, payload: { viewerCount: n }, at: now }, tx);
    });
    return n;
}
