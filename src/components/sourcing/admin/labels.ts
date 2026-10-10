import type { ApprovalKind, ApprovalStatus, NegotiationStatus, SourcingJobStatus, UniversalStatus } from '@/contracts';

/** Sourcing job status → universal pill (the only pill vocabulary). The raw status is shown next to it in mono. */
export const JOB_PILL: Record<SourcingJobStatus, UniversalStatus> = {
    QUEUED: 'REVIEW',
    LEASED: 'ANALYZING',
    IN_PROGRESS: 'ANALYZING',
    COMPLETE: 'COMPLETE',
    CANCELLED: 'CANCELLED',
    FAILED: 'FAILED',
};

export const APPROVAL_PILL: Record<ApprovalStatus, UniversalStatus> = {
    PENDING: 'REVIEW',
    APPROVED: 'READY',
    REJECTED: 'FAILED',
    EXPIRED: 'CANCELLED',
    CANCELLED: 'CANCELLED',
};

export const APPROVAL_KIND_LABEL: Record<ApprovalKind, string> = {
    RELEASE_FULL_PACKAGE: 'Release full design package',
    REQUEST_SAMPLE: 'Request a sample',
    PAY_DEPOSIT: 'Pay a deposit',
    PLACE_PURCHASE_ORDER: 'Place a purchase order',
    ACCEPT_MATERIAL_SUBSTITUTION: 'Accept material substitution',
    ACCEPT_TOLERANCE_CHANGE: 'Accept tolerance change',
    APPROVE_TOOLING: 'Approve tooling expense',
    START_PRODUCTION: 'Start production',
    CHANGE_COMPLIANCE: 'Change compliance requirements',
    SELECT_SUPPLIER_OFFER: 'Buyer selected a supplier offer',
};

export const NEGOTIATION_LABEL: Record<NegotiationStatus, string> = {
    contacted: 'Contacted',
    'rfq-sent': 'RFQ sent',
    'awaiting-reply': 'Awaiting reply',
    negotiating: 'Negotiating',
    'supplier-estimate': 'Supplier estimate',
    'supplier-confirmed': 'Supplier confirmed',
    declined: 'Declined',
    'no-response': 'No response',
};

export const JOB_FILTERS: { label: string; status?: SourcingJobStatus }[] = [
    { label: 'All' },
    { label: 'Queued', status: 'QUEUED' },
    { label: 'Leased', status: 'LEASED' },
    { label: 'In progress', status: 'IN_PROGRESS' },
    { label: 'Complete', status: 'COMPLETE' },
    { label: 'Cancelled', status: 'CANCELLED' },
    { label: 'Failed', status: 'FAILED' },
];
