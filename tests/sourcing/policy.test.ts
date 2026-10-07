/**
 * The approval boundary (ADR-0005) as pure rules: an agent can never place an order,
 * release the full package without a per-supplier approval, or change tolerances, and
 * no MCP tool maps to a human-only action.
 */
import { describe, expect, it } from 'vitest';
import { APPROVAL_KINDS } from '@/contracts/enums';
import { DEFAULT_APPROVAL_POLICY, type ApprovalPolicy } from '@/contracts/sourcing';
import { AGENT_ACTIONS, BOUNDARY_RULES, SOURCING_TOOLS, TOOL_ACTIONS, approverRoleFor, evaluate, type AgentAction, type ApprovalFact } from '@/server/sourcing/policy';
import { TokenBucketRateLimiter } from '@/server/sourcing/rate-limit';

const policy: ApprovalPolicy = { ...DEFAULT_APPROVAL_POLICY };
const HUMAN_ONLY: AgentAction[] = ['pay_deposit', 'place_purchase_order', 'approve_tooling', 'start_production', 'change_compliance', 'change_tolerance', 'change_material', 'select_offer'];
const allApproved = (supplierId: string): ApprovalFact[] => APPROVAL_KINDS.map((kind) => ({ kind, status: 'APPROVED', supplierId }));

