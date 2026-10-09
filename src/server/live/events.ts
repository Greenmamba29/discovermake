/**
 * The Live Build Protocol event log (`live_events`).
 *
 * `appendLiveEvent` is the ONLY writer. Inside one transaction it:
 *   1. locks the show row (SELECT ... FOR UPDATE), so concurrent appends serialize per show;
 *   2. assigns seq = shows.last_seq + 1 (unique (show_id, seq) backs it up);
 *   3. computes stream_ts_ms from shows.started_at (0 before the show starts);
 *   4. signs SIGNED_LIVE_EVENTS (HMAC over the canonical event without `sig`);
 *   5. inserts the row, advances shows.last_seq and, when asked, mirrors a domain event
 *      to the outbox in the same transaction.
 */
import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import type { EventType } from '../../contracts/events';
import type { LiveActorKind, LiveEvent, LiveEventType } from '../../contracts/live';
import { withTx, getDb, type DbOrTx } from '../db';
import { liveEvents, shows } from '../db/schema';
import { emitEvent, type EmitEventInput } from '../events/outbox';
import { ApiError } from '../http';
import { isSignedEventType, signLiveEvent, type UnsignedLiveEvent } from './signing';

export type LiveActor = { kind: LiveActorKind; id: string; name: string | null };

export const SYSTEM_LIVE_ACTOR: LiveActor = { kind: 'system', id: 'discovermake', name: 'DiscoverMake' };
export const MAKE_AI_LIVE_ACTOR: LiveActor = { kind: 'agent', id: 'make_ai', name: 'Make AI' };

/** Actor kinds allowed on server-signed events. A viewer can cause one (a claim) but never sign one. */
const SIGNING_ACTORS: readonly LiveActorKind[] = ['host', 'cohost', 'system', 'agent', 'machine'];

export type AppendLiveEventInput = {
    event: LiveEventType;
    actor: LiveActor;
    buildId?: string | null;
    designVersion?: number | null;
    payload?: Record<string, unknown>;
    at?: Date;
    /** Domain event mirrored to the outbox in the same transaction. */
    domain?: EmitEventInput<EventType>;
};

type Row = typeof liveEvents.$inferSelect;

export function rowToLiveEvent(row: Row): LiveEvent {
    return {
        v: 1,
        event: row.event,
        showId: row.showId,
        seq: row.seq,
        streamTsMs: row.streamTsMs,
        actor: { kind: row.actorKind, id: row.actorId, name: row.actorName },
        ...(row.buildId ? { buildId: row.buildId } : {}),
        ...(row.designVersion ? { designVersion: row.designVersion } : {}),
        payload: row.payload ?? {},
        at: row.at.toISOString(),
        ...(row.sig ? { sig: row.sig } : {}),
    } as LiveEvent;
}

/** JSON round trip: what jsonb will hand back (drops undefined, normalizes numbers). */
function jsonSafe(payload: Record<string, unknown>): Record<string, unknown> {
    return JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
}

export async function appendLiveEvent(showId: string, input: AppendLiveEventInput, tx?: DbOrTx): Promise<LiveEvent> {
    const signed = isSignedEventType(input.event);
    if (signed && !SIGNING_ACTORS.includes(input.actor.kind)) {
        throw new ApiError('FORBIDDEN', `${input.event} is a server-signed event and cannot be emitted by a ${input.actor.kind}`, 403);
    }
    return withTx(async (t) => {
        const [show] = await t.select({ id: shows.id, lastSeq: shows.lastSeq, startedAt: shows.startedAt }).from(shows).where(eq(shows.id, showId)).for('update');
        if (!show) throw new ApiError('NOT_FOUND', 'Show not found');
        const seq = show.lastSeq + 1;
        const at = input.at ?? new Date();
        const streamTsMs = show.startedAt ? Math.max(0, at.getTime() - show.startedAt.getTime()) : 0;
        const base: UnsignedLiveEvent = {
            v: 1,
            event: input.event,
            showId,
            seq,
            streamTsMs,
            actor: { kind: input.actor.kind, id: input.actor.id.slice(0, 128), name: input.actor.name?.slice(0, 80) ?? null },
            ...(input.buildId ? { buildId: input.buildId } : {}),
            ...(input.designVersion ? { designVersion: input.designVersion } : {}),
            payload: jsonSafe(input.payload ?? {}),
            at: at.toISOString(),
        };
        const sig = signed ? signLiveEvent(base) : undefined;
        await t.insert(liveEvents).values({
            showId,
            seq,
            streamTsMs,
            event: base.event,
            actorKind: base.actor.kind,
            actorId: base.actor.id,
            actorName: base.actor.name,
            buildId: base.buildId ?? null,
            designVersion: base.designVersion ?? null,
            payload: base.payload,
            at,
            sig: sig ?? null,
        });
        await t.update(shows).set({ lastSeq: seq }).where(eq(shows.id, showId));
        if (input.domain) await emitEvent(t, { ...input.domain, timestamp: input.domain.timestamp ?? at });
        return { ...base, ...(sig ? { sig } : {}) } as LiveEvent;
    }, tx);
}

/** Events with seq > after, oldest first. */
export async function listLiveEvents(showId: string, opts: { after?: number; limit?: number; types?: readonly LiveEventType[] } = {}, db: DbOrTx = getDb()): Promise<LiveEvent[]> {
    const where = [eq(liveEvents.showId, showId), gt(liveEvents.seq, opts.after ?? 0)];
    if (opts.types?.length) where.push(inArray(liveEvents.event, [...opts.types]));
    const rows = await db
        .select()
        .from(liveEvents)
        .where(and(...where))
        .orderBy(asc(liveEvents.seq))
        .limit(Math.min(opts.limit ?? 500, 5000));
    return rows.map(rowToLiveEvent);
}
