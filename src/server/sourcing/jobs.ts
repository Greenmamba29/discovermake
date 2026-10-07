/**
 * Sourcing jobs: the queue the Accio Work agent group pulls from (ADR-0005, workflow 03).
 *
 * Lifecycle (src/contracts/enums.ts SOURCING_JOB_STATUSES):
 *   QUEUED --next_job--> LEASED --first write--> IN_PROGRESS --complete_job--> COMPLETE
 *   any open status --ops cancel--> CANCELLED;  ops requeue --> QUEUED (optionally on the desk channel)
 *   LEASED/IN_PROGRESS with lease_expires_at < now --> QUEUED (visibility timeout)
 *
 * - `createSourcingJob` freezes a `SourcingRequest` (from the part + its latest quote, or
 *   the Build Graph for graph builds) and inserts it QUEUED with `sourcing.requested`.
 * - `leaseNextJob` uses `FOR UPDATE SKIP LOCKED`, so concurrent `next_job` calls never
 *   lease the same job; expired leases go back to the queue first.
 * - Every write under a lease goes through `lockJobForWrite`: it locks the job row,
 *   checks the lease (LEASE_INVALID otherwise), moves LEASED -> IN_PROGRESS on the first
 *   write and extends the lease. The ops desk writes without a lease.
 * Every state change and its domain event commit in one transaction.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, count, desc, eq, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm';
import { actorId, SYSTEM_ACTOR, type Actor } from '../../contracts/common';
import type { SourcingChannel, SourcingJobStatus } from '../../contracts/enums';
import {
    DEFAULT_APPROVAL_POLICY,
    SourcingRequest,
    type ApprovalPolicy,
    type CompleteJobInput,
    type CreateSourcingRequest,
    type SourcingJobView,
} from '../../contracts/sourcing';
import { getDb, withTx, type DbOrTx, type Tx } from '../db';
import { approvals, bgNodes, builds, parts, quotes, sourcingJobs, supplierOffers, thicknessOptions } from '../db/schema';
import { emitEvent } from '../events/outbox';
import { newId, randomBase32 } from '../ids';
import { LEASE_TTL_MS, OPEN_JOB_STATUSES, TERMINAL_JOB_STATUSES } from './constants';
import { conflict, invalid, notFound, SourcingError } from './errors';
import { toJobView, type JobRow } from './views';

// ---------------------------------------------------------------------------
// Writers (who is changing a job)
// ---------------------------------------------------------------------------

/** An MCP agent writes under its lease; the ops desk writes as a human without one. */
export type JobWriter = { kind: 'agent'; clientId: string; leaseId: string } | { kind: 'desk'; actor: Actor };

export function agentActor(clientId: string): Actor {
    return { kind: 'sourcing_agent', id: clientId };
}

export function writerActor(writer: JobWriter): Actor {
    switch (writer.kind) {
        case 'agent':
            return agentActor(writer.clientId);
        case 'desk':
            return writer.actor;
        default: {
            const never: never = writer;
            throw new Error(`Unknown writer ${JSON.stringify(never)}`);
        }
    }
}

const isTerminal = (status: SourcingJobStatus) => (TERMINAL_JOB_STATUSES as readonly string[]).includes(status);

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export type CreateSourcingJobInput = CreateSourcingRequest & {
    buildId: string;
    actor: Actor;
    channel?: SourcingChannel;
    /** Freeze the request from this exact quote (auto-request on a REVIEW quote) instead of the part's latest. */
    fromQuoteId?: string;
    /** Return the open job for the same part/version/quantity instead of creating a second one. */
    reuseOpen?: boolean;
    priority?: number;
};

export type CreateSourcingJobResult = { job: JobRow; created: boolean };

const SOURCING_DISPLAY_ID_UQ = 'sourcing_jobs_display_id_uq';

function isUniqueViolation(err: unknown, constraint: string): boolean {
    const e = err as { code?: string; constraint_name?: string; constraint?: string; cause?: unknown; message?: string } | null;
    if (!e) return false;
    if (e.code === '23505' && (e.constraint_name === constraint || e.constraint === constraint || String(e.message ?? '').includes(constraint))) return true;
    return e.cause ? isUniqueViolation(e.cause, constraint) : false;
}

