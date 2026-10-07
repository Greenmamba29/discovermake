/**
 * Human decisions at the approval boundary (ADR-0005).
 *
 * - Agents (and buyers selecting an offer) can only CREATE PENDING approvals.
 * - `decideApproval` is for humans: ops (admin) for any approval, the buyer for
 *   customer-facing approvals on their own build. Agents and the system never decide.
 * - An approved SELECT_SUPPLIER_OFFER marks that offer SELECTED, the job's other offers
 *   REJECTED, cancels competing selection requests and emits `supplier.selected`.
 *   R2 stops there: a selected offer is NOT turned into a checkout (checkout stays
 *   BINDING-only); ordering supplier-sourced routes end to end is R3.
 */
import { and, asc, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { actorId, type Actor } from '../../contracts/common';
import type { ApprovalKind, ApprovalStatus, ApproverRole } from '../../contracts/enums';
import type { ApprovalDecisionRequest, ApprovalView, RequestApprovalInput } from '../../contracts/sourcing';
import { getDb, withTx, type Tx } from '../db';
import { approvals, sourcingJobs, supplierOffers, suppliers } from '../db/schema';
import { emitEvent } from '../events/outbox';
import { ApiError } from '../http';
import { enforceBoundary } from './boundary';
import { MAX_APPROVAL_DETAILS_CHARS } from './constants';
import { conflict, invalid, notFound } from './errors';
import { currentDesignVersion, getJobRow, lockJobForWrite, staleDesign, writerActor, type JobWriter } from './jobs';
import { approverRoleFor } from './policy';
import { toApprovalView, type ApprovalRow, type JobRow } from './views';

export type RequestApprovalArgs = Omit<RequestApprovalInput, 'lease_id'>;

/** Kinds that only make sense for one supplier. */
const SUPPLIER_SCOPED: ReadonlySet<ApprovalKind> = new Set<ApprovalKind>(['RELEASE_FULL_PACKAGE', 'REQUEST_SAMPLE', 'PAY_DEPOSIT', 'PLACE_PURCHASE_ORDER', 'APPROVE_TOOLING']);

type NewApproval = {
    job: JobRow;
    kind: ApprovalKind;
    approverRole: ApproverRole;
    requestedBy: Actor;
    supplierId: string | null;
    supplierOfferId: string | null;
    reason: string;
    details: Record<string, unknown>;
    now: Date;
};

/** Insert a PENDING approval (or return the identical pending one) and emit `sourcing.approval_requested`. */
async function createApproval(tx: Tx, a: NewApproval): Promise<{ approval: ApprovalRow; created: boolean }> {
    const [same] = await tx
        .select()
        .from(approvals)
        .where(
            and(
                eq(approvals.jobId, a.job.id),
                eq(approvals.kind, a.kind),
                eq(approvals.status, 'PENDING'),
                a.supplierId ? eq(approvals.supplierId, a.supplierId) : isNull(approvals.supplierId),
                a.supplierOfferId ? eq(approvals.supplierOfferId, a.supplierOfferId) : isNull(approvals.supplierOfferId),
            ),
        )
        .limit(1);
    if (same) return { approval: same, created: false };

    const [approval] = await tx
        .insert(approvals)
        .values({
            jobId: a.job.id,
            buildId: a.job.buildId,
            kind: a.kind,
            status: 'PENDING',
            approverRole: a.approverRole,
            requestedBy: actorId(a.requestedBy),
            supplierId: a.supplierId,
            supplierOfferId: a.supplierOfferId,
            reason: a.reason,
            details: a.details,
            createdAt: a.now,
            updatedAt: a.now,
        })
        .returning();
    await emitEvent(tx, {
        type: 'sourcing.approval_requested',
        payload: { approvalId: approval.id, jobId: a.job.id, buildId: a.job.buildId, kind: a.kind, approverRole: a.approverRole },
        actor: a.requestedBy,
        correlationId: a.job.buildId,
        buildId: a.job.buildId,
        timestamp: a.now,
    });
    return { approval, created: true };
}

/** Agent (or desk): ask a human to decide something outside the boundary. Always PENDING. */
export async function requestApproval(input: RequestApprovalArgs, writer: JobWriter, opts: { now?: Date } = {}): Promise<{ approval: ApprovalRow; created: boolean }> {
    const now = opts.now ?? new Date();
    const actor = writerActor(writer);
    const detailsJson = JSON.stringify(input.details);
    if (detailsJson.length > MAX_APPROVAL_DETAILS_CHARS) throw invalid(`details must be under ${MAX_APPROVAL_DETAILS_CHARS} characters of JSON`);
    const preview = await getJobRow(input.sourcing_request_id);
    if (!preview) throw notFound('Sourcing job');
    await enforceBoundary('request_approval', { job: preview, actor, tool: 'request_approval', supplierId: input.supplier_id ?? null });

    return withTx(async (tx) => {
        const job = await lockJobForWrite(tx, input.sourcing_request_id, writer, { now });
        let supplierId = input.supplier_id ?? null;
        let offerId: string | null = null;
        if (input.supplier_offer_id) {
            const [offer] = await tx
                .select()
                .from(supplierOffers)
                .where(and(eq(supplierOffers.id, input.supplier_offer_id), eq(supplierOffers.jobId, job.id)));
            if (!offer) throw notFound('Supplier offer on this job');
            if (supplierId && supplierId !== offer.supplierId) throw invalid('supplier_id does not match the offer');
            supplierId = offer.supplierId;
            offerId = offer.id;
        }
        if (input.kind === 'SELECT_SUPPLIER_OFFER' && !offerId) throw invalid('SELECT_SUPPLIER_OFFER needs supplier_offer_id');
        if (SUPPLIER_SCOPED.has(input.kind) && !supplierId) throw invalid(`${input.kind} is decided per supplier: pass supplier_id`);
        if (supplierId && !offerId) {
            const [s] = await tx.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.id, supplierId));
            if (!s) throw notFound('Supplier');
        }
        return createApproval(tx, {
            job,
            kind: input.kind,
            approverRole: approverRoleFor(input.kind),
            requestedBy: actor,
            supplierId,
            supplierOfferId: offerId,
            reason: input.reason,
            details: input.details,
            now,
        });
    });
}

