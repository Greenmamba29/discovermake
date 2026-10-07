'use client';

import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, RefreshCw } from 'lucide-react';
import type { SourcingJobView, SupplierOfferView } from '@/contracts';
import { TrustChip } from '@/components/trust/trust-chip';
import { Button } from '@/components/ui/button';
import { ConfirmAction } from '@/components/ui/confirm-action';
import { EmptyState, ErrorState, Notice } from '@/components/ui/state';
import { PageSkeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import { errorMessage } from '@/lib/api';
import { dateTime, longDate, money, plural } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ACTIVE_JOB_STATUSES, sourcingApi, type SourcingJobDetail } from '../api';
import { AdminGate, isUnauthorized } from './admin-gate';
import { ApprovalCard } from './approval-card';
import { DeskOfferForm, DeskSupplierForm } from './desk-forms';
import { DeskHeader } from './desk-header';
import { JOB_PILL, NEGOTIATION_LABEL } from './labels';

/** Sourcing desk · one job: request, offers (full supplier identity), negotiations, documents, approvals, desk fallback. */
export function SourcingJobDetailScreen({ jobId }: { jobId: string }) {
    return <AdminGate>{(token, signOut) => <JobDetail token={token} jobId={jobId} onSignOut={signOut} />}</AdminGate>;
}

export function offerTotalCents(o: SupplierOfferView): number {
    return o.unitPriceCents * o.quantity + o.toolingCents + (o.shippingCents ?? 0);
}

function Section({ title, count, children, id }: { title: string; count?: number; children: ReactNode; id: string }) {
    return (
        <section aria-labelledby={id} className="space-y-3">
            <h2 id={id} className="flex items-center gap-2 font-display text-xl font-bold">
                {title}
                {count !== undefined && <span className="rounded-full bg-graphite-750 px-2 py-0.5 font-mono text-xs text-fg-muted">{count}</span>}
            </h2>
            {children}
        </section>
    );
}

function Kv({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="min-w-0">
            <dt className="text-[11px] uppercase tracking-wider text-fg-subtle">{label}</dt>
            <dd className="mt-0.5 break-words text-sm text-fg">{children}</dd>
        </div>
    );
}