/** `SRC-` + 5 Crockford chars; uniqueness is enforced by the DB (retried on collision). */
export function newSourcingDisplayId(): string {
    return `SRC-${randomBase32(5)}`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const dedupe = (xs: (string | null | undefined)[]) => [...new Set(xs.map((x) => x?.trim()).filter((x): x is string => !!x))];

/** Days from `now` until the end of `date` (UTC), at least 1. */
export function daysUntil(date: string, now: Date): number {
    const end = Date.parse(`${date}T23:59:59Z`);
    return Math.ceil((end - now.getTime()) / 86_400_000);
}

/** The approval policy frozen on a job: defaults + negotiation bounds from the buyer's targets. */
export function policyFor(input: Pick<CreateSourcingRequest, 'targetUnitCostCents' | 'targetDeliveryDate'>, now: Date): ApprovalPolicy {
    let maxLead: number | null = null;
    if (input.targetDeliveryDate) {
        maxLead = daysUntil(input.targetDeliveryDate, now);
        if (maxLead < 1) throw invalid('targetDeliveryDate must be in the future');
    }
    return { ...DEFAULT_APPROVAL_POLICY, max_unit_price_cents: input.targetUnitCostCents ?? null, max_total_lead_days: maxLead };
}

type ResolvedFields = {
    partId: string | null;
    designVersion: number;
    request: Omit<SourcingRequest, 'sourcing_request_id' | 'display_id' | 'approval_policy'>;
};

async function resolveRequest(db: DbOrTx, input: CreateSourcingJobInput): Promise<ResolvedFields> {
    const [build] = await db.select().from(builds).where(eq(builds.id, input.buildId));
    if (!build) throw notFound('Build');

    let part: typeof parts.$inferSelect | null = null;
    if (input.partId) {
        [part = null] = await db
            .select()
            .from(parts)
            .where(and(eq(parts.id, input.partId), eq(parts.buildId, build.id)));
        if (!part) throw notFound('Part');
    } else {
        const buildParts = await db.select().from(parts).where(eq(parts.buildId, build.id));
        if (buildParts.length === 1) part = buildParts[0];
    }
    const designVersion = part ? part.designVersion : build.currentVersion;

    let quote: typeof quotes.$inferSelect | null = null;
    if (part) {
        const where = input.fromQuoteId
            ? and(eq(quotes.id, input.fromQuoteId), eq(quotes.partId, part.id))
            : and(eq(quotes.partId, part.id), eq(quotes.designVersion, part.designVersion));
        [quote = null] = await db.select().from(quotes).where(where).orderBy(desc(quotes.createdAt)).limit(1);
    }
    let thicknessMm: number | null = null;
    if (quote) {
        const [thk] = await db.select({ mm: thicknessOptions.thicknessMm }).from(thicknessOptions).where(eq(thicknessOptions.id, quote.config.thicknessOptionId));
        thicknessMm = thk?.mm ?? null;
    }

    // Graph builds (Make AI / remix) carry material + processes as Build Graph nodes.
    let graphMaterial: string | null = null;
    let graphProcesses: string[] = [];
    let graphFinish: string | null = null;
    if (!quote) {
        const nodes = await db
            .select({ type: bgNodes.type, label: bgNodes.label })
            .from(bgNodes)
            .where(and(eq(bgNodes.buildId, build.id), eq(bgNodes.designVersion, build.currentVersion), inArray(bgNodes.type, ['MATERIAL', 'PROCESS', 'FINISH'])))
            .orderBy(asc(bgNodes.createdAt));
        graphMaterial = nodes.find((n) => n.type === 'MATERIAL')?.label ?? null;
        graphProcesses = nodes.filter((n) => n.type === 'PROCESS').map((n) => n.label);
        graphFinish = nodes.find((n) => n.type === 'FINISH')?.label ?? null;
    }

    const material = input.material ?? (quote ? `${quote.summary.materialName}, ${quote.summary.thicknessLabel}`.slice(0, 120) : graphMaterial);
    if (!material) throw invalid('material is required: this build has no quoted part or Build Graph material to source from');
    const process = input.process ?? (quote ? dedupe([quote.summary.processName, ...quote.summary.serviceNames, quote.summary.finishName]) : dedupe(graphProcesses));
    if (!process.length) throw invalid('process is required: this build has no quoted part or Build Graph process to source from');

    const features = part?.features ?? null;
    const dimensions =
        features && features.bboxWidthMm > 0 && features.bboxHeightMm > 0 ? { x: round2(features.bboxWidthMm), y: round2(features.bboxHeightMm), z: round2(thicknessMm ?? 0) } : null;

    return {
        partId: part?.id ?? null,
        designVersion,
        request: {
            build_id: build.id,
            build_display_id: build.displayId,
            design_version: designVersion,
            part_id: part?.id ?? null,
            name: build.name.slice(0, 200),
            quantity: input.quantity,
            target_unit_cost_cents: input.targetUnitCostCents ?? null,
            material: material.slice(0, 120),
            process: process.slice(0, 8).map((p) => p.slice(0, 80)),
            dimensions_mm: dimensions,
            critical_tolerances: [],
            surface_finish: input.surfaceFinish ?? quote?.summary.finishName ?? graphFinish ?? null,
            required_certifications: [],
            target_regions: input.targetRegions ?? [],
            target_delivery_date: input.targetDeliveryDate ?? null,
            acceptable_substitutions: [],
            attachments: part ? ['Request sheet', '2D flat pattern preview (SVG)', 'Source CAD (DXF, FULL package only)'] : ['Request sheet'],
            notes: input.notes ?? null,
        },
    };
}

/** Open (QUEUED/LEASED/IN_PROGRESS) job for the same build, part, version and quantity. */
async function findOpenJob(db: DbOrTx, key: { buildId: string; partId: string | null; designVersion: number; quantity: number }): Promise<JobRow | null> {
    const [row] = await db
        .select()
        .from(sourcingJobs)
        .where(
            and(
                eq(sourcingJobs.buildId, key.buildId),
                key.partId ? eq(sourcingJobs.partId, key.partId) : isNull(sourcingJobs.partId),
                eq(sourcingJobs.designVersion, key.designVersion),
                inArray(sourcingJobs.status, [...OPEN_JOB_STATUSES]),
                sql`(${sourcingJobs.request} ->> 'quantity')::int = ${key.quantity}`,
            ),
        )
        .orderBy(asc(sourcingJobs.createdAt))
        .limit(1);
    return row ?? null;
}

/**
 * Freeze a SourcingRequest and queue it (status QUEUED, `sourcing.requested`).
 * With `reuseOpen`, an open job for the same part/version/quantity is returned instead
 * (serialized with an advisory lock, so concurrent callers create exactly one).
 */
export async function createSourcingJob(input: CreateSourcingJobInput, opts: { tx?: DbOrTx; now?: Date } = {}): Promise<CreateSourcingJobResult> {
    const now = opts.now ?? new Date();
    const policy = policyFor(input, now);
    return withTx(async (tx) => {
        const resolved = await resolveRequest(tx, input);
        const key = { buildId: input.buildId, partId: resolved.partId, designVersion: resolved.designVersion, quantity: input.quantity };
        if (input.reuseOpen) {
            await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`sourcing:${key.buildId}:${key.partId ?? '-'}:${key.designVersion}:${key.quantity}`}, 0))`);
            const open = await findOpenJob(tx, key);
            if (open) return { job: open, created: false };
        }

        const id = newId('sourcingJob');
        const channel = input.channel ?? 'accio';
        let job: JobRow | null = null;
        for (let attempt = 0; attempt < 5 && !job; attempt++) {
            const displayId = newSourcingDisplayId();
            const request = SourcingRequest.parse({ ...resolved.request, sourcing_request_id: id, display_id: displayId, approval_policy: policy });
            try {
                job = await tx.transaction(async (sp) => {
                    const [row] = await sp
                        .insert(sourcingJobs)
                        .values({
                            id,
                            displayId,
                            buildId: input.buildId,
                            partId: resolved.partId,
                            designVersion: resolved.designVersion,
                            request,
                            approvalPolicy: policy,
                            status: 'QUEUED',
                            channel,
                            priority: input.priority ?? 0,
                            createdBy: actorId(input.actor),
                            createdAt: now,
                            updatedAt: now,
                        })
                        .returning();
                    return row;
                });
            } catch (err) {
                if (!isUniqueViolation(err, SOURCING_DISPLAY_ID_UQ)) throw err;
            }
        }
        if (!job) throw new Error('Could not allocate a unique sourcing display id');

        await emitEvent(tx, {
            type: 'sourcing.requested',
            payload: { jobId: job.id, buildId: job.buildId, designVersion: job.designVersion, channel, quantity: input.quantity },
            actor: input.actor,
            correlationId: job.buildId,
            buildId: job.buildId,
            timestamp: now,
        });
        return { job, created: true };
    }, opts.tx);
}

// ---------------------------------------------------------------------------
// Lease
// ---------------------------------------------------------------------------

export type LeaseResult = { job: JobRow | null; leaseId: string | null; leaseExpiresAt: Date | null };

/** Return LEASED/IN_PROGRESS jobs whose lease ran out to the queue. Returns their ids. */
export async function returnExpiredLeases(tx: DbOrTx, now: Date): Promise<string[]> {
    const rows = await tx
        .update(sourcingJobs)
        .set({ status: 'QUEUED', leaseId: null, leaseExpiresAt: null, updatedAt: now })
        .where(and(inArray(sourcingJobs.status, ['LEASED', 'IN_PROGRESS']), lt(sourcingJobs.leaseExpiresAt, now)))
        .returning({ id: sourcingJobs.id, buildId: sourcingJobs.buildId });
    await emitLeaseReleased(tx, rows, 'expired');
    return rows.map((r) => r.id);
}

async function emitLeaseReleased(tx: DbOrTx, rows: { id: string; buildId: string }[], reason: 'expired' | 'client_revoked'): Promise<void> {
    for (const r of rows) {
        await emitEvent(tx, { type: 'sourcing.lease_released', payload: { jobId: r.id, reason }, actor: SYSTEM_ACTOR, correlationId: r.id, buildId: r.buildId });
    }
}

function escapeLike(s: string): string {
    return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Lease the next QUEUED accio-channel job (highest priority, oldest first). Concurrent
 * callers never get the same job (`FOR UPDATE SKIP LOCKED`). Emits `sourcing.job_leased`.
 */
export async function leaseNextJob(clientId: string, opts: { processes?: string[]; now?: Date } = {}): Promise<LeaseResult> {
    const now = opts.now ?? new Date();
    return withTx(async (tx) => {
        await returnExpiredLeases(tx, now);

        const filters: SQL[] = [eq(sourcingJobs.status, 'QUEUED'), eq(sourcingJobs.channel, 'accio')];
        const wanted = (opts.processes ?? []).map((p) => p.trim()).filter(Boolean);
        if (wanted.length) {
            const any = sql.join(
                wanted.map((p) => sql`p.v ilike ${`%${escapeLike(p)}%`}`),
                sql` or `,
            );
            filters.push(sql`exists (select 1 from jsonb_array_elements_text(${sourcingJobs.request} -> 'process') as p(v) where ${any})`);
        }
        const [candidate] = await tx
            .select()
            .from(sourcingJobs)
            .where(and(...filters))
            .orderBy(desc(sourcingJobs.priority), asc(sourcingJobs.createdAt))
            .limit(1)
            .for('update', { skipLocked: true });
        if (!candidate) return { job: null, leaseId: null, leaseExpiresAt: null };

        const leaseId = randomUUID();
        const leaseExpiresAt = new Date(now.getTime() + LEASE_TTL_MS);
        const [job] = await tx
            .update(sourcingJobs)
            .set({ status: 'LEASED', leaseId, leasedByClientId: clientId, leaseExpiresAt, leaseCount: sql`${sourcingJobs.leaseCount} + 1`, updatedAt: now })
            .where(eq(sourcingJobs.id, candidate.id))
            .returning();
        await emitEvent(tx, {
            type: 'sourcing.job_leased',
            payload: { jobId: job.id, clientId, leaseExpiresAt: leaseExpiresAt.toISOString() },
            actor: agentActor(clientId),
            correlationId: job.buildId,
            buildId: job.buildId,
            timestamp: now,
        });
        return { job, leaseId, leaseExpiresAt };
    });
}

const leaseInvalid = () =>
    new SourcingError('LEASE_INVALID', 'This lease is unknown, expired, or held by another client. Call next_job to lease work again; do not keep writing to this job.');

/**
 * Lock the job and check the lease (LEASE_INVALID otherwise). With `write`, the first
 * write moves LEASED -> IN_PROGRESS, and every write extends the lease by LEASE_TTL_MS.
 */
export async function assertLease(tx: Tx, input: { jobId: string; leaseId: string; clientId: string; write?: boolean; now?: Date }): Promise<JobRow> {
    const now = input.now ?? new Date();
    const [job] = await tx.select().from(sourcingJobs).where(eq(sourcingJobs.id, input.jobId)).for('update');
    if (
        !job ||
        (job.status !== 'LEASED' && job.status !== 'IN_PROGRESS') ||
        job.leaseId !== input.leaseId ||
        job.leasedByClientId !== input.clientId ||
        !job.leaseExpiresAt ||
        job.leaseExpiresAt.getTime() <= now.getTime()
    ) {
        throw leaseInvalid();
    }
    if (!input.write) return job;
    const [updated] = await tx
        .update(sourcingJobs)
        .set({ status: 'IN_PROGRESS', leaseExpiresAt: new Date(now.getTime() + LEASE_TTL_MS), updatedAt: now })
        .where(eq(sourcingJobs.id, job.id))
        .returning();
    return updated;
}

/** Lock a job for a write by an agent (lease checked + extended) or the ops desk (any open job). */
export async function lockJobForWrite(tx: Tx, jobId: string, writer: JobWriter, opts: { now?: Date; write?: boolean } = {}): Promise<JobRow> {
    switch (writer.kind) {
        case 'agent':
            return assertLease(tx, { jobId, leaseId: writer.leaseId, clientId: writer.clientId, write: opts.write ?? true, now: opts.now });
        case 'desk': {
            const [job] = await tx.select().from(sourcingJobs).where(eq(sourcingJobs.id, jobId)).for('update');
            if (!job) throw notFound('Sourcing job');
            if (isTerminal(job.status)) throw conflict(`Sourcing job ${job.displayId} is ${job.status}`);
            return job;
        }
        default: {
            const never: never = writer;
            throw new Error(`Unknown writer ${JSON.stringify(never)}`);
        }
    }
}

// ---------------------------------------------------------------------------
// Design version freshness
// ---------------------------------------------------------------------------

/** The build's current design version for a job: the part's version, or the graph build's current version. */
export async function currentDesignVersion(db: DbOrTx, job: Pick<JobRow, 'buildId' | 'partId'>): Promise<number> {
    if (job.partId) {
        const [p] = await db.select({ v: parts.designVersion }).from(parts).where(eq(parts.id, job.partId));
        if (p) return p.v;
    }
    const [b] = await db.select({ v: builds.currentVersion }).from(builds).where(eq(builds.id, job.buildId));
    return b?.v ?? 1;
}

export function staleDesign(jobVersion: number, current: number): SourcingError {
    return new SourcingError(
        'STALE_DESIGN_VERSION',
        `The build moved to design version ${current}; this job and its offers are for version ${jobVersion}. Stop work on this job and complete it with outcome "no_viable_suppliers"; DiscoverMake will queue a new job for the current version.`,
    );
}

// ---------------------------------------------------------------------------
// Complete / cancel / requeue
// ---------------------------------------------------------------------------

export type CompleteJobResult = { job: JobRow; offerCount: number };

/**
 * Close a job (`sourcing.completed`). `needs_desk` hands it to the ops sourcing desk
 * instead: back to QUEUED on the desk channel (`sourcing.requested`, channel desk).
 */
export async function completeJob(input: Omit<CompleteJobInput, 'lease_id'>, writer: JobWriter, opts: { now?: Date } = {}): Promise<CompleteJobResult> {
    const now = opts.now ?? new Date();
    const actor = writerActor(writer);
    return withTx(async (tx) => {
        const job = await lockJobForWrite(tx, input.sourcing_request_id, writer, { now });
        const [{ n: offerCount }] = await tx.select({ n: count() }).from(supplierOffers).where(eq(supplierOffers.jobId, job.id));
        if (input.outcome === 'offers_submitted' && offerCount === 0) {
            throw invalid('outcome "offers_submitted" needs at least one submit_offer on this job; use "no_viable_suppliers" or "needs_desk"');
        }
        const base = { leaseId: null, leaseExpiresAt: null, summary: input.summary, outcome: input.outcome, updatedAt: now };
        let updated: JobRow;
        switch (input.outcome) {
            case 'offers_submitted':
            case 'no_viable_suppliers':
                [updated] = await tx
                    .update(sourcingJobs)
                    .set({ ...base, status: 'COMPLETE', completedAt: now })
                    .where(eq(sourcingJobs.id, job.id))
                    .returning();
                break;
            case 'needs_desk':
                [updated] = await tx
                    .update(sourcingJobs)
                    .set({ ...base, status: 'QUEUED', channel: 'desk' })
                    .where(eq(sourcingJobs.id, job.id))
                    .returning();
                break;
            default: {
                const never: never = input.outcome;
                throw new Error(`Unknown outcome ${String(never)}`);
            }
        }
        const common = { actor, correlationId: job.buildId, buildId: job.buildId, timestamp: now };
        await emitEvent(tx, { type: 'sourcing.completed', payload: { jobId: job.id, outcome: input.outcome, offerCount }, ...common });
        if (input.outcome === 'needs_desk') {
            await emitEvent(tx, {
                type: 'sourcing.requested',
                payload: { jobId: job.id, buildId: job.buildId, designVersion: job.designVersion, channel: 'desk', quantity: job.request.quantity },
                ...common,
            });
        }
        return { job: updated, offerCount };
    });
}

/** Cancel pending approvals of a job (inside `tx`), each with `sourcing.approval_decided` (CANCELLED). */
async function cancelPendingApprovals(tx: Tx, job: JobRow, actor: Actor, now: Date): Promise<void> {
    const pending = await tx
        .update(approvals)
        .set({ status: 'CANCELLED', decidedBy: actorId(actor), decidedAt: now, decisionNote: 'Sourcing job cancelled', updatedAt: now })
        .where(and(eq(approvals.jobId, job.id), eq(approvals.status, 'PENDING')))
        .returning();
    for (const a of pending) {
        await emitEvent(tx, {
            type: 'sourcing.approval_decided',
            payload: { approvalId: a.id, kind: a.kind, status: 'CANCELLED', decidedBy: actorId(actor) },
            actor,
            correlationId: job.buildId,
            buildId: job.buildId,
            timestamp: now,
        });
    }
}

/**
 * Ops: cancel an open job. Its lease ends and its pending approvals are cancelled.
 * Emits `sourcing.cancelled` (and `sourcing.approval_decided` CANCELLED per approval).
 */
export async function cancelJob(jobId: string, actor: Actor, opts: { reason?: string; now?: Date } = {}): Promise<JobRow> {
    const now = opts.now ?? new Date();
    return withTx(async (tx) => {
        const [job] = await tx.select().from(sourcingJobs).where(eq(sourcingJobs.id, jobId)).for('update');
        if (!job) throw notFound('Sourcing job');
        if (job.status === 'CANCELLED') return job;
        if (isTerminal(job.status)) throw conflict(`Sourcing job ${job.displayId} is ${job.status} and cannot be cancelled`);
        const [updated] = await tx
            .update(sourcingJobs)
            .set({
                status: 'CANCELLED',
                leaseId: null,
                leaseExpiresAt: null,
                completedAt: now,
                summary: `Cancelled by ${actorId(actor)}${opts.reason ? `: ${opts.reason}` : ''}`.slice(0, 4000),
                updatedAt: now,
            })
            .where(eq(sourcingJobs.id, job.id))
            .returning();
        await cancelPendingApprovals(tx, job, actor, now);
        await emitEvent(tx, { type: 'sourcing.cancelled', payload: { jobId: job.id, reason: opts.reason ?? null }, actor, correlationId: job.id, buildId: job.buildId });
        return updated;
    });
}

/**
 * Ops: put a job back in the queue (any status), optionally switching channel (e.g. to the
 * desk). Ends any lease. Emits `sourcing.requested` for the (new) channel. A job whose
 * build has moved to a newer design version cannot be requeued: create a new job instead.
 */
export async function requeueJob(jobId: string, actor: Actor, opts: { channel?: SourcingChannel; now?: Date } = {}): Promise<JobRow> {
    const now = opts.now ?? new Date();
    return withTx(async (tx) => {
        const [job] = await tx.select().from(sourcingJobs).where(eq(sourcingJobs.id, jobId)).for('update');
        if (!job) throw notFound('Sourcing job');
        const current = await currentDesignVersion(tx, job);
        if (current !== job.designVersion) throw staleDesign(job.designVersion, current);
        const channel = opts.channel ?? job.channel;
        if (job.status === 'QUEUED' && job.channel === channel) return job;
        const [updated] = await tx
            .update(sourcingJobs)
            .set({ status: 'QUEUED', channel, leaseId: null, leasedByClientId: null, leaseExpiresAt: null, completedAt: null, outcome: null, updatedAt: now })
            .where(eq(sourcingJobs.id, job.id))
            .returning();
        await emitEvent(tx, {
            type: 'sourcing.requested',
            payload: { jobId: job.id, buildId: job.buildId, designVersion: job.designVersion, channel, quantity: job.request.quantity },
            actor,
            correlationId: job.buildId,
            buildId: job.buildId,
            timestamp: now,
        });
        return updated;
    });
}

/** Ops: hand a job to the sourcing desk (requeue on the desk channel). */
export function switchJobToDesk(jobId: string, actor: Actor, opts: { now?: Date } = {}): Promise<JobRow> {
    return requeueJob(jobId, actor, { ...opts, channel: 'desk' });
}

/** A revoked client's leases go straight back to the queue. */
export async function releaseClientLeases(tx: DbOrTx, clientId: string, now: Date): Promise<number> {
    const rows = await tx
        .update(sourcingJobs)
        .set({ status: 'QUEUED', leaseId: null, leaseExpiresAt: null, updatedAt: now })
        .where(and(eq(sourcingJobs.leasedByClientId, clientId), inArray(sourcingJobs.status, ['LEASED', 'IN_PROGRESS'])))
        .returning({ id: sourcingJobs.id, buildId: sourcingJobs.buildId });
    await emitLeaseReleased(tx, rows, 'client_revoked');
    return rows.length;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getJobRow(jobId: string, db: DbOrTx = getDb()): Promise<JobRow | null> {
    const [job] = await db.select().from(sourcingJobs).where(eq(sourcingJobs.id, jobId));
    return job ?? null;
}

/** Map rows to views with offer + pending-approval counts (two grouped queries). */
export async function toJobViews(rows: JobRow[], db: DbOrTx = getDb()): Promise<SourcingJobView[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const offerCounts = await db.select({ jobId: supplierOffers.jobId, n: count() }).from(supplierOffers).where(inArray(supplierOffers.jobId, ids)).groupBy(supplierOffers.jobId);
    const approvalCounts = await db
        .select({ jobId: approvals.jobId, n: count() })
        .from(approvals)
        .where(and(inArray(approvals.jobId, ids), eq(approvals.status, 'PENDING')))
        .groupBy(approvals.jobId);
    const offers = new Map(offerCounts.map((c) => [c.jobId, c.n]));
    const pending = new Map(approvalCounts.map((c) => [c.jobId, c.n]));
    return rows.map((r) => toJobView(r, { offerCount: offers.get(r.id) ?? 0, pendingApprovalCount: pending.get(r.id) ?? 0 }));
}

export async function listJobs(filter: { statuses?: SourcingJobStatus[]; channel?: SourcingChannel; buildId?: string; limit?: number } = {}): Promise<SourcingJobView[]> {
    const db = getDb();
    const conds: SQL[] = [];
    if (filter.statuses?.length) conds.push(inArray(sourcingJobs.status, filter.statuses));
    if (filter.channel) conds.push(eq(sourcingJobs.channel, filter.channel));
    if (filter.buildId) conds.push(eq(sourcingJobs.buildId, filter.buildId));
    const rows = await db
        .select()
        .from(sourcingJobs)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(sourcingJobs.priority), desc(sourcingJobs.createdAt))
        .limit(filter.limit ?? 200);
    return toJobViews(rows, db);
}

export async function getJobView(jobId: string): Promise<SourcingJobView | null> {
    const job = await getJobRow(jobId);
    if (!job) return null;
    const [view] = await toJobViews([job]);
    return view;
}

/** Jobs a client has leased (now or before): what `get_job` may read. */
export async function getJobForClient(jobId: string, clientId: string): Promise<JobRow> {
    const [job] = await getDb()
        .select()
        .from(sourcingJobs)
        .where(and(eq(sourcingJobs.id, jobId), eq(sourcingJobs.leasedByClientId, clientId)));
    if (!job) throw notFound('Sourcing job');
    return job;
}