/**
 * Buyer: "Choose this route". Creates (or returns the pending) SELECT_SUPPLIER_OFFER
 * approval for ops to confirm. Only ACTIVE, SUPPLIER_CONFIRMED offers on the current
 * design version can be selected.
 */
export async function requestOfferSelection(input: { buildId: string; offerId: string; actor: Actor }, opts: { now?: Date } = {}): Promise<{ approval: ApprovalRow; created: boolean }> {
    const now = opts.now ?? new Date();
    return withTx(async (tx) => {
        const [offer] = await tx
            .select()
            .from(supplierOffers)
            .where(and(eq(supplierOffers.id, input.offerId), eq(supplierOffers.buildId, input.buildId)))
            .for('update');
        if (!offer) throw notFound('Offer');
        const [job] = await tx.select().from(sourcingJobs).where(eq(sourcingJobs.id, offer.jobId)).for('update');
        if (!job) throw notFound('Sourcing job');
        const current = await currentDesignVersion(tx, job);
        if (offer.designVersion !== current) {
            if (offer.status === 'ACTIVE') await tx.update(supplierOffers).set({ status: 'STALE', updatedAt: now }).where(eq(supplierOffers.id, offer.id));
            throw staleDesign(offer.designVersion, current);
        }
        if (offer.status !== 'ACTIVE') throw conflict(`This offer is ${offer.status} and can no longer be selected`);
        if (offer.trustLevel !== 'SUPPLIER_CONFIRMED') throw conflict('Only supplier-confirmed offers can be selected; this one is still an estimate');
        if (offer.validUntil && offer.validUntil.getTime() <= now.getTime()) throw conflict('This offer has expired');
        if (job.status === 'CANCELLED') throw conflict('This sourcing request was cancelled');
        return createApproval(tx, {
            job,
            kind: 'SELECT_SUPPLIER_OFFER',
            approverRole: approverRoleFor('SELECT_SUPPLIER_OFFER', true),
            requestedBy: input.actor,
            supplierId: offer.supplierId,
            supplierOfferId: offer.id,
            reason: 'The buyer chose this route on the Manufacturing Route; confirm the supplier selection.',
            details: { totalLeadDays: offer.productionLeadDays + offer.shippingLeadDays, unitPriceCents: offer.unitPriceCents, quantity: offer.quantity },
            now,
        });
    });
}

/** Who may decide this approval. Humans only. */
function assertCanDecide(approval: ApprovalRow, actor: Actor): void {
    switch (actor.kind) {
        case 'admin':
            return;
        case 'buyer':
            if (approval.approverRole === 'customer' && actor.id === `guest:${approval.buildId}`) return;
            throw new ApiError('FORBIDDEN', 'Only DiscoverMake ops can decide this approval', 403);
        case 'sourcing_agent':
        case 'system':
        case 'shop':
        case 'carrier':
        case 'payment_provider':
            throw new ApiError('FORBIDDEN', 'Approvals are decided by humans in DiscoverMake only', 403);
        default: {
            const never: never = actor.kind;
            throw new Error(`Unknown actor kind ${String(never)}`);
        }
    }
}

