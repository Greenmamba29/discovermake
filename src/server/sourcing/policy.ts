/**
 * The sourcing approval boundary (ADR-0005), as data plus a pure evaluator.
 *
 * Workflow 03 says OPA (`database/policies/sourcing.rego`) enforces this at the bridge.
 * R2 ships the SAME rules in TypeScript (this file, unit-tested in
 * tests/sourcing/policy.test.ts); R3 moves them into an OPA sidecar that loads
 * `BOUNDARY_RULES` / `TOOL_ACTIONS` as its data document, so the rules stay one table.
 *
 * What an agent (Accio Work) may do by itself: search, register suppliers, submit
 * offers, contact and negotiate within the job's bounds, keep notes, attach documents,
 * fetch the REDACTED package, request approvals, and complete jobs.
 * Everything else is a human decision inside DiscoverMake and evaluates to
 * APPROVAL_REQUIRED with the approval kind the agent should request:
 * - the FULL package needs an APPROVED RELEASE_FULL_PACKAGE for that exact supplier;
 * - a sample request needs `allow_sample_request` or an APPROVED REQUEST_SAMPLE for that supplier;
 * - deposits, purchase orders, tooling, production, compliance, tolerance and material
 *   changes, and choosing the winning offer are HUMAN-ONLY: an approval does not let the
 *   agent do them, it lets a human do them in DiscoverMake.
 *
 * Pure: no I/O. The DB-aware wrapper that records `sourcing.boundary_blocked` is
 * `enforceBoundary` in ./boundary.ts.
 */
import type { ApprovalKind, ApprovalStatus, ApproverRole } from '../../contracts/enums';
import type { ApprovalPolicy } from '../../contracts/sourcing';

export const AGENT_ACTIONS = [
    'read_job',
    'search_suppliers',
    'submit_supplier',
    'submit_offer',
    'contact_supplier',
    'negotiate',
    'update_notes',
    'attach_document',
    'request_approval',
    'complete_job',
    'fetch_redacted_package',
    'fetch_full_package',
    'request_sample',
    'pay_deposit',
    'place_purchase_order',
    'approve_tooling',
    'start_production',
    'change_compliance',
    'change_tolerance',
    'change_material',
    'select_offer',
] as const;
export type AgentAction = (typeof AGENT_ACTIONS)[number];

type PolicyFlag = 'allow_supplier_contact' | 'allow_negotiation' | 'allow_sample_request';

export type BoundaryRule =
    /** Always within the boundary. */
    | { effect: 'allow' }
    /** Allowed while the job's approval policy flag is true; otherwise needs `approvalKind` (null = no approval can unlock it). */
    | { effect: 'allow_if_flag'; flag: PolicyFlag; approvalKind: ApprovalKind | null; unlockedBySupplierApproval: boolean }
    /** Allowed only with an APPROVED approval of `approvalKind` for the same supplier. */
    | { effect: 'require_supplier_approval'; approvalKind: ApprovalKind }
    /** Never done by an agent. `approvalKind` is what the agent should request so a human can act. */
    | { effect: 'human_only'; approvalKind: ApprovalKind };

/** The boundary, one row per action. Changing a row is a reviewed policy change. */
export const BOUNDARY_RULES: Readonly<Record<AgentAction, BoundaryRule>> = {
    read_job: { effect: 'allow' },
    search_suppliers: { effect: 'allow' },
    submit_supplier: { effect: 'allow' },
    submit_offer: { effect: 'allow' },
    contact_supplier: { effect: 'allow_if_flag', flag: 'allow_supplier_contact', approvalKind: null, unlockedBySupplierApproval: false },
    negotiate: { effect: 'allow_if_flag', flag: 'allow_negotiation', approvalKind: null, unlockedBySupplierApproval: false },
    update_notes: { effect: 'allow' },
    attach_document: { effect: 'allow' },
    request_approval: { effect: 'allow' },
    complete_job: { effect: 'allow' },
    fetch_redacted_package: { effect: 'allow' },
    fetch_full_package: { effect: 'require_supplier_approval', approvalKind: 'RELEASE_FULL_PACKAGE' },
    request_sample: { effect: 'allow_if_flag', flag: 'allow_sample_request', approvalKind: 'REQUEST_SAMPLE', unlockedBySupplierApproval: true },
    pay_deposit: { effect: 'human_only', approvalKind: 'PAY_DEPOSIT' },
    place_purchase_order: { effect: 'human_only', approvalKind: 'PLACE_PURCHASE_ORDER' },
    approve_tooling: { effect: 'human_only', approvalKind: 'APPROVE_TOOLING' },
    start_production: { effect: 'human_only', approvalKind: 'START_PRODUCTION' },
    change_compliance: { effect: 'human_only', approvalKind: 'CHANGE_COMPLIANCE' },
    change_tolerance: { effect: 'human_only', approvalKind: 'ACCEPT_TOLERANCE_CHANGE' },
    change_material: { effect: 'human_only', approvalKind: 'ACCEPT_MATERIAL_SUBSTITUTION' },
    select_offer: { effect: 'human_only', approvalKind: 'SELECT_SUPPLIER_OFFER' },
};

