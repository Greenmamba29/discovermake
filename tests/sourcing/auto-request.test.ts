/**
 * Workflow 03 acceptance #1: a REVIEW quote (outside the catalog / no capable shop)
 * queues exactly one sourcing job, which Accio Work leases through next_job with no
 * manual action (the outbox relay runs lazily inside next_job).
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { SYSTEM_ACTOR } from '@/contracts/common';
import { NextJobResult } from '@/contracts/sourcing';
import { withTx } from '@/server/db';
import { domainEvents, quotes, sourcingJobs } from '@/server/db/schema';
import { emitEvent, publishPendingEvents, toEnvelope } from '@/server/events/outbox';
import { ensureSubscribers } from '@/server/events/registry';
import { autoRequestForQuote, handleSourcingEvent, resetRelayThrottle } from '@/server/sourcing/auto-request';
import { callSourcingTool } from '@/server/sourcing/mcp';
import { useTestDb } from '../support/db';
import { createQuoteFixture } from '../shop/fixtures';
import { newClient, quietConsole } from './fixtures';

describe('auto-request on REVIEW quotes', () => {
    const ctx = useTestDb({ seed: true });
    beforeAll(() => quietConsole());

    async function reviewQuote(quantity = 30) {
        const f = await createQuoteFixture(ctx.db, { quantity });
        await ctx.db.update(quotes).set({ status: 'REVIEW', trustLevel: 'SUPPLIER_ESTIMATE' }).where(eq(quotes.id, f.quote.id));
        const event = await withTx((tx) =>
            emitEvent(tx, {
                type: 'quote.created',
                payload: {
                    quoteId: f.quote.id,
                    partId: f.part.id,
                    quantity,
                    unitPriceCents: f.quote.unitPriceCents,
                    subtotalCents: f.quote.subtotalCents,
                    trustLevel: 'SUPPLIER_ESTIMATE',
                    status: 'REVIEW',
                    rulesetVersion: f.quote.rulesetVersion,
                },
                actor: SYSTEM_ACTOR,
                correlationId: f.build.id,
                buildId: f.build.id,
            }),
        );
        return { ...f, event };
    }

    const jobsFor = (partId: string) => ctx.db.select().from(sourcingJobs).where(eq(sourcingJobs.partId, partId));

    it('the registered subscriber queues one job for the part, version and quantity; redelivery is idempotent', async () => {
        const { part, quote, event } = await reviewQuote(30);
        await ensureSubscribers();
        const relay = await publishPendingEvents({ limit: 500 });
        expect(relay.failed).toBe(0);
        const jobs = await jobsFor(part.id);
        expect(jobs).toHaveLength(1);
        expect(jobs[0]).toMatchObject({ status: 'QUEUED', channel: 'accio', designVersion: quote.designVersion, createdBy: 'system:discovermake' });
        expect(jobs[0].request.quantity).toBe(30);
        expect(jobs[0].request.material).toContain('Aluminum 5052-H32');

        const [row] = await ctx.db.select().from(domainEvents).where(eq(domainEvents.eventId, event.event_id));
        await handleSourcingEvent(toEnvelope(row));
        await handleSourcingEvent(toEnvelope(row));
        expect(await jobsFor(part.id)).toHaveLength(1);
        const requested = await ctx.db
            .select()
            .from(domainEvents)
            .where(and(eq(domainEvents.eventType, 'sourcing.requested'), eq(domainEvents.buildId, jobs[0].buildId)));
        expect(requested).toHaveLength(1);
    });

    it('concurrent deliveries still create a single job', async () => {
        const { part, quote } = await reviewQuote(45);
        const ids = await Promise.all([0, 1, 2, 3].map(() => autoRequestForQuote(quote.id)));
        expect(new Set(ids).size).toBe(1);
        expect(await jobsFor(part.id)).toHaveLength(1);
    });

    it('ignores READY quotes and quotes for an outdated design version', async () => {
        const ready = await createQuoteFixture(ctx.db, { quantity: 12 });
        expect(await autoRequestForQuote(ready.quote.id)).toBeNull();
        const { quote } = await reviewQuote(13);
        await ctx.db.update(quotes).set({ designVersion: 0 }).where(eq(quotes.id, quote.id));
        expect(await autoRequestForQuote(quote.id)).toBeNull();
    });

    it('next_job materializes and leases the auto-requested job with no manual action', async () => {
        // Clear the queue first.
        const drain = await newClient('drain');
        await ensureSubscribers();
        await publishPendingEvents({ limit: 500 });
        for (;;) {
            const r = await callSourcingTool('discovermake.sourcing.next_job', {}, { client: { id: drain.clientId, name: 'drain' } });
            if (!(r.structuredContent as { job: unknown }).job) break;
        }
        const { part } = await reviewQuote(60);
        expect(await jobsFor(part.id)).toHaveLength(0);
        resetRelayThrottle();
        const client = await newClient('accio');
        const r = await callSourcingTool('discovermake.sourcing.next_job', {}, { client: { id: client.clientId, name: 'accio' } });
        const leased = NextJobResult.parse(r.structuredContent);
        expect(leased.job?.part_id).toBe(part.id);
        expect(leased.job?.quantity).toBe(60);
        expect(leased.lease_id).not.toBeNull();
    });
});
