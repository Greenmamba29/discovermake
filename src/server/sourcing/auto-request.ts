/**
 * Outbox subscriber for sourcing (registered in src/server/events/registry.ts).
 *
 * - `quote.created` with status REVIEW (outside the catalog, or no capable partner shop):
 *   queue one sourcing job for that part, design version and quantity unless one is
 *   already open, so Accio Work picks it up through `next_job` with no manual action
 *   (workflow 03 acceptance #1). Idempotent: redelivery finds the open job.
 * - `sourcing.approval_requested` and `sourcing.completed` (needs_desk): tell ops.
 *
 * `relayOutboxLazily()` lets `next_job` (and the buyer view) relay pending events at most
 * once a minute, so auto-requests materialize even where the cron only runs daily.
 */
import { eq } from 'drizzle-orm';
import { SYSTEM_ACTOR } from '../../contracts/common';
import type { DomainEventEnvelope } from '../../contracts/events';
import { getDb } from '../db';
import { parts, quotes } from '../db/schema';
import { notify } from '../notify';
import { createSourcingJob } from './jobs';

/** Create the sourcing job for a REVIEW quote. Returns the job id (new or already open), or null when not applicable. */
export async function autoRequestForQuote(quoteId: string): Promise<string | null> {
    const db = getDb();
    const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId));
    if (!quote || quote.status !== 'REVIEW') return null;
    const [part] = await db.select({ designVersion: parts.designVersion }).from(parts).where(eq(parts.id, quote.partId));
    // The part was re-uploaded since: the quote is stale and its successor gets its own event.
    if (!part || part.designVersion !== quote.designVersion) return null;
    const { job } = await createSourcingJob({
        buildId: quote.buildId,
        partId: quote.partId,
        quantity: quote.quantity,
        fromQuoteId: quote.id,
        actor: SYSTEM_ACTOR,
        channel: 'accio',
        reuseOpen: true,
        notes: 'Requested automatically: this configuration is outside the instant-quote catalog or no partner shop can run it.',
    });
    return job.id;
}

export async function handleSourcingEvent(event: DomainEventEnvelope): Promise<void> {
    switch (event.event_type) {
        case 'quote.created': {
            const p = event.payload as { quoteId: string; status: string };
            if (p.status === 'REVIEW') await autoRequestForQuote(p.quoteId);
            return;
        }
        case 'sourcing.approval_requested': {
            const p = event.payload as { approvalId: string; kind: string; approverRole: string; jobId: string | null };
            await notify('ops.alert', {
                subject: `Sourcing approval needed: ${p.kind}`,
                message: `Approval ${p.approvalId} (${p.kind}, decided by ${p.approverRole}) is pending${p.jobId ? ` for sourcing job ${p.jobId}` : ''}. Decide it with POST /api/admin/sourcing/approvals/${p.approvalId}/decision.`,
            });
            return;
        }
        case 'sourcing.completed': {
            const p = event.payload as { jobId: string; outcome: string };
            if (p.outcome === 'needs_desk') {
                await notify('ops.alert', {
                    subject: 'Sourcing job handed to the desk',
                    message: `The sourcing agent could not finish job ${p.jobId}; it is queued on the desk channel. See /api/admin/sourcing/jobs/${p.jobId}.`,
                });
            }
            return;
        }
        default:
            return;
    }
}

/**
 * Per-instance throttle (same pattern as the R1 lazy offer sweep). With N instances the
 * relay can run up to N times a minute, which is safe: `publishPendingEvents` claims rows
 * with FOR UPDATE SKIP LOCKED and marks them published in the same transaction, so an event
 * is never delivered twice; the cost is only N cheap polling queries per minute.
 */
let lastRelayAt = 0;
const RELAY_INTERVAL_MS = 60_000;

/** Throttled, best-effort outbox relay (never throws). */
export async function relayOutboxLazily(now: number = Date.now()): Promise<void> {
    if (now - lastRelayAt < RELAY_INTERVAL_MS) return;
    lastRelayAt = now;
    try {
        const { ensureSubscribers } = await import('../events/registry');
        const { publishPendingEvents } = await import('../events/outbox');
        await ensureSubscribers();
        await publishPendingEvents({ limit: 100 });
    } catch (err) {
        console.error('[sourcing] lazy outbox relay failed', err);
    }
}

/** Test hook. */
export function resetRelayThrottle(): void {
    lastRelayAt = 0;
}
