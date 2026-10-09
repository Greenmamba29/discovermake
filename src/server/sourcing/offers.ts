/**
 * Normalized supplier offers (`submit_offer`) and their listings.
 *
 * Rules (workflow 03, ADR-0005):
 * - Idempotent on (job, idempotency_key): a retry returns the first offer.
 * - An offer is for exactly one design version. Anything other than the job's version,
 *   or a job whose build has moved on, is rejected with STALE_DESIGN_VERSION.
 * - Trust: SUPPLIER_CONFIRMED only when the supplier confirmed (`negotiation_status =
 *   supplier-confirmed`) AND there are no exceptions; otherwise SUPPLIER_ESTIMATE. A
 *   supplier offer is never BINDING (DiscoverMake commits) nor AI_ESTIMATE.
 * - Offers outside the job's negotiation bounds (unit price, total lead time) or for a
 *   different quantity are still stored, with the reason added to `exceptions` (which
 *   also keeps them at SUPPLIER_ESTIMATE until a human looks).
 * - When a build's design version moves past an offer's version, the offer is marked
 *   STALE the next time it is listed.
 */
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import { actorId, SYSTEM_ACTOR } from '../../contracts/common';
import type { ApprovalStatus, NegotiationStatus, TrustLevel } from '../../contracts/enums';
import type { ApprovalPolicy, RouteOfferView, SourcingRequest, SubmitOfferInput, SupplierOfferView } from '../../contracts/sourcing';
import { getDb, withTx, type DbOrTx } from '../db';
import { approvals, sourcingDocuments, sourcingJobs, supplierOffers, suppliers } from '../db/schema';
import { emitEvent } from '../events/outbox';
import { enforceBoundary } from './boundary';
import { invalid, notFound, SourcingError } from './errors';
import { currentDesignVersion, getJobRow, lockJobForWrite, staleDesign, writerActor, type JobWriter } from './jobs';
import { offerTotalCents, toRouteOfferView, toSupplierOfferView, type JobRow, type OfferRow } from './views';

export type SubmitOfferArgs = Omit<SubmitOfferInput, 'lease_id'>;
export type SubmitOfferResult = { offer: OfferRow; duplicate: boolean };

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** Reasons an offer falls outside the job's request or negotiation bounds (customer-readable). */
export function boundExceptions(
    offer: Pick<SubmitOfferArgs, 'unit_price_cents' | 'production_lead_days' | 'shipping_lead_days' | 'quantity' | 'moq'>,
    request: Pick<SourcingRequest, 'quantity'>,
    policy: Pick<ApprovalPolicy, 'max_unit_price_cents' | 'max_total_lead_days'>,
): string[] {
    const out: string[] = [];
    if (policy.max_unit_price_cents !== null && offer.unit_price_cents > policy.max_unit_price_cents) {
        out.push(`Unit price ${usd(offer.unit_price_cents)} is above the target unit cost of ${usd(policy.max_unit_price_cents)}`);
    }
    const lead = offer.production_lead_days + offer.shipping_lead_days;
    if (policy.max_total_lead_days !== null && lead > policy.max_total_lead_days) {
        out.push(`Total lead time of ${lead} days misses the target delivery date (${policy.max_total_lead_days} days available)`);
    }
    if (offer.quantity !== request.quantity) out.push(`Quoted for ${offer.quantity} units; the request is for ${request.quantity}`);
    if (offer.moq > request.quantity) out.push(`Minimum order quantity ${offer.moq} is above the requested ${request.quantity} units`);
    return out;
}

/** The trust label of a supplier offer. Never BINDING or AI_ESTIMATE. */
export function offerTrustLevel(negotiationStatus: NegotiationStatus, exceptions: readonly string[]): Extract<TrustLevel, 'SUPPLIER_ESTIMATE' | 'SUPPLIER_CONFIRMED'> {
    return negotiationStatus === 'supplier-confirmed' && exceptions.length === 0 ? 'SUPPLIER_CONFIRMED' : 'SUPPLIER_ESTIMATE';
}