/** Short MCP tool names (registered as `discovermake.sourcing.<name>`). */
export const SOURCING_TOOLS = [
    'next_job',
    'get_job',
    'get_attachments',
    'submit_supplier',
    'submit_offer',
    'update_negotiation',
    'attach_document',
    'request_approval',
    'complete_job',
] as const;
export type SourcingToolName = (typeof SOURCING_TOOLS)[number];

/**
 * Every action a tool can perform. There is deliberately no tool whose actions include a
 * human-only action, and none that writes a Build's engineering fields (geometry,
 * material, tolerance): tests/sourcing/policy.test.ts proves both.
 */
export const TOOL_ACTIONS: Readonly<Record<SourcingToolName, readonly AgentAction[]>> = {
    next_job: ['read_job'],
    get_job: ['read_job'],
    get_attachments: ['fetch_redacted_package', 'fetch_full_package'],
    submit_supplier: ['submit_supplier'],
    submit_offer: ['submit_offer'],
    update_negotiation: ['negotiate', 'update_notes'],
    attach_document: ['attach_document'],
    request_approval: ['request_approval'],
    complete_job: ['complete_job'],
};

export type ApprovalFact = { kind: ApprovalKind; status: ApprovalStatus; supplierId: string | null };

export type PolicyContext = {
    policy: ApprovalPolicy;
    /** The supplier the action concerns (package release, sample). */
    supplierId?: string | null;
    /** Approvals recorded for the job. Only APPROVED rows for the same supplier unlock anything. */
    approvals?: readonly ApprovalFact[];
};

export type PolicyDecision =
    | { allowed: true; action: AgentAction }
    | { allowed: false; action: AgentAction; code: 'APPROVAL_REQUIRED'; approvalKind: ApprovalKind | null; reason: string };

function hasSupplierApproval(ctx: PolicyContext, kind: ApprovalKind): boolean {
    if (!ctx.supplierId) return false;
    return (ctx.approvals ?? []).some((a) => a.kind === kind && a.status === 'APPROVED' && a.supplierId === ctx.supplierId);
}

/** Evaluate one agent action against the boundary. Pure and total. */
export function evaluate(action: AgentAction, ctx: PolicyContext): PolicyDecision {
    const rule = BOUNDARY_RULES[action];
    const blocked = (approvalKind: ApprovalKind | null, reason: string): PolicyDecision => ({ allowed: false, action, code: 'APPROVAL_REQUIRED', approvalKind, reason });
    switch (rule.effect) {
        case 'allow':
            return { allowed: true, action };
        case 'allow_if_flag': {
            if (ctx.policy[rule.flag] === true) return { allowed: true, action };
            if (rule.approvalKind && rule.unlockedBySupplierApproval && hasSupplierApproval(ctx, rule.approvalKind)) return { allowed: true, action };
            return blocked(
                rule.approvalKind,
                rule.approvalKind
                    ? `This job's approval policy does not allow ${action.replace(/_/g, ' ')}. Call request_approval with kind ${rule.approvalKind}${rule.unlockedBySupplierApproval ? ' for this supplier' : ''}.`
                    : `This job's approval policy does not allow ${action.replace(/_/g, ' ')}. Hand the job to the desk with complete_job(outcome: "needs_desk").`,
            );
        }
        case 'require_supplier_approval': {
            if (hasSupplierApproval(ctx, rule.approvalKind)) return { allowed: true, action };
            return blocked(
                rule.approvalKind,
                ctx.supplierId
                    ? `A human must approve ${rule.approvalKind} for supplier ${ctx.supplierId} first. Call request_approval with kind ${rule.approvalKind} and this supplier_id, then retry after it is APPROVED.`
                    : `${rule.approvalKind} is approved per supplier: pass supplier_id, and call request_approval with kind ${rule.approvalKind} for that supplier first.`,
            );
        }
        case 'human_only':
            return blocked(
                rule.approvalKind,
                `Only a human in DiscoverMake may ${action.replace(/_/g, ' ')}. Call request_approval with kind ${rule.approvalKind}; a human decides and acts inside DiscoverMake.`,
            );
        default: {
            const never: never = rule;
            throw new Error(`Unknown boundary rule ${JSON.stringify(never)}`);
        }
    }
}

/** Approval kinds the customer decides (they change what the customer gets). */
export const CUSTOMER_APPROVAL_KINDS: ReadonlySet<ApprovalKind> = new Set<ApprovalKind>(['SELECT_SUPPLIER_OFFER', 'ACCEPT_MATERIAL_SUBSTITUTION', 'ACCEPT_TOLERANCE_CHANGE']);

/**
 * Who decides an approval. Customer-facing kinds go to the customer, except when the
 * customer is the one asking (a buyer selecting an offer on the Manufacturing Route):
 * their consent is the request itself, so ops confirms it.
 */
export function approverRoleFor(kind: ApprovalKind, requestedByCustomer = false): ApproverRole {
    if (CUSTOMER_APPROVAL_KINDS.has(kind) && !requestedByCustomer) return 'customer';
    return 'ops';
}