describe('sourcing approval boundary', () => {
    it('allows the autonomous actions of ADR-0005', () => {
        for (const a of ['read_job', 'search_suppliers', 'submit_supplier', 'submit_offer', 'contact_supplier', 'negotiate', 'update_notes', 'attach_document', 'request_approval', 'complete_job', 'fetch_redacted_package'] as const) {
            expect(evaluate(a, { policy }).allowed, a).toBe(true);
        }
    });

    it('never lets an agent place an order, pay, approve tooling, start production or change engineering requirements, even with approvals on file', () => {
        for (const a of HUMAN_ONLY) {
            const d = evaluate(a, { policy, supplierId: 'sup_x', approvals: allApproved('sup_x') });
            expect(d.allowed, a).toBe(false);
            if (!d.allowed) {
                expect(d.code).toBe('APPROVAL_REQUIRED');
                expect(d.approvalKind).toBe((BOUNDARY_RULES[a] as { approvalKind: string }).approvalKind);
            }
        }
        const po = evaluate('place_purchase_order', { policy });
        expect(po).toMatchObject({ allowed: false, approvalKind: 'PLACE_PURCHASE_ORDER' });
        expect(evaluate('change_tolerance', { policy })).toMatchObject({ allowed: false, approvalKind: 'ACCEPT_TOLERANCE_CHANGE' });
        expect(evaluate('change_material', { policy })).toMatchObject({ allowed: false, approvalKind: 'ACCEPT_MATERIAL_SUBSTITUTION' });
    });

    it('releases the FULL package only with an APPROVED RELEASE_FULL_PACKAGE for that exact supplier', () => {
        expect(evaluate('fetch_full_package', { policy })).toMatchObject({ allowed: false, approvalKind: 'RELEASE_FULL_PACKAGE' });
        expect(evaluate('fetch_full_package', { policy, supplierId: 'sup_a' })).toMatchObject({ allowed: false, approvalKind: 'RELEASE_FULL_PACKAGE' });
        const pending: ApprovalFact[] = [{ kind: 'RELEASE_FULL_PACKAGE', status: 'PENDING', supplierId: 'sup_a' }];
        expect(evaluate('fetch_full_package', { policy, supplierId: 'sup_a', approvals: pending }).allowed).toBe(false);
        const otherSupplier: ApprovalFact[] = [{ kind: 'RELEASE_FULL_PACKAGE', status: 'APPROVED', supplierId: 'sup_b' }];
        expect(evaluate('fetch_full_package', { policy, supplierId: 'sup_a', approvals: otherSupplier }).allowed).toBe(false);
        const otherKind: ApprovalFact[] = [{ kind: 'REQUEST_SAMPLE', status: 'APPROVED', supplierId: 'sup_a' }];
        expect(evaluate('fetch_full_package', { policy, supplierId: 'sup_a', approvals: otherKind }).allowed).toBe(false);
        const approved: ApprovalFact[] = [{ kind: 'RELEASE_FULL_PACKAGE', status: 'APPROVED', supplierId: 'sup_a' }];
        expect(evaluate('fetch_full_package', { policy, supplierId: 'sup_a', approvals: approved }).allowed).toBe(true);
        // allow_full_package is literally false in every policy: there is no flag to flip.
        expect(DEFAULT_APPROVAL_POLICY.allow_full_package).toBe(false);
        expect(DEFAULT_APPROVAL_POLICY.allow_purchase).toBe(false);
    });

    it('gates sample requests on the policy flag or a per-supplier approval', () => {
        expect(evaluate('request_sample', { policy, supplierId: 'sup_a' })).toMatchObject({ allowed: false, approvalKind: 'REQUEST_SAMPLE' });
        expect(evaluate('request_sample', { policy: { ...policy, allow_sample_request: true } }).allowed).toBe(true);
        expect(evaluate('request_sample', { policy, supplierId: 'sup_a', approvals: [{ kind: 'REQUEST_SAMPLE', status: 'APPROVED', supplierId: 'sup_a' }] }).allowed).toBe(true);
        expect(evaluate('request_sample', { policy, supplierId: 'sup_a', approvals: [{ kind: 'REQUEST_SAMPLE', status: 'REJECTED', supplierId: 'sup_a' }] }).allowed).toBe(false);
    });

    it('blocks contact and negotiation when the job policy turns them off', () => {
        expect(evaluate('negotiate', { policy: { ...policy, allow_negotiation: false } })).toMatchObject({ allowed: false, code: 'APPROVAL_REQUIRED', approvalKind: null });
        expect(evaluate('contact_supplier', { policy: { ...policy, allow_supplier_contact: false } }).allowed).toBe(false);
    });

    it('covers every action with a rule, and no MCP tool can perform a human-only action', () => {
        expect(Object.keys(BOUNDARY_RULES).sort()).toEqual([...AGENT_ACTIONS].sort());
        expect(Object.keys(TOOL_ACTIONS).sort()).toEqual([...SOURCING_TOOLS].sort());
        for (const tool of SOURCING_TOOLS) {
            for (const action of TOOL_ACTIONS[tool]) {
                expect(BOUNDARY_RULES[action].effect, `${tool} -> ${action}`).not.toBe('human_only');
            }
        }
        // Nothing an agent can call is about engineering fields, orders or approval decisions.
        expect(SOURCING_TOOLS.join(' ')).not.toMatch(/order|purchase|pay|deposit|tolerance|material|geometry|decide|approve_|select/i);
    });

    it('routes customer-facing approvals to the customer unless the customer asked', () => {
        expect(approverRoleFor('SELECT_SUPPLIER_OFFER')).toBe('customer');
        expect(approverRoleFor('ACCEPT_TOLERANCE_CHANGE')).toBe('customer');
        expect(approverRoleFor('ACCEPT_MATERIAL_SUBSTITUTION')).toBe('customer');
        expect(approverRoleFor('SELECT_SUPPLIER_OFFER', true)).toBe('ops');
        for (const k of ['RELEASE_FULL_PACKAGE', 'REQUEST_SAMPLE', 'PAY_DEPOSIT', 'PLACE_PURCHASE_ORDER', 'APPROVE_TOOLING', 'START_PRODUCTION', 'CHANGE_COMPLIANCE'] as const) {
            expect(approverRoleFor(k)).toBe('ops');
        }
    });

    it('rate limits per client with a token bucket', () => {
        const rl = new TokenBucketRateLimiter(3, 1);
        const t = 1_000_000;
        expect(rl.take('a', t).allowed).toBe(true);
        expect(rl.take('a', t).allowed).toBe(true);
        expect(rl.take('a', t).allowed).toBe(true);
        expect(rl.take('a', t)).toMatchObject({ allowed: false });
        expect(rl.take('b', t).allowed).toBe(true);
        expect(rl.take('a', t + 1000).allowed).toBe(true);
    });
});