async function emitDecided(tx: Tx, a: ApprovalRow, status: ApprovalStatus, actor: Actor, now: Date): Promise<void> {
    await emitEvent(tx, {
        type: 'sourcing.approval_decided',
        payload: { approvalId: a.id, kind: a.kind, status, decidedBy: actorId(actor) },
        actor,
        correlationId: a.buildId,
        buildId: a.buildId,
        timestamp: now,
    });
}

/** Apply an approved SELECT_SUPPLIER_OFFER inside `tx`. */
async function applySelection(tx: Tx, approval: ApprovalRow, actor: Actor, now: Date): Promise<void> {
    if (!approval.supplierOfferId || !approval.jobId) throw conflict('Selection approval has no offer');
    const [offer] = await tx.select().from(supplierOffers).where(eq(supplierOffers.id, approval.supplierOfferId)).for('update');
    const [job] = await tx.select().from(sourcingJobs).where(eq(sourcingJobs.id, approval.jobId)).for('update');
    if (!offer || !job) throw notFound('Offer');
    const current = await currentDesignVersion(tx, job);
    if (offer.designVersion !== current) {
        throw staleDesign(offer.designVersion, current);
    }
    if (offer.status !== 'ACTIVE') throw conflict(`The offer is ${offer.status} and cannot be selected`);
    if (offer.trustLevel !== 'SUPPLIER_CONFIRMED') throw conflict('Only supplier-confirmed offers can be selected');

    await tx.update(supplierOffers).set({ status: 'SELECTED', updatedAt: now }).where(eq(supplierOffers.id, offer.id));
    await tx
        .update(supplierOffers)
        .set({ status: 'REJECTED', updatedAt: now })
        .where(and(eq(supplierOffers.jobId, job.id), ne(supplierOffers.id, offer.id), inArray(supplierOffers.status, ['ACTIVE', 'STALE'])));
    const competing = await tx
        .update(approvals)
        .set({ status: 'CANCELLED', decidedBy: actorId(actor), decidedAt: now, decisionNote: 'Another offer was selected', updatedAt: now })
        .where(and(eq(approvals.jobId, job.id), eq(approvals.kind, 'SELECT_SUPPLIER_OFFER'), eq(approvals.status, 'PENDING'), ne(approvals.id, approval.id)))
        .returning();
    for (const c of competing) await emitDecided(tx, c, 'CANCELLED', actor, now);
    await emitEvent(tx, {
        type: 'supplier.selected',
        payload: { buildId: job.buildId, jobId: job.id, offerId: offer.id, approvalId: approval.id },
        actor,
        correlationId: job.buildId,
        buildId: job.buildId,
        timestamp: now,
    });
}

/** A human decides a PENDING approval. Re-deciding with the same decision is a no-op. */
export async function decideApproval(approvalId: string, decision: ApprovalDecisionRequest, actor: Actor, opts: { now?: Date } = {}): Promise<ApprovalView> {
    const now = opts.now ?? new Date();
    return withTx(async (tx) => {
        const [approval] = await tx.select().from(approvals).where(eq(approvals.id, approvalId)).for('update');
        if (!approval) throw notFound('Approval');
        assertCanDecide(approval, actor);
        if (approval.status !== 'PENDING') {
            if (approval.status === decision.decision) return toApprovalView(approval);
            throw conflict(`This approval is already ${approval.status}`);
        }
        if (decision.decision === 'APPROVED' && approval.kind === 'SELECT_SUPPLIER_OFFER') await applySelection(tx, approval, actor, now);
        const [updated] = await tx
            .update(approvals)
            .set({ status: decision.decision, decidedBy: actorId(actor), decisionNote: decision.note ?? null, decidedAt: now, updatedAt: now })
            .where(eq(approvals.id, approval.id))
            .returning();
        await emitDecided(tx, updated, decision.decision, actor, now);
        return toApprovalView(updated);
    });
}

export async function listApprovals(filter: { statuses?: ApprovalStatus[]; role?: ApproverRole; jobId?: string; buildId?: string; limit?: number } = {}): Promise<ApprovalView[]> {
    const rows = await getDb()
        .select()
        .from(approvals)
        .where(
            and(
                filter.statuses?.length ? inArray(approvals.status, filter.statuses) : undefined,
                filter.role ? eq(approvals.approverRole, filter.role) : undefined,
                filter.jobId ? eq(approvals.jobId, filter.jobId) : undefined,
                filter.buildId ? eq(approvals.buildId, filter.buildId) : undefined,
            ),
        )
        .orderBy(filter.statuses?.length === 1 && filter.statuses[0] === 'PENDING' ? asc(approvals.createdAt) : desc(approvals.createdAt))
        .limit(filter.limit ?? 200);
    return rows.map(toApprovalView);
}

export async function getApprovalView(approvalId: string): Promise<ApprovalView | null> {
    const [row] = await getDb().select().from(approvals).where(eq(approvals.id, approvalId));
    return row ? toApprovalView(row) : null;
}
