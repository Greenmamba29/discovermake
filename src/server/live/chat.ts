/**
 * Live chat (workflow 06): signed-in viewers post lines that become `chat.message` events.
 * Enforced before anything is persisted: show is open (scheduled or live), keyword + link
 * filter, mutes, slow mode (hosts and staff exempt). Per-user rate limits live in the route.
 * Hosts remove lines with the `remove_chat` intent (`chat.removed`); the original event stays
 * in the append-only log and every client hides it.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { LiveEvent } from '../../contracts/live';
import { getDb } from '../db';
import { liveEvents, liveMutes } from '../db/schema';
import { ApiError } from '../http';
import { actorFor, requireSignedIn, type ShowAccess } from './access';
import { appendLiveEvent } from './events';
import { checkSlowMode, isMuted, moderateText } from './moderation';

export async function mutedUntil(showId: string, userId: string): Promise<Date | null> {
    const [m] = await getDb()
        .select({ until: liveMutes.until })
        .from(liveMutes)
        .where(and(eq(liveMutes.showId, showId), eq(liveMutes.userId, userId)))
        .limit(1);
    return m && isMuted(m.until) ? m.until : null;
}

export function assertShowOpenForTalk(access: ShowAccess): void {
    if (access.show.status !== 'LIVE' && access.show.status !== 'SCHEDULED') throw new ApiError('CONFLICT', 'This show has ended. Chat is closed.');
}

export async function assertNotMuted(access: ShowAccess & { viewer: NonNullable<ShowAccess['viewer']> }): Promise<void> {
    if (access.role === 'host' || access.role === 'cohost') return;
    const until = await mutedUntil(access.show.id, access.viewer.user.id);
    if (until) throw new ApiError('FORBIDDEN', `The host muted you until ${until.toISOString().slice(11, 16)} UTC.`, 403, { mutedUntil: until.toISOString() });
}

export async function postChat(access: ShowAccess, rawText: string, now: Date = new Date()): Promise<LiveEvent> {
    requireSignedIn(access);
    assertShowOpenForTalk(access);
    const moderated = moderateText(rawText);
    if (!moderated.ok) throw new ApiError('VALIDATION_FAILED', moderated.message, 400, { reason: moderated.reason });
    await assertNotMuted(access);
    const staff = access.role === 'host' || access.role === 'cohost';
    if (!staff && access.show.slowModeSeconds > 0) {
        const [last] = await getDb()
            .select({ at: liveEvents.at })
            .from(liveEvents)
            .where(and(eq(liveEvents.showId, access.show.id), eq(liveEvents.event, 'chat.message'), eq(liveEvents.actorId, access.viewer.user.id)))
            .orderBy(desc(liveEvents.seq))
            .limit(1);
        const slow = checkSlowMode(last?.at ?? null, access.show.slowModeSeconds, now);
        if (!slow.ok) {
            throw new ApiError('RATE_LIMITED', `Slow mode is on: wait ${slow.retryAfterSeconds} s before your next message.`, 429, { retryAfterSeconds: slow.retryAfterSeconds });
        }
    }
    return appendLiveEvent(access.show.id, { event: 'chat.message', actor: actorFor(access), payload: { text: moderated.text }, at: now });
}
