/**
 * Exactly-once processing for R3 provider events (membership, invoices), on the same
 * `webhook_events (provider, event_id)` table and semantics as the payment pipeline:
 * a processed event is a no-op on replay; a failed attempt (processed_at null) is retried.
 */
import { and, eq } from 'drizzle-orm';
import { getDb } from '../db';
import { webhookEvents } from '../db/schema';

export type DedupeResult<T> = { duplicate: true } | { duplicate: false; result: T };

export async function processOnce<T>(provider: string, eventId: string, eventType: string, payload: unknown, handler: () => Promise<T>): Promise<DedupeResult<T>> {
    const db = getDb();
    const [inserted] = await db
        .insert(webhookEvents)
        .values({ provider, eventId, eventType, payload: payload ?? {} })
        .onConflictDoNothing({ target: [webhookEvents.provider, webhookEvents.eventId] })
        .returning();
    if (!inserted) {
        const [existing] = await db
            .select()
            .from(webhookEvents)
            .where(and(eq(webhookEvents.provider, provider), eq(webhookEvents.eventId, eventId)));
        if (existing?.processedAt) return { duplicate: true };
    }
    try {
        const result = await handler();
        await db
            .update(webhookEvents)
            .set({ processedAt: new Date(), error: null })
            .where(and(eq(webhookEvents.provider, provider), eq(webhookEvents.eventId, eventId)));
        return { duplicate: false, result };
    } catch (err) {
        await db
            .update(webhookEvents)
            .set({ error: String(err instanceof Error ? err.message : err).slice(0, 1000) })
            .where(and(eq(webhookEvents.provider, provider), eq(webhookEvents.eventId, eventId)));
        throw err;
    }
}
