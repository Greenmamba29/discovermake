/**
 * ShowSnapshot for late joiners (workflow 06 rule 3), then the client follows the event
 * stream from `lastSeq`.
 *
 * `lastSeq` is read FIRST: anything appended while the snapshot is assembled is replayed by
 * the stream, and the client reducers are idempotent (absolute counts, set-the-focus, chat
 * deduped by seq), so a late joiner never misses or double-counts an event.
 *
 * The NOW SHOWING product is the payload of the last `product.focus` event, i.e. exactly the
 * signed state the stream announced, not a fresh recomputation.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { FeaturedProduct, type LiveEvent, type ShowSnapshot } from '../../contracts/live';
import { getDb } from '../db';
import { liveEvents, showLikes, shows } from '../db/schema';
import type { ShowAccess } from './access';
import { mutedUntil } from './chat';
import { currentDropForShow, isFairQueueDrop, maybeCloseDrop, viewerClaimsFor } from './drops';
import { auctionViewForShow } from './auctions';
import { listLiveEvents, rowToLiveEvent } from './events';
import { currentPoll, listQuestions } from './questions';
import { loadChannelViews, toDropView, toShowView } from './views';

export const RECENT_CHAT_LIMIT = 50;

/** Seqs of chat lines removed by the host (`chat.removed`). */
export async function removedChatSeqs(showId: string): Promise<Set<number>> {
    const rows = await getDb()
        .select({ payload: liveEvents.payload })
        .from(liveEvents)
        .where(and(eq(liveEvents.showId, showId), eq(liveEvents.event, 'chat.removed')));
    return new Set(rows.map((r) => Number((r.payload as { eventSeq?: number }).eventSeq)).filter((n) => Number.isFinite(n)));
}

export async function lastProductFocus(showId: string): Promise<LiveEvent | null> {
    const [row] = await getDb()
        .select()
        .from(liveEvents)
        .where(and(eq(liveEvents.showId, showId), eq(liveEvents.event, 'product.focus')))
        .orderBy(desc(liveEvents.seq))
        .limit(1);
    return row ? rowToLiveEvent(row) : null;
}

export async function buildSnapshot(access: ShowAccess): Promise<ShowSnapshot> {
    const db = getDb();
    const showId = access.show.id;
    const viewerId = access.viewer?.user.id ?? null;

    const current = await currentDropForShow(showId);
    if (current?.status === 'OPEN') await maybeCloseDrop(current.id);

    const [fresh] = await db.select().from(shows).where(eq(shows.id, showId));
    const show = fresh ?? access.show;
    const lastSeq = show.lastSeq;

    const channel = (await loadChannelViews([show.channelId], viewerId)).get(show.channelId)!;
    const focus = await lastProductFocus(showId);
    const parsedFocus = focus ? FeaturedProduct.safeParse(focus.payload) : null;

    const drop = await currentDropForShow(showId);
    const claims = drop && viewerId ? await viewerClaimsFor(drop.id, viewerId) : { claims: [], held: 0 };

    const removed = await removedChatSeqs(showId);
    const chatRows = await db
        .select()
        .from(liveEvents)
        .where(and(eq(liveEvents.showId, showId), inArray(liveEvents.event, ['chat.message'])))
        .orderBy(desc(liveEvents.seq))
        .limit(RECENT_CHAT_LIMIT + removed.size);
    const recentChat = chatRows
        .filter((r) => !removed.has(r.seq))
        .slice(0, RECENT_CHAT_LIMIT)
        .reverse()
        .map(rowToLiveEvent);

    const questions = (await listQuestions(showId)).reverse();
    const liked = viewerId
        ? (await db.select({ userId: showLikes.userId }).from(showLikes).where(and(eq(showLikes.showId, showId), eq(showLikes.userId, viewerId))).limit(1)).length > 0
        : false;
    const muted = viewerId ? await mutedUntil(showId, viewerId) : null;
    const replayEvents = show.status === 'ENDED' ? await listLiveEvents(showId, { after: 0, limit: 5000 }) : null;

    return {
        show: toShowView(show, channel),
        featured: parsedFocus?.success ? parsedFocus.data : null,
        drop: drop ? toDropView(drop, claims.held, await isFairQueueDrop(db, drop.id)) : null,
        questions,
        recentChat,
        lastSeq,
        viewerRole: access.role,
        poll: await currentPoll(showId, viewerId),
        slowModeSeconds: show.slowModeSeconds,
        viewerMutedUntil: muted?.toISOString() ?? null,
        viewerLiked: liked,
        viewerClaims: claims.claims,
        replayEvents,
        auction: await auctionViewForShow(showId, viewerId),
    };
}
