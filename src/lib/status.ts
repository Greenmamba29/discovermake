import type { JobStatus, MilestoneKind, TrackingStepKey, UniversalStatus } from '@/contracts';

/** Pill styling for the universal status language (the ONLY vocabulary on pills). Red is LIVE only. */
export const UNIVERSAL_PILL: Record<UniversalStatus, { label: string; className: string; dot: string }> = {
    DRAFT: { label: 'Draft', className: 'bg-graphite-700 text-fg-muted', dot: 'bg-fg-subtle' },
    ANALYZING: { label: 'Analyzing', className: 'bg-graphite-700 text-fg', dot: 'bg-fg animate-pulse' },
    NEEDS_INPUT: { label: 'Needs input', className: 'bg-amber/15 text-amber', dot: 'bg-amber' },
    READY: { label: 'Ready', className: 'bg-signal/15 text-signal', dot: 'bg-signal' },
    REVIEW: { label: 'Review', className: 'bg-amber/15 text-amber', dot: 'bg-amber' },
    IN_PRODUCTION: { label: 'In production', className: 'bg-signal/15 text-signal', dot: 'bg-signal animate-pulse' },
    LIVE: { label: 'Live', className: 'bg-live/15 text-live', dot: 'bg-live animate-pulse' },
    COMPLETE: { label: 'Complete', className: 'bg-graphite-700 text-fg', dot: 'bg-signal' },
    FAILED: { label: 'Failed', className: 'bg-ember/15 text-ember', dot: 'bg-ember' },
    CANCELLED: { label: 'Cancelled', className: 'bg-graphite-700 text-fg-subtle', dot: 'bg-fg-subtle' },
};

/** Paper-surface variant (passport, marketing). */
export const UNIVERSAL_PILL_PAPER: Record<UniversalStatus, string> = {
    DRAFT: 'bg-paper-line text-ink-muted',
    ANALYZING: 'bg-paper-line text-ink',
    NEEDS_INPUT: 'bg-[#fbecc8] text-[#6b4a05]',
    READY: 'bg-[#d8f5e1] text-[#14532d]',
    REVIEW: 'bg-[#fbecc8] text-[#6b4a05]',
    IN_PRODUCTION: 'bg-[#d8f5e1] text-[#14532d]',
    LIVE: 'bg-[#fde0e0] text-[#8a1214]',
    COMPLETE: 'bg-[#d8f5e1] text-[#14532d]',
    FAILED: 'bg-[#fbe1d2] text-[#7a3109]',
    CANCELLED: 'bg-paper-line text-ink-muted',
};

/** Tracker stepper copy (workflow 04 · screen 06). */
export const TRACKING_STEP_LABELS: Record<TrackingStepKey, string> = {
    DESIGN: 'Design locked',
    MATERIALS: 'Materials',
    PRODUCTION: 'Production',
    QA: 'QA',
    SHIPPING: 'Shipping',
    DELIVERED: 'Delivered',
};

export const MILESTONE_LABELS: Record<MilestoneKind, { label: string; doing: string }> = {
    MATERIAL_STAGED: { label: 'Material staged', doing: 'Material is staged at the machine' },
    CUTTING: { label: 'Cutting', doing: 'Cutting started' },
    BENDING: { label: 'Bending', doing: 'Bending started' },
    FINISHING: { label: 'Finishing', doing: 'Finishing started' },
    QA: { label: 'QA', doing: 'Parts are in inspection' },
    PACKED: { label: 'Packed', doing: 'Parts are packed' },
};

/** Job status -> universal pill (Shop Console). */
export const JOB_UNIVERSAL: Record<JobStatus, UniversalStatus> = {
    OFFERED: 'REVIEW',
    ACCEPTED: 'READY',
    DECLINED: 'CANCELLED',
    EXPIRED: 'CANCELLED',
    IN_PRODUCTION: 'IN_PRODUCTION',
    QA_FAILED: 'FAILED',
    QA_PASSED: 'IN_PRODUCTION',
    SHIPPED: 'IN_PRODUCTION',
    DELIVERED: 'COMPLETE',
    CANCELLED: 'CANCELLED',
};

export const JOB_STATUS_TEXT: Record<JobStatus, string> = {
    OFFERED: 'New offer',
    ACCEPTED: 'Accepted · not started',
    DECLINED: 'Declined',
    EXPIRED: 'Offer expired',
    IN_PRODUCTION: 'In production',
    QA_FAILED: 'Failed inspection',
    QA_PASSED: 'Passed inspection · ready to ship',
    SHIPPED: 'Shipped',
    DELIVERED: 'Delivered',
    CANCELLED: 'Cancelled',
};