export async function submitOffer(input: SubmitOfferArgs, writer: JobWriter, opts: { now?: Date } = {}): Promise<SubmitOfferResult> {
    const now = opts.now ?? new Date();
    const actor = writerActor(writer);
    const preview = await getJobRow(input.sourcing_request_id);
    if (!preview) throw notFound('Sourcing job');
    await enforceBoundary('submit_offer', { job: preview, actor, tool: 'submit_offer', supplierId: input.supplier_id });

    return withTx(async (tx) => {
        const job = await lockJobForWrite(tx, input.sourcing_request_id, writer, { now });
        const [existing] = await tx
            .select()
            .from(supplierOffers)
            .where(and(eq(supplierOffers.jobId, job.id), eq(supplierOffers.idempotencyKey, input.idempotency_key)));
        if (existing) return { offer: existing, duplicate: true };

        if (input.design_version !== job.designVersion) {
            throw new SourcingError(
                'STALE_DESIGN_VERSION',
                `This job is for design version ${job.designVersion}; the offer says ${input.design_version}. Offers must be confirmed against the job's exact design_version (see get_job).`,
            );
        }
        const current = await currentDesignVersion(tx, job);
        if (current !== job.designVersion) throw staleDesign(job.designVersion, current);

        const [supplier] = await tx.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.id, input.supplier_id));
        if (!supplier) throw notFound('Supplier (register it with submit_supplier first)');
        if (input.attachment_ids.length) {
            const docs = await tx
                .select({ id: sourcingDocuments.id })
                .from(sourcingDocuments)
                .where(and(eq(sourcingDocuments.jobId, job.id), inArray(sourcingDocuments.id, input.attachment_ids)));
            if (docs.length !== new Set(input.attachment_ids).size) throw invalid('attachment_ids must be documents attached to this job with attach_document');
        }
        const validUntil = input.valid_until ? new Date(input.valid_until) : null;
        if (validUntil && validUntil.getTime() <= now.getTime()) throw invalid('valid_until is in the past');
        if (!Number.isSafeInteger(input.unit_price_cents * input.quantity + input.tooling_cents + (input.shipping_cents ?? 0))) throw invalid('Offer total is too large');

        const exceptions = [...input.exceptions, ...boundExceptions(input, job.request, job.approvalPolicy)];
        const trustLevel = offerTrustLevel(input.negotiation_status, exceptions);
        // Desk offers have no lease; `raw` keeps the validated input verbatim for audit.
        const raw = { ...input, ...(writer.kind === 'agent' ? { lease_id: writer.leaseId } : {}) } as SubmitOfferInput;

        const [inserted] = await tx
            .insert(supplierOffers)
            .values({
                jobId: job.id,
                supplierId: supplier.id,
                buildId: job.buildId,
                designVersion: job.designVersion,
                idempotencyKey: input.idempotency_key,
                quantity: input.quantity,
                currency: input.currency,
                unitPriceCents: input.unit_price_cents,
                toolingCents: input.tooling_cents,
                sampleCostCents: input.sample_cost_cents,
                shippingCents: input.shipping_cents,
                moq: input.moq,
                productionLeadDays: input.production_lead_days,
                shippingLeadDays: input.shipping_lead_days,
                incoterm: input.incoterm,
                material: input.material,
                processes: input.processes,
                certificationsClaimed: input.certifications_claimed,
                exceptions,
                confidence: input.confidence,
                negotiationStatus: input.negotiation_status,
                trustLevel,
                status: 'ACTIVE',
                validUntil,
                raw,
                submittedBy: actorId(actor),
                createdAt: now,
                updatedAt: now,
            })
            .onConflictDoNothing({ target: [supplierOffers.jobId, supplierOffers.idempotencyKey] })
            .returning();
        if (!inserted) {
            const [raced] = await tx
                .select()
                .from(supplierOffers)
                .where(and(eq(supplierOffers.jobId, job.id), eq(supplierOffers.idempotencyKey, input.idempotency_key)));
            return { offer: raced, duplicate: true };
        }
        await emitEvent(tx, {
            type: 'sourcing.offer_received',
            payload: { jobId: job.id, offerId: inserted.id, supplierId: supplier.id, trustLevel, unitPriceCents: inserted.unitPriceCents, quantity: inserted.quantity },
            actor,
            correlationId: job.buildId,
            buildId: job.buildId,
            timestamp: now,
        });
        if (trustLevel === 'SUPPLIER_CONFIRMED') {
            await emitEvent(tx, {
                type: 'quote.supplier_confirmed',
                payload: { offerId: inserted.id, jobId: job.id, buildId: job.buildId, designVersion: inserted.designVersion, totalCents: offerTotalCents(inserted) },
                actor,
                correlationId: job.buildId,
                buildId: job.buildId,
                timestamp: now,
            });
        }
        return { offer: inserted, duplicate: false };
    });
}

// ---------------------------------------------------------------------------
// Staleness + listings
// ---------------------------------------------------------------------------

/**
 * Mark ACTIVE offers STALE when their build has moved past the offer's design version.
 * Scoped to one build or one job. Returns the number of offers marked.
 */
