/**
 * Candidate suppliers found by the sourcing agent (or the ops desk).
 *
 * Suppliers are global and de-duplicated on (platform, platform_ref): the same
 * Alibaba storefront found for two jobs is one row, refreshed with the latest
 * observation (verification, profile, capabilities). Evidence rows are appended per
 * job. Every submission emits `sourcing.supplier_found` for the job.
 */
import { and, eq } from 'drizzle-orm';
import { actorId } from '../../contracts/common';
import type { SubmitSupplierInput } from '../../contracts/sourcing';
import { getDb, withTx, type Tx } from '../db';
import { supplierEvidence, suppliers } from '../db/schema';
import { emitEvent } from '../events/outbox';
import { enforceBoundary } from './boundary';
import { getJobRow, lockJobForWrite, writerActor, type JobWriter } from './jobs';
import { notFound } from './errors';
import type { SupplierRow } from './views';

export type SubmitSupplierArgs = Omit<SubmitSupplierInput, 'lease_id'>;
export type SubmitSupplierResult = { supplier: SupplierRow; created: boolean };

const SUPPLIER_REF_UQ = 'suppliers_platform_ref_uq';

function isUniqueViolation(err: unknown, constraint: string): boolean {
    const e = err as { code?: string; constraint_name?: string; message?: string; cause?: unknown } | null;
    if (!e) return false;
    if (e.code === '23505' && (e.constraint_name === constraint || String(e.message ?? '').includes(constraint))) return true;
    return e.cause ? isUniqueViolation(e.cause, constraint) : false;
}

async function findByRef(tx: Tx, platform: string, ref: string): Promise<SupplierRow | null> {
    const [row] = await tx
        .select()
        .from(suppliers)
        .where(and(eq(suppliers.platform, platform), eq(suppliers.platformRef, ref)))
        .for('update');
    return row ?? null;
}

export async function submitSupplier(input: SubmitSupplierArgs, writer: JobWriter, opts: { now?: Date } = {}): Promise<SubmitSupplierResult> {
    const now = opts.now ?? new Date();
    const actor = writerActor(writer);
    const preview = await getJobRow(input.sourcing_request_id);
    if (!preview) throw notFound('Sourcing job');
    await enforceBoundary('submit_supplier', { job: preview, actor, tool: 'submit_supplier' });

    return withTx(async (tx) => {
        const job = await lockJobForWrite(tx, input.sourcing_request_id, writer, { now });
        const fields = {
            name: input.name,
            platform: input.platform,
            platformRef: input.platform_ref ?? null,
            country: input.country,
            verified: input.verified,
            profileUrl: input.profile_url ?? null,
            capabilities: input.capabilities,
        };

        let supplier: SupplierRow | null = null;
        let created = false;
        if (input.platform_ref) {
            const existing = await findByRef(tx, input.platform, input.platform_ref);
            if (existing) {
                [supplier] = await tx
                    .update(suppliers)
                    .set({ ...fields, capabilities: [...new Set([...existing.capabilities, ...input.capabilities])], updatedAt: now })
                    .where(eq(suppliers.id, existing.id))
                    .returning();
            }
        }
        if (!supplier) {
            try {
                supplier = await tx.transaction(async (sp) => {
                    const [row] = await sp
                        .insert(suppliers)
                        .values({ ...fields, createdBy: actorId(actor), createdAt: now, updatedAt: now })
                        .returning();
                    return row;
                });
                created = true;
            } catch (err) {
                // A concurrent submission of the same (platform, ref) won the insert.
                if (!input.platform_ref || !isUniqueViolation(err, SUPPLIER_REF_UQ)) throw err;
                supplier = await findByRef(tx, input.platform, input.platform_ref);
                if (!supplier) throw err;
            }
        }

        if (input.evidence.length) {
            await tx.insert(supplierEvidence).values(input.evidence.map((evidence) => ({ supplierId: supplier.id, jobId: job.id, evidence, createdAt: now })));
        }
        await emitEvent(tx, {
            type: 'sourcing.supplier_found',
            payload: { jobId: job.id, supplierId: supplier.id, country: supplier.country, verified: supplier.verified },
            actor,
            correlationId: job.buildId,
            buildId: job.buildId,
            timestamp: now,
        });
        return { supplier, created };
    });
}

export async function getSupplier(id: string): Promise<SupplierRow | null> {
    const [row] = await getDb().select().from(suppliers).where(eq(suppliers.id, id));
    return row ?? null;
}
