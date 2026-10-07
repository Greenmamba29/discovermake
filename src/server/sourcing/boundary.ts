/**
 * Enforcement of the approval boundary (./policy.ts) against the database.
 *
 * `enforceBoundary` evaluates one action for a job; when the policy says
 * APPROVAL_REQUIRED it records `sourcing.boundary_blocked` in its OWN transaction
 * (so the record survives the caller's rollback) and throws a SourcingError carrying
 * the approval kind the agent should request. Call it before opening the write
 * transaction of the action it guards.
 */
import { eq } from 'drizzle-orm';
import type { Actor } from '../../contracts/common';
import type { ApprovalKind } from '../../contracts/enums';
import { getDb, type DbOrTx } from '../db';
import { approvals } from '../db/schema';
import { emitEvent } from '../events/outbox';
import { SourcingError } from './errors';
import { BOUNDARY_RULES, evaluate, type AgentAction, type ApprovalFact } from './policy';
import type { JobRow } from './views';

/** Approvals of a job, as policy facts. */
export async function approvalFacts(db: DbOrTx, jobId: string): Promise<ApprovalFact[]> {
    return db.select({ kind: approvals.kind, status: approvals.status, supplierId: approvals.supplierId }).from(approvals).where(eq(approvals.jobId, jobId));
}

/** Record a refused boundary crossing (own transaction). */
export async function recordBoundaryBlocked(input: { job: Pick<JobRow, 'id' | 'buildId'> | null; actor: Actor; tool: string; approvalKind: ApprovalKind }): Promise<void> {
    await getDb().transaction(async (tx) => {
        await emitEvent(tx, {
            type: 'sourcing.boundary_blocked',
            payload: { jobId: input.job?.id ?? null, clientId: input.actor.id, tool: input.tool.slice(0, 80), approvalKind: input.approvalKind },
            actor: input.actor,
            correlationId: input.job?.buildId ?? input.actor.id,
            buildId: input.job?.buildId ?? null,
        });
    });
}

/**
 * Throws SourcingError(APPROVAL_REQUIRED) unless `action` is inside the boundary for this
 * job. Approvals are loaded only for rules an approval can unlock.
 */
export async function enforceBoundary(action: AgentAction, input: { job: JobRow; actor: Actor; tool: string; supplierId?: string | null }): Promise<void> {
    const rule = BOUNDARY_RULES[action];
    const needsApprovals = rule.effect === 'require_supplier_approval' || (rule.effect === 'allow_if_flag' && rule.unlockedBySupplierApproval);
    const facts = needsApprovals ? await approvalFacts(getDb(), input.job.id) : [];
    const decision = evaluate(action, { policy: input.job.approvalPolicy, supplierId: input.supplierId ?? null, approvals: facts });
    if (decision.allowed) return;
    if (decision.approvalKind) {
        await recordBoundaryBlocked({ job: input.job, actor: input.actor, tool: input.tool, approvalKind: decision.approvalKind });
    }
    throw new SourcingError('APPROVAL_REQUIRED', decision.reason, decision.approvalKind ?? undefined);
}
