/**
 * Browser client for the R2 sourcing routes (ADR-0005, workflow 03).
 * Buyer routes are public like the other build routes; admin routes take the ops
 * bearer token the same way the ops board does. Errors surface as `ApiClientError`.
 */
import type {
    ApprovalDecisionRequest,
    ApprovalStatus,
    ApprovalView,
    BuildSourcingView,
    CreateSourcingClientResponse,
    CreateSourcingRequest,
    OkResponse,
    RouteOfferView,
    SourcingJobStatus,
    SourcingJobView,
    SubmitOfferInput,
    SubmitSupplierInput,
    SupplierOfferView,
    SupplierLegOpsView,
} from '@/contracts';
import { apiFetch } from '@/lib/api';

const enc = encodeURIComponent;
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** GET /api/admin/sourcing/clients row. Never carries the token or its hash. */
export type SourcingClientRow = {
    clientId: string;
    name: string;
    createdAt: string;
    lastUsedAt: string | null;
    revokedAt: string | null;
    /** Per-workspace allowlist (absent from older servers): null = all tools / any IP. */
    allowedTools?: string[] | null;
    allowedCidrs?: string[] | null;
};

/** One negotiation thread per supplier on a job (sourcing_negotiations). Fields beyond id/status are optional until the contract pins them. */
export type SourcingNegotiationRow = {
    id: string;
    supplierId?: string | null;
    supplierName?: string | null;
    status: string;
    notes?: { at: string; status: string; note: string }[];
    updatedAt?: string | null;
    createdAt?: string | null;
};

/** A document the agent or desk attached to a job (sourcing_documents). */
export type SourcingDocumentRow = {
    id: string;
    supplierId?: string | null;
    kind: string;
    filename: string;
    contentType?: string | null;
    sizeBytes?: number | null;
    url?: string | null;
    createdAt?: string | null;
};

export type SourcingJobDetail = {
    job: SourcingJobView;
    offers: SupplierOfferView[];
    approvals: ApprovalView[];
    negotiations: SourcingNegotiationRow[];
    documents: SourcingDocumentRow[];
    /** R3: supplier fulfilment legs (purchase orders) made from this job's offers. */
    legs?: SupplierLegOpsView[];
};

/** Desk fallback bodies: the MCP tool inputs without the lease (ops are not leasing). */
export type DeskSupplierBody = Omit<SubmitSupplierInput, 'lease_id'>;
export type DeskOfferBody = Omit<SubmitOfferInput, 'lease_id'>;
export type AdminCreateJobBody = CreateSourcingRequest & { buildId: string };

export const ACTIVE_JOB_STATUSES: readonly SourcingJobStatus[] = ['QUEUED', 'LEASED', 'IN_PROGRESS'];

export const sourcingApi = {
    // ---- buyer ----
    buildSourcing: (buildId: string) => apiFetch<BuildSourcingView>(`/api/builds/${enc(buildId)}/sourcing`),
    requestSourcing: (buildId: string, body: CreateSourcingRequest) =>
        apiFetch<{ id: string; displayId: string; status: SourcingJobStatus }>(`/api/builds/${enc(buildId)}/sourcing`, { body }),
    selectOffer: (buildId: string, offerId: string) =>
        apiFetch<RouteOfferView>(`/api/builds/${enc(buildId)}/sourcing/offers/${enc(offerId)}/select`, { method: 'POST' }),

    // ---- ops sourcing desk ----
    adminJobs: (token: string, status?: SourcingJobStatus) =>
        apiFetch<SourcingJobView[]>(`/api/admin/sourcing/jobs${status ? `?status=${enc(status)}` : ''}`, { headers: bearer(token) }),
    adminCreateJob: (token: string, body: AdminCreateJobBody) => apiFetch<SourcingJobView>('/api/admin/sourcing/jobs', { body, headers: bearer(token) }),
    adminJob: (token: string, jobId: string) => apiFetch<SourcingJobDetail>(`/api/admin/sourcing/jobs/${enc(jobId)}`, { headers: bearer(token) }),
    adminCancelJob: (token: string, jobId: string) =>
        apiFetch<unknown>(`/api/admin/sourcing/jobs/${enc(jobId)}/cancel`, { method: 'POST', headers: bearer(token) }),
    adminRequeueJob: (token: string, jobId: string) =>
        apiFetch<unknown>(`/api/admin/sourcing/jobs/${enc(jobId)}/requeue`, { method: 'POST', headers: bearer(token) }),
    adminAddSupplier: (token: string, jobId: string, body: DeskSupplierBody) =>
        apiFetch<Record<string, unknown>>(`/api/admin/sourcing/jobs/${enc(jobId)}/suppliers`, { body, headers: bearer(token) }),
    adminAddOffer: (token: string, jobId: string, body: DeskOfferBody) =>
        apiFetch<Record<string, unknown>>(`/api/admin/sourcing/jobs/${enc(jobId)}/offers`, { body, headers: bearer(token) }),
    adminApprovals: (token: string, status: ApprovalStatus = 'PENDING') =>
        apiFetch<ApprovalView[]>(`/api/admin/sourcing/approvals?status=${enc(status)}`, { headers: bearer(token) }),
    adminDecide: (token: string, approvalId: string, body: ApprovalDecisionRequest) =>
        apiFetch<ApprovalView>(`/api/admin/sourcing/approvals/${enc(approvalId)}/decision`, { body, headers: bearer(token) }),
    adminListClients: (token: string) => apiFetch<SourcingClientRow[]>('/api/admin/sourcing/clients', { headers: bearer(token) }),
    adminCreateClient: (token: string, name: string) =>
        apiFetch<CreateSourcingClientResponse>('/api/admin/sourcing/clients', { body: { name }, headers: bearer(token) }),
    adminUpdateClientAllowlist: (token: string, clientId: string, body: { allowedTools: string[] | null; allowedCidrs: string[] | null }) =>
        apiFetch<SourcingClientRow>(`/api/admin/sourcing/clients/${enc(clientId)}/allowlist`, { method: 'PUT', body, headers: bearer(token) }),
    adminRevokeClient: (token: string, clientId: string) =>
        apiFetch<OkResponse | null>(`/api/admin/sourcing/clients/${enc(clientId)}`, { method: 'DELETE', headers: bearer(token) }),
};

/** Pull an id out of a desk write response whatever its casing (`supplier_id`, `supplierId`, `id`, or nested). */
export function idFromResponse(res: unknown, key: 'supplier' | 'offer'): string | null {
    if (!res || typeof res !== 'object') return null;
    const r = res as Record<string, unknown>;
    const candidates = [r[`${key}_id`], r[`${key}Id`], (r[key] as Record<string, unknown> | undefined)?.id, r.id];
    const hit = candidates.find((v) => typeof v === 'string' && v.length > 0);
    return (hit as string | undefined) ?? null;
}
