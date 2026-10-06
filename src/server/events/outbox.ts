/**
 * Transactional outbox (ADR-0002).
 *
 * `emitEvent(tx, ...)` MUST be called with the same transaction that performs the
 * state change, so the event row commits (or rolls back) atomically with it.
 * It validates the payload against `EVENT_PAYLOADS[type]`, inserts into
 * `domain_events`, and issues `pg_notify('domain_events', event_id)` (delivered
 * on commit) for optional LISTEN consumers.
 *
 * `publishPendingEvents()` is the relay: it claims unpublished rows with
 * `FOR UPDATE SKIP LOCKED`, hands them to subscribers, and marks them published.
 * R1 consumers are in-process; NATS/Kafka replaces the relay target later.
 */
import { and, asc, isNull, sql } from 'drizzle-orm';
import {
    EVENT_PAYLOADS,
    EVENT_SCHEMA_VERSIONS,
    type DomainEventEnvelope,
    type EventPayload,
    type EventType,
} from '../../contracts/events';
import { actorId as toActorId, type Actor } from '../../contracts/common';
import { getDb, type DbOrTx } from '../db';
import { domainEvents } from '../db/schema';
import { uuidv7 } from '../ids';

export const DOMAIN_EVENTS_CHANNEL = 'domain_events';

export type EmitEventInput<T extends EventType> = {
    type: T;
    payload: EventPayload<T>;
    actor: Actor;
    /** Journey id; for order-scoped events use `orders.correlation_id`. */
    correlationId: string;
    buildId?: string | null;
    /** Set for order-scoped events so the buyer timeline can find them. */
    orderId?: string | null;
    /** event_id of the event that caused this one, if any. */
    causationId?: string | null;
    /** Override the event time (tests / imports). Defaults to now. */
    timestamp?: Date;
};

/** Insert a domain event in the caller's transaction. Returns the ADR-0002 envelope. */
export async function emitEvent<T extends EventType>(tx: DbOrTx, input: EmitEventInput<T>): Promise<DomainEventEnvelope<T>> {
    const schema = EVENT_PAYLOADS[input.type];
    if (!schema) throw new Error(`Unknown event type: ${input.type}`);
    const payload = schema.parse(input.payload) as EventPayload<T>;
    const eventId = uuidv7();
    const timestamp = input.timestamp ?? new Date();
    const actor = toActorId(input.actor);

    await tx.insert(domainEvents).values({
        eventId,
        eventType: input.type,
        buildId: input.buildId ?? null,
        orderId: input.orderId ?? null,
        actorId: actor,
        timestamp,
        payload,
        correlationId: input.correlationId,
        causationId: input.causationId ?? null,
        schemaVersion: EVENT_SCHEMA_VERSIONS[input.type],
    });
    await tx.execute(sql`select pg_notify(${DOMAIN_EVENTS_CHANNEL}, ${eventId})`);

    return {
        event_id: eventId,
        event_type: input.type,
        build_id: input.buildId ?? null,
        actor_id: actor,
        timestamp: timestamp.toISOString(),
        payload,
        correlation_id: input.correlationId,
        causation_id: input.causationId ?? null,
        schema_version: EVENT_SCHEMA_VERSIONS[input.type],
    };
}

export type EventSubscriber = (event: DomainEventEnvelope) => Promise<void> | void;

const subscribers: EventSubscriber[] = [];

/** Register an in-process consumer. Consumers must be idempotent (keyed by event_id). */
export function subscribe(fn: EventSubscriber): () => void {
    subscribers.push(fn);
    return () => {
        const i = subscribers.indexOf(fn);
        if (i >= 0) subscribers.splice(i, 1);
    };
}

export type PublishResult = { published: number; failed: number };

/**
 * Relay a batch of unpublished events to subscribers and mark them published.
 * Safe to run concurrently (SKIP LOCKED). A subscriber error leaves the row
 * unpublished with `last_error` set and `publish_attempts` incremented.
 */
export async function publishPendingEvents(opts: { limit?: number; db?: DbOrTx; handlers?: EventSubscriber[] } = {}): Promise<PublishResult> {
    const db = opts.db ?? getDb();
    const handlers = opts.handlers ?? subscribers;
    const limit = opts.limit ?? 100;
    let published = 0;
    let failed = 0;

    await db.transaction(async (tx) => {
        const rows = await tx
            .select()
            .from(domainEvents)
            .where(and(isNull(domainEvents.publishedAt)))
            .orderBy(asc(domainEvents.timestamp))
            .limit(limit)
            .for('update', { skipLocked: true });

        for (const row of rows) {
            const envelope = toEnvelope(row);
            try {
                for (const h of handlers) await h(envelope);
                await tx
                    .update(domainEvents)
                    .set({ publishedAt: new Date(), publishAttempts: sql`${domainEvents.publishAttempts} + 1`, lastError: null })
                    .where(sql`${domainEvents.eventId} = ${row.eventId}`);
                published++;
            } catch (err) {
                await tx
                    .update(domainEvents)
                    .set({ publishAttempts: sql`${domainEvents.publishAttempts} + 1`, lastError: String(err instanceof Error ? err.message : err).slice(0, 1000) })
                    .where(sql`${domainEvents.eventId} = ${row.eventId}`);
                failed++;
            }
        }
    });

    return { published, failed };
}

export function toEnvelope(row: typeof domainEvents.$inferSelect): DomainEventEnvelope {
    return {
        event_id: row.eventId,
        event_type: row.eventType as EventType,
        build_id: row.buildId,
        actor_id: row.actorId,
        timestamp: row.timestamp.toISOString(),
        payload: row.payload as never,
        correlation_id: row.correlationId,
        causation_id: row.causationId,
        schema_version: row.schemaVersion,
    };
}
