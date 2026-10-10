'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import type { ApprovalView } from '@/contracts';
import { ConfirmAction } from '@/components/ui/confirm-action';
import { Field, TextInput } from '@/components/ui/field';
import { Notice } from '@/components/ui/state';
import { StatusPill } from '@/components/ui/status-pill';
import { errorMessage } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { sourcingApi } from '../api';
import { APPROVAL_KIND_LABEL, APPROVAL_PILL } from './labels';

function DetailValue({ value }: { value: unknown }) {
    if (value === null || value === undefined) return <>—</>;
    if (typeof value === 'object') return <code className="break-all">{JSON.stringify(value)}</code>;
    return <>{String(value)}</>;
}

/** One approval at the ADR-0005 boundary with approve/reject for ops. */
export function ApprovalCard({ token, approval, showJobLink = false }: { token: string; approval: ApprovalView; showJobLink?: boolean }) {
    const qc = useQueryClient();
    const [note, setNote] = useState('');
    const [error, setError] = useState<string | null>(null);
    const pending = approval.status === 'PENDING';
    const details = Object.entries(approval.details ?? {});
    const decide = async (decision: 'APPROVED' | 'REJECTED') => {
        setError(null);
        try {
            await sourcingApi.adminDecide(token, approval.id, { decision, ...(note.trim() ? { note: note.trim() } : {}) });
            setNote('');
            await Promise.all([
                qc.invalidateQueries({ queryKey: ['sourcing-approvals'] }),
                qc.invalidateQueries({ queryKey: ['sourcing-jobs'] }),
                approval.jobId ? qc.invalidateQueries({ queryKey: ['sourcing-job', approval.jobId] }) : Promise.resolve(),
            ]);
        } catch (err) {
            setError(errorMessage(err));
        }
    };
    return (
        <article className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700" aria-labelledby={`approval-${approval.id}`} data-testid={`approval-${approval.id}`}>
            <div className="flex flex-wrap items-center gap-2">
                <h3 id={`approval-${approval.id}`} className="font-semibold">
                    {APPROVAL_KIND_LABEL[approval.kind]}
                </h3>
                <StatusPill status={APPROVAL_PILL[approval.status]} />
                <span className="font-mono text-[11px] text-fg-subtle">{approval.status}</span>
                <span className="rounded-md bg-graphite-750 px-2 py-0.5 text-[11px] text-fg-muted">Decides: {approval.approverRole}</span>
            </div>
            <p className="mt-2 text-sm text-fg">{approval.reason}</p>
            <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs text-fg-muted sm:grid-cols-2">
                <div>
                    <dt className="inline text-fg-subtle">Requested by </dt>
                    <dd className="inline font-mono">{approval.requestedBy}</dd>
                </div>
                <div>
                    <dt className="inline text-fg-subtle">Requested </dt>
                    <dd className="inline">{dateTime(approval.createdAt)}</dd>
                </div>
                {approval.expiresAt && (
                    <div>
                        <dt className="inline text-fg-subtle">Expires </dt>
                        <dd className="inline">{dateTime(approval.expiresAt)}</dd>
                    </div>
                )}
                {approval.supplierId && (
                    <div>
                        <dt className="inline text-fg-subtle">Supplier </dt>
                        <dd className="inline font-mono">{approval.supplierId}</dd>
                    </div>
                )}
                {approval.supplierOfferId && (
                    <div>
                        <dt className="inline text-fg-subtle">Offer </dt>
                        <dd className="inline font-mono">{approval.supplierOfferId}</dd>
                    </div>
                )}
                <div>
                    <dt className="inline text-fg-subtle">Build </dt>
                    <dd className="inline font-mono">{approval.buildId}</dd>
                </div>
                {showJobLink && approval.jobId && (
                    <div>
                        <dt className="inline text-fg-subtle">Job </dt>
                        <dd className="inline">
                            <Link href={`/admin/sourcing/jobs/${encodeURIComponent(approval.jobId)}`} className="font-mono text-signal underline-offset-4 hover:underline">
                                {approval.jobId}
                            </Link>
                        </dd>
                    </div>
                )}
            </dl>
            {details.length > 0 && (
                <dl className="mt-2 space-y-0.5 rounded-xl bg-graphite-850 p-3 text-xs">
                    {details.map(([k, v]) => (
                        <div key={k} className="flex gap-2">
                            <dt className="shrink-0 font-mono text-fg-subtle">{k}</dt>
                            <dd className="min-w-0 text-fg-muted">
                                <DetailValue value={v} />
                            </dd>
                        </div>
                    ))}
                </dl>
            )}
            {!pending && (approval.decidedBy || approval.decisionNote) && (
                <p className="mt-2 text-xs text-fg-muted">
                    {approval.status.toLowerCase()} by <span className="font-mono">{approval.decidedBy ?? '—'}</span>
                    {approval.decidedAt && ` · ${dateTime(approval.decidedAt)}`}
                    {approval.decisionNote && ` · “${approval.decisionNote}”`}
                </p>
            )}
            {pending && (
                <div className="mt-3 space-y-2">
                    <Field label="Decision note" optional>
                        {({ id }) => <TextInput id={id} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="Why, and anything the agent should know" data-testid={`approval-note-${approval.id}`} />}
                    </Field>
                    <div className="flex flex-wrap gap-2">
                        <ConfirmAction
                            label="Approve"
                            icon={<Check className="h-4 w-4" aria-hidden />}
                            confirmLabel="Approve"
                            prompt={`Approve: ${APPROVAL_KIND_LABEL[approval.kind]}?`}
                            size="sm"
                            onConfirm={() => decide('APPROVED')}
                            testId={`approve-${approval.id}`}
                        />
                        <ConfirmAction
                            label="Reject"
                            icon={<X className="h-4 w-4" aria-hidden />}
                            confirmLabel="Reject"
                            prompt="Reject this request?"
                            variant="caution"
                            size="sm"
                            onConfirm={() => decide('REJECTED')}
                            testId={`reject-${approval.id}`}
                        />
                    </div>
                    {error && <Notice tone="error">{error}</Notice>}
                </div>
            )}
        </article>
    );
}