export async function markStaleOffers(scope: { buildId?: string; jobId?: string }, db: DbOrTx = getDb()): Promise<number> {
    const jobs = await db
        .select({ id: sourcingJobs.id, buildId: sourcingJobs.buildId, partId: sourcingJobs.partId })
        .from(sourcingJobs)
        .where(scope.jobId ? eq(sourcingJobs.id, scope.jobId) : scope.buildId ? eq(sourcingJobs.buildId, scope.buildId) : undefined);
    let marked = 0;
    const versions = new Map<string, number>();
    for (const job of jobs) {
        const key = `${job.buildId}:${job.partId ?? '-'}`;
        let current = versions.get(key);
        if (current === undefined) {
            current = await currentDesignVersion(db, job);
            versions.set(key, current);
        }
        const currentVersion = current;
        const rows = await withTx(async (tx) => {
            const stale = await tx
                .update(supplierOffers)
                .set({ status: 'STALE', updatedAt: new Date() })
                .where(and(eq(supplierOffers.jobId, job.id), eq(supplierOffers.status, 'ACTIVE'), ne(supplierOffers.designVersion, currentVersion)))
                .returning({ id: supplierOffers.id, designVersion: supplierOffers.designVersion });
            for (const o of stale) {
                await emitEvent(tx, {
                    type: 'sourcing.offer_stale',
                    payload: { offerId: o.id, jobId: job.id, offerVersion: o.designVersion, currentVersion },
                    actor: SYSTEM_ACTOR,
                    correlationId: job.id,
                    buildId: job.buildId,
                });
            }
            return stale;
        }, db);
        marked += rows.length;
    }
    return marked;
}

/** Ops listing for a job (supplier identity included). Marks stale offers first. */
export async function listJobOffers(jobId: string): Promise<SupplierOfferView[]> {
    const db = getDb();
    await markStaleOffers({ jobId }, db);
    const rows = await db
        .select({ offer: supplierOffers, supplier: suppliers })
        .from(supplierOffers)
        .innerJoin(suppliers, eq(suppliers.id, supplierOffers.supplierId))
        .where(eq(supplierOffers.jobId, jobId))
        .orderBy(asc(supplierOffers.createdAt));
    return rows.map((r) => toSupplierOfferView(r.offer, r.supplier));
}

/** Latest SELECT_SUPPLIER_OFFER approval per offer. */
async function selectionsFor(db: DbOrTx, offerIds: string[]): Promise<Map<string, { approvalId: string; status: ApprovalStatus }>> {
    const out = new Map<string, { approvalId: string; status: ApprovalStatus }>();
    if (!offerIds.length) return out;
    const rows = await db
        .select({ id: approvals.id, offerId: approvals.supplierOfferId, status: approvals.status })
        .from(approvals)
        .where(and(eq(approvals.kind, 'SELECT_SUPPLIER_OFFER'), inArray(approvals.supplierOfferId, offerIds)))
        .orderBy(desc(approvals.createdAt));
    for (const r of rows) if (r.offerId && !out.has(r.offerId)) out.set(r.offerId, { approvalId: r.id, status: r.status });
    return out;
}

/** Buyer listing (Manufacturing Route): ACTIVE, SELECTED and STALE offers, cheapest first. Never the supplier identity. */
export async function listRouteOffers(buildId: string): Promise<RouteOfferView[]> {
    const db = getDb();
    await markStaleOffers({ buildId }, db);
    const rows = await db
        .select({ offer: supplierOffers, verified: suppliers.verified, country: suppliers.country })
        .from(supplierOffers)
        .innerJoin(suppliers, eq(suppliers.id, supplierOffers.supplierId))
        .where(and(eq(supplierOffers.buildId, buildId), inArray(supplierOffers.status, ['ACTIVE', 'SELECTED', 'STALE'])));
    const selections = await selectionsFor(
        db,
        rows.map((r) => r.offer.id),
    );
    return rows
        .map((r) => toRouteOfferView(r.offer, { verified: r.verified, country: r.country }, selections.get(r.offer.id) ?? null))
        .sort((a, b) => a.totalCents - b.totalCents || a.totalLeadDays - b.totalLeadDays || a.id.localeCompare(b.id));
}

/** One buyer-safe offer view. */
export async function getRouteOffer(offerId: string, db: DbOrTx = getDb()): Promise<RouteOfferView | null> {
    const [row] = await db
        .select({ offer: supplierOffers, verified: suppliers.verified, country: suppliers.country })
        .from(supplierOffers)
        .innerJoin(suppliers, eq(suppliers.id, supplierOffers.supplierId))
        .where(eq(supplierOffers.id, offerId));
    if (!row) return null;
    const selections = await selectionsFor(db, [offerId]);
    return toRouteOfferView(row.offer, { verified: row.verified, country: row.country }, selections.get(offerId) ?? null);
}

/** Offers summary for the agent's get_job (no other suppliers' prices leak across clients: same job only). */
export async function agentOfferSummaries(job: JobRow): Promise<
    { supplier_offer_id: string; supplier_id: string; trust_level: string; status: string; unit_price_cents: number; total_cents: number; exceptions: string[] }[]
> {
    await markStaleOffers({ jobId: job.id });
    const rows = await getDb().select().from(supplierOffers).where(eq(supplierOffers.jobId, job.id)).orderBy(asc(supplierOffers.createdAt));
    return rows.map((o) => ({
        supplier_offer_id: o.id,
        supplier_id: o.supplierId,
        trust_level: o.trustLevel,
        status: o.status,
        unit_price_cents: o.unitPriceCents,
        total_cents: offerTotalCents(o),
        exceptions: o.exceptions,
    }));
}
