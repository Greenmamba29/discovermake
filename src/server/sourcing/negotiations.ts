/**
 * Negotiation threads: one row per (job, supplier), upserted by `update_negotiation`
 * with an append-only note log. Negotiating is inside the boundary only while the
 * job's approval policy allows it (`allow_negotiation`).
 */
import { eq, sql } from 'drizzle-orm';
import type { UpdateNegotiationInput } from '../../contracts/sourcing';
import { withTx } from '../db';
import { sourcingNegotiations, suppliers } from '../db/schema';
import { emitEvent } from '../events/outbox';
import { enforceBoundary } from './boundary';
import { notFound } from './errors';
import { getJobRow, lockJobForWrite, writerActor, type JobWriter } from './jobs';
import type { NegotiationRow } from './views';

export type UpdateNegotiationArgs = Omit<UpdateNegotiationInput, 'lease_id'>;

export async function updateNegotiation(input: UpdateNegotiationArgs, writer: JobWriter, opts: { now?: Date } = {}): Promise<NegotiationRow> {
    const now = opts.now ?? new Date();
    const actor = writerActor(writer);
    const preview = await getJobRow(input.sourcing_request_id);
    if (!preview) throw notFound('Sourcing job');
    await enforceBoundary('negotiate', { job: preview, actor, tool: 'update_negotiation', supplierId: input.supplier_id });
    await enforceBoundary('update_notes', { job: preview, actor, tool: 'update_negotiation', supplierId: input.supplier_id });

    return withTx(async (tx) => {
        const job = await lockJobForWrite(tx, input.sourcing_request_id, writer, { now });
        const [supplier] = await tx.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.id, input.supplier_id));
        if (!supplier) throw notFound('Supplier');
        const note = { at: now.toISOString(), status: input.status, note: input.note };
        const [row] = await tx
            .insert(sourcingNegotiations)
            .values({ jobId: job.id, supplierId: supplier.id, status: input.status, notes: [note], createdAt: now, updatedAt: now })
            .onConflictDoUpdate({
                target: [sourcingNegotiations.jobId, sourcingNegotiations.supplierId],
                set: { status: input.status, notes: sql`${sourcingNegotiations.notes} || ${JSON.stringify([note])}::jsonb`, updatedAt: now },
            })
            .returning();
        await emitEvent(tx, {
            type: 'sourcing.negotiation_updated',
            payload: { jobId: job.id, supplierId: supplier.id, status: input.status },
            actor,
            correlationId: job.buildId,
            buildId: job.buildId,
            timestamp: now,
        });
        return row;
    });
}