function JobDetail({ token, jobId, onSignOut }: { token: string; jobId: string; onSignOut: () => void }) {
    const qc = useQueryClient();
    const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
    const [extraSuppliers, setExtraSuppliers] = useState<{ id: string; name: string }[]>([]);
    const q = useQuery({
        queryKey: ['sourcing-job', jobId, token],
        queryFn: () => sourcingApi.adminJob(token, jobId),
        refetchInterval: (query) => (query.state.data && ACTIVE_JOB_STATUSES.includes(query.state.data.job.status) ? 10_000 : 30_000),
    });
    const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['sourcing-job', jobId] }), qc.invalidateQueries({ queryKey: ['sourcing-jobs'] })]);

    if (q.isLoading) return <PageSkeleton label="Loading sourcing job" />;
    if (isUnauthorized(q.error)) return <ErrorState title="Admin token rejected" message="Sign in again with a valid token." action={<Button onClick={onSignOut}>Sign in again</Button>} />;
    if (q.error || !q.data) return <ErrorState title="Sourcing job not found" message={errorMessage(q.error)} />;

    const d: SourcingJobDetail = { ...q.data, negotiations: q.data.negotiations ?? [], documents: q.data.documents ?? [], approvals: q.data.approvals ?? [], offers: q.data.offers ?? [] };
    const job = d.job;
    const active = ACTIVE_JOB_STATUSES.includes(job.status);
    const supplierNames = new Map<string, string>();
    for (const o of d.offers) supplierNames.set(o.supplier.id, o.supplier.name);
    for (const s of extraSuppliers) supplierNames.set(s.id, s.name);
    for (const n of d.negotiations) if (n.supplierId && n.supplierName) supplierNames.set(n.supplierId, n.supplierName);
    const knownSuppliers = [...supplierNames].map(([id, name]) => ({ id, name }));
    const approvals = [...d.approvals].sort((a, b) => Number(b.status === 'PENDING') - Number(a.status === 'PENDING') || b.createdAt.localeCompare(a.createdAt));

    const act = async (fn: () => Promise<unknown>, ok: string) => {
        setNotice(null);
        try {
            await fn();
            setNotice({ tone: 'success', text: ok });
            await refresh();
        } catch (err) {
            setNotice({ tone: 'error', text: errorMessage(err) });
        }
    };

    return (
        <div className="mx-auto w-full max-w-6xl space-y-8 px-4 py-8 sm:px-6">
            <div className="space-y-3">
                <DeskHeader
                    title={<span className="font-mono">{job.displayId}</span>}
                    back={{ href: '/admin/sourcing', label: 'Sourcing desk' }}
                    onSignOut={onSignOut}
                    actions={
                        <Button variant="ghost" size="sm" onClick={() => q.refetch()} aria-label="Refresh job">
                            <RefreshCw className={cn('h-4 w-4', q.isFetching && 'animate-spin')} aria-hidden />
                        </Button>
                    }
                />
                <div className="flex flex-wrap items-center gap-2" aria-live="polite">
                    <StatusPill status={JOB_PILL[job.status]} />
                    <span className="font-mono text-xs text-fg-subtle" data-testid="job-status">
                        {job.status}
                    </span>
                    <span className="rounded-md bg-graphite-750 px-2 py-0.5 text-[11px] text-fg-muted">channel: {job.channel}</span>
                    {job.leaseExpiresAt && <span className="text-xs text-fg-muted">lease expires {dateTime(job.leaseExpiresAt)}</span>}
                </div>
                <div className="flex flex-wrap gap-2">
                    {active && (
                        <ConfirmAction label="Cancel job" confirmLabel="Cancel job" prompt="Cancel this sourcing job? The agent loses its lease and no new offers are accepted." variant="caution" size="sm" onConfirm={() => act(() => sourcingApi.adminCancelJob(token, job.id), `${job.displayId} cancelled.`)} testId="job-cancel" />
                    )}
                    {job.status !== 'QUEUED' && (
                        <ConfirmAction label="Requeue" confirmLabel="Requeue" prompt="Put this job back in the queue for the next agent run?" variant="secondary" size="sm" onConfirm={() => act(() => sourcingApi.adminRequeueJob(token, job.id), `${job.displayId} requeued.`)} testId="job-requeue" />
                    )}
                </div>
                {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
            </div>

            <RequestCard job={job} />

            <Section title="Offers" count={d.offers.length} id="offers-heading">
                {d.offers.length === 0 ? <EmptyState title="No offers yet">Offers arrive through the agent&apos;s submit_offer or the desk form below.</EmptyState> : <OffersTable offers={d.offers} />}
            </Section>

            <Section title="Approvals" count={approvals.length} id="approvals-heading">
                {approvals.length === 0 ? (
                    <p className="text-sm text-fg-muted">No approvals requested on this job.</p>
                ) : (
                    <ul className="space-y-3">
                        {approvals.map((a) => (
                            <li key={a.id}>
                                <ApprovalCard token={token} approval={a} />
                            </li>
                        ))}
                    </ul>
                )}
            </Section>

            <div className="grid gap-8 lg:grid-cols-2">
                <Section title="Negotiations" count={d.negotiations.length} id="negotiations-heading">
                    {d.negotiations.length === 0 ? (
                        <p className="text-sm text-fg-muted">No supplier conversations recorded.</p>
                    ) : (
                        <ul className="space-y-3">
                            {d.negotiations.map((n) => (
                                <li key={n.id} className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700">
                                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                                        {n.supplierName ?? (n.supplierId ? supplierNames.get(n.supplierId) : null) ?? n.supplierId ?? 'Supplier'}
                                        <span className="rounded-md bg-graphite-750 px-2 py-0.5 text-[11px] font-medium text-fg-muted">{NEGOTIATION_LABEL[n.status as keyof typeof NEGOTIATION_LABEL] ?? n.status}</span>
                                    </p>
                                    {n.notes && n.notes.length > 0 && (
                                        <ol className="mt-2 space-y-1 text-xs">
                                            {n.notes.map((note, i) => (
                                                <li key={i} className="text-fg-muted">
                                                    <span className="font-mono text-fg-subtle">{dateTime(note.at)}</span> · {note.status} · <span className="text-fg">{note.note}</span>
                                                </li>
                                            ))}
                                        </ol>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </Section>
                <Section title="Documents" count={d.documents.length} id="documents-heading">
                    {d.documents.length === 0 ? (
                        <p className="text-sm text-fg-muted">No documents attached.</p>
                    ) : (
                        <ul className="divide-y divide-graphite-700 rounded-2xl bg-graphite-900 ring-1 ring-graphite-700">
                            {d.documents.map((doc) => (
                                <li key={doc.id} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
                                    <span className="rounded-md bg-graphite-750 px-2 py-0.5 font-mono text-[11px] text-fg-muted">{doc.kind}</span>
                                    {doc.url ? (
                                        <a href={doc.url} target="_blank" rel="noreferrer noopener" className="min-w-0 break-all text-signal underline-offset-4 hover:underline">
                                            {doc.filename}
                                        </a>
                                    ) : (
                                        <span className="min-w-0 break-all">{doc.filename}</span>
                                    )}
                                    <span className="text-xs text-fg-subtle">
                                        {doc.supplierId ? `${supplierNames.get(doc.supplierId) ?? doc.supplierId} · ` : ''}
                                        {doc.sizeBytes ? `${Math.max(1, Math.round(doc.sizeBytes / 1024))} KB · ` : ''}
                                        {dateTime(doc.createdAt ?? null)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </Section>
            </div>

            <Section title="Desk fallback" id="desk-heading">
                <p className="text-sm text-fg-muted">Work the job by hand when the agent cannot: add the supplier first, then its normalized offer.</p>
                <details className="group rounded-2xl bg-graphite-900 ring-1 ring-graphite-700" data-testid="desk-supplier-details">
                    <summary className="cursor-pointer list-none rounded-2xl px-4 py-3 font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-signal">Add a supplier</summary>
                    <div className="border-t border-graphite-700 p-4">
                        <DeskSupplierForm token={token} job={job} onCreated={(s) => setExtraSuppliers((x) => [...x, s])} />
                    </div>
                </details>
                <details className="group rounded-2xl bg-graphite-900 ring-1 ring-graphite-700" data-testid="desk-offer-details">
                    <summary className="cursor-pointer list-none rounded-2xl px-4 py-3 font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-signal">Add an offer</summary>
                    <div className="border-t border-graphite-700 p-4">
                        <DeskOfferForm token={token} job={job} suppliers={knownSuppliers} onCreated={() => void refresh()} />
                    </div>
                </details>
            </Section>
        </div>
    );
}

function RequestCard({ job }: { job: SourcingJobView }) {
    const r = job.request;
    const p = r.approval_policy;
    return (
        <Section title="Request" id="request-heading">
            <div className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700">
                <p className="font-semibold">{r.name}</p>
                <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <Kv label="Build">
                        <span className="font-mono">{job.buildDisplayId}</span> · v{job.designVersion}
                    </Kv>
                    <Kv label="Quantity">
                        <span className="font-mono tabular">{r.quantity.toLocaleString('en-US')}</span>
                    </Kv>
                    <Kv label="Target unit cost">{r.target_unit_cost_cents != null ? money(r.target_unit_cost_cents) : '—'}</Kv>
                    <Kv label="Needed by">{longDate(r.target_delivery_date)}</Kv>
                    <Kv label="Material">{r.material}</Kv>
                    <Kv label="Process">{r.process.join(', ')}</Kv>
                    <Kv label="Dimensions">{r.dimensions_mm ? `${r.dimensions_mm.x} × ${r.dimensions_mm.y} × ${r.dimensions_mm.z} mm` : '—'}</Kv>
                    <Kv label="Surface finish">{r.surface_finish ?? '—'}</Kv>
                    <Kv label="Regions">{r.target_regions.length ? r.target_regions.join(', ') : 'Anywhere'}</Kv>
                    <Kv label="Certifications">{r.required_certifications.length ? r.required_certifications.join(', ') : '—'}</Kv>
                    <Kv label="Attachments">{r.attachments.length ? r.attachments.join(', ') : '—'}</Kv>
                    <Kv label="Created">{dateTime(job.createdAt)}</Kv>
                </dl>
                {r.critical_tolerances.length > 0 && (
                    <div className="mt-4">
                        <p className="eyebrow mb-1">Critical tolerances</p>
                        <ul className="space-y-0.5 font-mono text-xs text-fg-muted">
                            {r.critical_tolerances.map((t) => (
                                <li key={t.feature}>
                                    {t.feature}: {t.nominal_mm} mm +{t.plus_mm}/−{t.minus_mm}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                {r.acceptable_substitutions.length > 0 && <p className="mt-3 text-xs text-fg-muted">Acceptable substitutions: {r.acceptable_substitutions.join('; ')}</p>}
                {r.notes && <p className="mt-3 whitespace-pre-line text-sm text-fg-muted">{r.notes}</p>}
                <div className="mt-4 rounded-xl bg-graphite-850 p-3 text-xs text-fg-muted">
                    <p className="eyebrow mb-1">Approval policy</p>
                    Supplier contact {p.allow_supplier_contact ? 'allowed' : 'blocked'} · negotiation {p.allow_negotiation ? 'allowed' : 'blocked'} · samples {p.allow_sample_request ? 'allowed' : 'need approval'} · purchase and full package always need approval
                    {p.max_unit_price_cents != null && ` · max unit ${money(p.max_unit_price_cents)}`}
                    {p.max_total_lead_days != null && ` · max ${plural(p.max_total_lead_days, 'day')}`}
                </div>
                {job.summary && (
                    <div className="mt-4">
                        <p className="eyebrow mb-1">Agent summary</p>
                        <p className="whitespace-pre-line text-sm text-fg-muted">{job.summary}</p>
                    </div>
                )}
            </div>
        </Section>
    );
}

function OffersTable({ offers }: { offers: SupplierOfferView[] }) {
    return (
        <div className="overflow-x-auto rounded-2xl ring-1 ring-graphite-700">
            <table className="w-full min-w-[56rem] text-sm" data-testid="desk-offers-table">
                <caption className="sr-only">Supplier offers for this job, with supplier identity</caption>
                <thead className="bg-graphite-850 text-left text-[11px] uppercase tracking-wider text-fg-subtle">
                    <tr>
                        <th scope="col" className="px-3 py-2 font-medium">Supplier</th>
                        <th scope="col" className="px-3 py-2 font-medium">Trust</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Unit × qty</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Tooling</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Freight</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Total</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Lead</th>
                        <th scope="col" className="px-3 py-2 font-medium">Terms</th>
                        <th scope="col" className="px-3 py-2 font-medium">Status</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-graphite-700 bg-graphite-900">
                    {offers.map((o) => (
                        <tr key={o.id} className="align-top" data-testid={`desk-offer-${o.id}`}>
                            <td className="px-3 py-2">
                                <p className="flex items-center gap-1 font-semibold">
                                    {o.supplier.name}
                                    {o.supplier.verified && <BadgeCheck className="h-3.5 w-3.5 text-signal" aria-label="Verified" />}
                                </p>
                                <p className="text-xs text-fg-muted">
                                    {o.supplier.platform} · {o.supplier.country}
                                </p>
                                <p className="font-mono text-[11px] text-fg-subtle">{o.supplier.id}</p>
                            </td>
                            <td className="px-3 py-2">
                                <TrustChip level={o.trustLevel} testId={`desk-offer-trust-${o.id}`} />
                                <p className="mt-1 text-[11px] text-fg-subtle">{Math.round(o.confidence * 100)}% confidence</p>
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular">
                                {money(o.unitPriceCents)} × {o.quantity.toLocaleString('en-US')}
                                <p className="text-[11px] text-fg-subtle">MOQ {o.moq.toLocaleString('en-US')}</p>
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular">{money(o.toolingCents)}</td>
                            <td className="px-3 py-2 text-right font-mono tabular">{o.shippingCents != null ? money(o.shippingCents) : '—'}</td>
                            <td className="px-3 py-2 text-right font-mono font-semibold tabular">{money(offerTotalCents(o))}</td>
                            <td className="px-3 py-2 text-right font-mono tabular">
                                {o.productionLeadDays}+{o.shippingLeadDays} d
                            </td>
                            <td className="px-3 py-2 text-xs text-fg-muted">
                                {o.incoterm} · {o.material}
                                <br />
                                {o.processes.join(', ')}
                                {o.certificationsClaimed.length > 0 && (
                                    <>
                                        <br />
                                        {o.certificationsClaimed.join(', ')}
                                    </>
                                )}
                                {o.exceptions.length > 0 && (
                                    <ul className="mt-1 list-disc pl-4 text-amber">
                                        {o.exceptions.map((x) => (
                                            <li key={x}>{x}</li>
                                        ))}
                                    </ul>
                                )}
                            </td>
                            <td className="px-3 py-2 text-xs">
                                <span className="font-mono text-fg">{o.status}</span>
                                <p className="text-fg-muted">{NEGOTIATION_LABEL[o.negotiationStatus]}</p>
                                <p className="text-fg-subtle">v{o.designVersion}</p>
                                {o.validUntil && <p className="text-fg-subtle">until {longDate(o.validUntil)}</p>}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
