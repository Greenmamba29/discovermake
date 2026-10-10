'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Circle, Clock, Download, ExternalLink, FileText, RotateCcw, XCircle } from 'lucide-react';
import { DECLINE_REASONS, MILESTONE_KINDS, type DeclineReason, type MilestoneKind, type ShopJobDetail } from '@/contracts';
import { Button, ButtonLink } from '@/components/ui/button';
import { ConfirmAction } from '@/components/ui/confirm-action';
import { Field, SelectInput, TextArea } from '@/components/ui/field';
import { StatusPill } from '@/components/ui/status-pill';
import { ErrorState, Notice } from '@/components/ui/state';
import { PageSkeleton } from '@/components/ui/skeleton';
import { FlatPattern } from '@/components/part/part-preview';
import { ShipmentCard } from '@/components/orders/shipment-card';
import { ApiClientError, api, errorMessage } from '@/lib/api';
import { dateTime, humanize, money, shortDate } from '@/lib/format';
import { JOB_STATUS_TEXT, JOB_UNIVERSAL, MILESTONE_LABELS } from '@/lib/status';
import { cn } from '@/lib/utils';
import { QaForm } from './qa-form';
import { OrderChat } from '@/components/prime/order-chat';
import { primeApi as experienceApi } from '@/components/prime/api';
import { primeApi } from '@/lib/prime-api';
import { ShipForm } from './ship-form';
import { useCountdown } from './use-countdown';

const DECLINE_COPY: Record<DeclineReason, string> = {
    CAPACITY: 'No capacity before the ship date',
    MATERIAL_UNAVAILABLE: 'Material not in stock',
    CAPABILITY: 'Outside our capabilities',
    DFM_CONCERN: 'Manufacturability concern',
    OTHER: 'Other reason',
};

function PacketRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="grid grid-cols-[120px_1fr] gap-3 border-t border-graphite-700 py-2 text-sm first:border-t-0">
            <dt className="text-fg-subtle">{label}</dt>
            <dd className="min-w-0 break-words text-fg">{children}</dd>
        </div>
    );
}

export function JobDetail({ jobId }: { jobId: string }) {
    const router = useRouter();
    const qc = useQueryClient();
    const { data: job, error, isLoading, refetch } = useQuery({ queryKey: ['shop-job', jobId], queryFn: () => api.shopJob(jobId), refetchInterval: 15_000 });
    const [actionError, setActionError] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [declining, setDeclining] = useState(false);
    const [declineReason, setDeclineReason] = useState<DeclineReason>('CAPACITY');
    const [declineNote, setDeclineNote] = useState('');
    const countdown = useCountdown(job?.status === 'OFFERED' ? job.offerExpiresAt : null);

    const unauthorized = error instanceof ApiClientError && error.status === 401;
    useEffect(() => {
        if (unauthorized) router.replace('/shop');
    }, [unauthorized, router]);

    if (isLoading || unauthorized) return <PageSkeleton label="Loading job" />;
    if (error || !job) {
        const notFound = error instanceof ApiClientError && error.status === 404;
        return <ErrorState title={notFound ? 'Job not found' : 'Could not load this job'} message={notFound ? 'This job is not assigned to your shop.' : errorMessage(error)} action={<ButtonLink href="/shop/jobs">Back to jobs</ButtonLink>} />;
    }

    const setJob = (j: ShopJobDetail) => {
        qc.setQueryData(['shop-job', jobId], j);
        void qc.invalidateQueries({ queryKey: ['shop-jobs'] });
    };
    const reload = async () => {
        await refetch();
        void qc.invalidateQueries({ queryKey: ['shop-jobs'] });
    };
    const run = async (key: string, fn: () => Promise<void>) => {
        setBusy(key);
        setActionError(null);
        try {
            await fn();
        } catch (err) {
            setActionError(errorMessage(err));
            if (err instanceof ApiClientError && err.status === 409) void reload();
        } finally {
            setBusy(null);
        }
    };

    const p = job.packet;
    const recorded = new Map<MilestoneKind, string>();
    for (const m of job.milestones) if (!recorded.has(m.kind)) recorded.set(m.kind, m.occurredAt);
    const receiving = p.receiving ?? null;
    const awaitingFreight = Boolean(receiving) && job.status === 'ACCEPTED' && !job.isRework;
    const canMilestone = !awaitingFreight && (job.status === 'ACCEPTED' || job.status === 'IN_PRODUCTION' || job.status === 'QA_PASSED');
    const lastResult = [...job.inspectionResults].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
    const reworkJobId = lastResult?.outcome === 'FAIL' ? lastResult.reworkJobId : null;

    return (
        <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6">
            <Link href="/shop/jobs" className="inline-flex items-center gap-1 rounded text-sm text-fg-muted hover:text-fg">
                <ArrowLeft className="h-4 w-4" aria-hidden /> All jobs
            </Link>

            <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <p className="eyebrow">
                        {job.buildDisplayId} · job {job.id.slice(0, 12)}…
                    </p>
                    <h1 className="mt-1 font-display font-wide text-3xl font-extrabold">{job.orderNumber}</h1>
                    <p className="mt-1 text-fg-muted" data-testid="job-status-text">
                        {awaitingFreight ? 'Receiving · waiting for inbound freight' : JOB_STATUS_TEXT[job.status]}
                        {job.isRework && ' · rework'}
                    </p>
                    {job.batchId && (
                        <p className="mt-1 inline-flex items-center gap-1 rounded-md bg-graphite-750 px-2 py-0.5 font-mono text-[11px] text-fg-muted" data-testid="job-batch">
                            Batch {job.batchId} · shares a setup with other jobs on this material
                        </p>
                    )}
                </div>
                <div className="flex flex-col items-end gap-2">
                    <StatusPill status={JOB_UNIVERSAL[job.status]} />
                    <p className="font-mono text-xl font-bold tabular">{money(job.payoutCents)}</p>
                    <p className="text-xs text-fg-subtle">payout · ship by {shortDate(job.shipBy)}</p>
                </div>
            </div>

            {actionError && (
                <Notice tone="error" className="mt-4" title="That did not go through" testId="job-action-error">
                    {actionError}
                </Notice>
            )}

            <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
                {/* Job packet */}
                <div className="space-y-4">
                    <div className="h-64 rounded-2xl bg-graphite-900 p-5 ring-1 ring-graphite-700">{job.preview ? <FlatPattern preview={job.preview} /> : <p className="text-sm text-fg-subtle">No preview available.</p>}</div>
                    <section aria-labelledby="packet-heading" className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700 sm:p-5">
                        <h2 id="packet-heading" className="font-display text-lg font-bold">
                            Job packet
                        </h2>
                        <dl className="mt-3">
                            <PacketRow label="Part">{p.part.filename}</PacketRow>
                            <PacketRow label="Size">
                                <span className="font-mono">
                                    {p.part.bboxWidthMm.toFixed(1)} × {p.part.bboxHeightMm.toFixed(1)} mm
                                </span>
                            </PacketRow>
                            {p.print ? (
                                <PacketRow label="3D print">
                                    <span className="font-mono text-xs" data-testid="packet-print">
                                        {p.print.process} · {p.print.layerHeightMm} mm layers · {p.print.bboxMm.map((v) => v.toFixed(1)).join(' × ')} mm · {(p.print.volumeMm3 / 1000).toFixed(1)} cm³ · min wall {p.print.minWallMm} mm · {p.print.printHoursPerPart.toFixed(2)} h/part
                                    </span>
                                    <span className="mt-1 block text-xs text-fg-subtle">{p.print.orientation} STL sha256 {p.print.stlSha256.slice(0, 12)}…</span>
                                </PacketRow>
                            ) : (
                                <PacketRow label="Geometry">
                                    <span className="font-mono text-xs">
                                        cut {(p.part.cutLengthMm / 1000).toFixed(2)} m · {p.part.pierceCount} pierces · {p.part.holeCount} holes · {p.part.bendCount} bends
                                    </span>
                                </PacketRow>
                            )}
                            <PacketRow label="Material">
                                {p.material.name} · {p.material.thicknessLabel} <span className="font-mono text-xs text-fg-subtle">({p.material.thicknessMm.toFixed(2)} mm)</span>
                            </PacketRow>
                            <PacketRow label="Process">{p.process.name}</PacketRow>
                            <PacketRow label="Finish">{p.finish ? `${p.finish.name}${p.finish.colorName ? ` · ${p.finish.colorName}` : ''}` : 'As cut'}</PacketRow>
                            {p.services.length > 0 && (
                                <PacketRow label="Operations">
                                    <ul className="space-y-0.5">
                                        {p.services.map((s) => (
                                            <li key={s.id}>
                                                {s.name}
                                                {s.featureCount != null && ` × ${s.featureCount}/part`}
                                                {Object.entries(s.options).map(([k, v]) => ` · ${k} ${v}`)}
                                            </li>
                                        ))}
                                    </ul>
                                </PacketRow>
                            )}
                            <PacketRow label="Quantity">
                                <span className="font-mono font-semibold">{p.quantity}</span>
                            </PacketRow>
                            {p.qaNotes.length > 0 && (
                                <PacketRow label="QA notes">
                                    <ul className="list-disc pl-4">
                                        {p.qaNotes.map((n) => (
                                            <li key={n}>{n}</li>
                                        ))}
                                    </ul>
                                </PacketRow>
                            )}
                            <PacketRow label="Packing">{p.packing.instructions}</PacketRow>
                            {p.buyerNotes && <PacketRow label="Buyer note">{p.buyerNotes}</PacketRow>}
                            <PacketRow label="Ship to">
                                {p.shipTo ? (
                                    <address className="not-italic">
                                        {p.shipTo.name}
                                        {p.shipTo.company && `, ${p.shipTo.company}`}
                                        <br />
                                        {p.shipTo.line1}
                                        {p.shipTo.line2 && `, ${p.shipTo.line2}`}
                                        <br />
                                        {p.shipTo.city}, {p.shipTo.region} {p.shipTo.postalCode}
                                    </address>
                                ) : (
                                    <span className="text-fg-subtle">Shown after you accept</span>
                                )}
                            </PacketRow>
                        </dl>
                        <div className="mt-4 border-t border-graphite-700 pt-3">
                            <p className="eyebrow mb-2">Files</p>
                            {p.files.length ? (
                                <ul className="space-y-2">
                                    {p.files.map((f) => (
                                        <li key={f.url}>
                                            <a href={f.url} className="inline-flex items-center gap-2 rounded-lg bg-graphite-750 px-3 py-2 text-sm font-semibold text-fg hover:bg-graphite-700" data-testid="packet-file">
                                                <Download className="h-4 w-4" aria-hidden /> {f.filename}
                                            </a>
                                            <span className="ml-2 text-[11px] text-fg-subtle">link expires {dateTime(f.expiresAt)}</span>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="flex items-center gap-2 text-sm text-fg-subtle">
                                    <FileText className="h-4 w-4" aria-hidden /> Production files unlock after you accept.
                                </p>
                            )}
                        </div>
                        <p className="mt-3 break-all font-mono text-[10px] text-fg-subtle">signed packet v{p.packetVersion} · {p.signature.slice(0, 24)}…</p>
                    </section>
                </div>

                {/* Actions */}
                <div className="space-y-4">
                    {receiving && (
                        <section aria-labelledby="receiving-heading" className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-signal/40 sm:p-5" data-testid="receiving-panel">
                            <h2 id="receiving-heading" className="font-display text-lg font-bold">
                                Receiving · QA at receipt
                            </h2>
                            <dl className="mt-3">
                                <PacketRow label="PO">{receiving.poNumber}</PacketRow>
                                <PacketRow label="From">{receiving.origin}</PacketRow>
                                <PacketRow label="Inbound">{receiving.inboundCarrier ? `${receiving.inboundCarrier} · ${receiving.inboundTracking ?? ''}` : 'Tracking not shared yet'}</PacketRow>
                            </dl>
                            <p className="mt-2 text-sm text-fg-muted">{receiving.instructions}</p>
                            {awaitingFreight && (
                                <div className="mt-4">
                                    <ConfirmAction
                                        label="Mark freight received"
                                        confirmLabel="Yes, it arrived"
                                        prompt={`Received ${p.quantity} parts for ${receiving.poNumber}? Inspection opens next.`}
                                        onConfirm={() => run('receive', async () => setJob(await primeApi.receiveFreight(job.id)))}
                                        loading={busy === 'receive'}
                                        testId="receive-freight"
                                    />
                                </div>
                            )}
                        </section>
                    )}
                    {job.status === 'OFFERED' && (
                        <section aria-labelledby="offer-heading" className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-signal/40 sm:p-5" data-testid="offer-panel">
                            <h2 id="offer-heading" className="font-display text-lg font-bold">
                                New job offer
                            </h2>
                            <p className="mt-1 text-sm text-fg-muted">
                                {p.quantity} × {p.material.name} {p.material.thicknessLabel}, ships by {shortDate(job.shipBy)}. Your payout of {money(job.payoutCents)} is recorded when the order is delivered.
                            </p>
                            {countdown && (
                                <p className={cn('mt-2 inline-flex items-center gap-1.5 text-sm font-semibold', countdown.expired ? 'text-ember' : 'text-amber')}>
                                    <Clock className="h-4 w-4" aria-hidden /> {countdown.expired ? 'This offer has expired' : `Offer expires in ${countdown.label}`}
                                </p>
                            )}
                            {!declining ? (
                                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                                    <ConfirmAction
                                        label="Accept job"
                                        confirmLabel="Yes, accept"
                                        prompt={`Commit to ship ${p.quantity} parts by ${shortDate(job.shipBy)}?`}
                                        onConfirm={() => run('accept', async () => setJob(await api.acceptJob(job.id)))}
                                        loading={busy === 'accept'}
                                        disabled={countdown?.expired}
                                        testId="job-accept"
                                        className="sm:flex-1"
                                    />
                                    <Button variant="secondary" onClick={() => setDeclining(true)} data-testid="job-decline">
                                        Decline
                                    </Button>
                                </div>
                            ) : (
                                <div className="mt-4 space-y-3 rounded-xl bg-graphite-850 p-3 ring-1 ring-graphite-700">
                                    <Field label="Reason">
                                        {({ id }) => (
                                            <SelectInput id={id} value={declineReason} onChange={(e) => setDeclineReason(e.target.value as DeclineReason)} data-testid="decline-reason">
                                                {DECLINE_REASONS.map((r) => (
                                                    <option key={r} value={r}>
                                                        {DECLINE_COPY[r]}
                                                    </option>
                                                ))}
                                            </SelectInput>
                                        )}
                                    </Field>
                                    <Field label="Note for DiscoverMake" optional>
                                        {({ id }) => <TextArea id={id} className="min-h-[64px]" maxLength={500} value={declineNote} onChange={(e) => setDeclineNote(e.target.value)} />}
                                    </Field>
                                    <p className="text-xs text-fg-subtle">Declining passes the job to another partner shop. It does not affect jobs you already accepted.</p>
                                    <div className="flex gap-2">
                                        <Button variant="ghost" onClick={() => setDeclining(false)} disabled={busy === 'decline'}>
                                            Keep offer
                                        </Button>
                                        <Button
                                            variant="caution"
                                            loading={busy === 'decline'}
                                            data-testid="job-decline-confirm"
                                            onClick={() =>
                                                run('decline', async () => {
                                                    setJob(await api.declineJob(job.id, { reason: declineReason, note: declineNote.trim() || undefined }));
                                                    setDeclining(false);
                                                })
                                            }
                                        >
                                            Confirm decline
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </section>
                    )}

                    {(canMilestone || job.milestones.length > 0) && (
                        <section aria-labelledby="ms-heading" className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700 sm:p-5">
                            <h2 id="ms-heading" className="font-display text-lg font-bold">
                                Production milestones
                            </h2>
                            <p className="mt-1 text-sm text-fg-muted">Each tap updates the buyer’s tracker within seconds. The first milestone starts production.</p>
                            <ol className="mt-4 space-y-2">
                                {MILESTONE_KINDS.map((k) => {
                                    const at = recorded.get(k);
                                    const label = MILESTONE_LABELS[k].label;
                                    return (
                                        <li key={k} className="flex flex-wrap items-center gap-3 rounded-xl px-1 py-1">
                                            {at ? <CheckCircle2 className="h-5 w-5 shrink-0 text-signal" aria-hidden /> : <Circle className="h-5 w-5 shrink-0 text-graphite-500" aria-hidden />}
                                            <span className={cn('min-w-[120px] flex-1 text-sm', at ? 'text-fg' : 'text-fg-muted')}>{label}</span>
                                            {at ? (
                                                <span className="font-mono text-[11px] text-fg-subtle">{dateTime(at)}</span>
                                            ) : canMilestone ? (
                                                <ConfirmAction
                                                    label={`Record ${label.toLowerCase()}`}
                                                    confirmLabel="Record now"
                                                    prompt={`${MILESTONE_LABELS[k].doing}?`}
                                                    variant="secondary"
                                                    size="sm"
                                                    loading={busy === `ms-${k}`}
                                                    disabled={busy !== null && busy !== `ms-${k}`}
                                                    onConfirm={() =>
                                                        run(`ms-${k}`, async () => {
                                                            await api.recordMilestone(job.id, { kind: k });
                                                            await reload();
                                                        })
                                                    }
                                                    testId={`milestone-${k}`}
                                                />
                                            ) : null}
                                        </li>
                                    );
                                })}
                            </ol>
                        </section>
                    )}

                    {job.status === 'IN_PRODUCTION' && job.inspectionPlan && (
                        <QaForm
                            jobId={job.id}
                            plan={job.inspectionPlan}
                            onSubmitted={() => {
                                void reload();
                            }}
                        />
                    )}
                    {job.status === 'ACCEPTED' && !awaitingFreight && <Notice tone="info">Record the first milestone to start production. Inspection opens once production has started.</Notice>}

                    {job.inspectionResults.length > 0 && (
                        <section aria-labelledby="results-heading" className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700 sm:p-5">
                            <h2 id="results-heading" className="font-display text-lg font-bold">
                                Inspection results
                            </h2>
                            <ul className="mt-3 space-y-2">
                                {[...job.inspectionResults]
                                    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                                    .map((r) => (
                                        <li key={r.id} className={cn('flex items-center gap-3 rounded-xl p-3 ring-1 ring-inset', r.outcome === 'PASS' ? 'bg-signal/10 ring-signal/30' : 'bg-ember/10 ring-ember/35')} data-testid="inspection-result">
                                            {r.outcome === 'PASS' ? <CheckCircle2 className="h-5 w-5 text-signal" aria-hidden /> : <XCircle className="h-5 w-5 text-ember" aria-hidden />}
                                            <div className="text-sm">
                                                <p className="font-semibold">{r.outcome === 'PASS' ? 'Passed' : 'Failed'} · {r.inspectorName}</p>
                                                <p className="font-mono text-[11px] text-fg-subtle">
                                                    {dateTime(r.createdAt)} · {r.measurements.length} checks · {r.photoCount} photos
                                                </p>
                                            </div>
                                        </li>
                                    ))}
                            </ul>
                            {reworkJobId && (
                                <Notice tone="warning" className="mt-3" title="A rework job was opened" action={<ButtonLink href={`/shop/jobs/${reworkJobId}`} size="sm" variant="secondary"><RotateCcw className="h-4 w-4" aria-hidden /> Open rework job</ButtonLink>}>
                                    Remake the parts that failed, then inspect again on the rework job.
                                </Notice>
                            )}
                        </section>
                    )}

                    {job.status === 'QA_PASSED' && !job.shipment && <ShipForm jobId={job.id} packet={p} onShipped={() => void reload()} />}

                    {job.shipment && (
                        <div className="space-y-2">
                            <ShipmentCard shipment={job.shipment} />
                            {job.shipment.labelUrl && (
                                <a href={job.shipment.labelUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg px-1 text-sm font-semibold text-signal hover:underline">
                                    Print shipping label <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                                    <span className="sr-only">(opens in a new tab)</span>
                                </a>
                            )}
                        </div>
                    )}

                    {(job.status === 'DECLINED' || job.status === 'EXPIRED' || job.status === 'CANCELLED') && (
                        <Notice tone="info" title={humanize(job.status)}>
                            {job.declineReason ? `Declined: ${DECLINE_COPY[job.declineReason].toLowerCase()}.` : 'This job is closed. No action is needed.'}
                        </Notice>
                    )}
                    {job.status === 'DELIVERED' && (
                        <Notice tone="success" title="Delivered">
                            The buyer received the parts. Your payout of {money(job.payoutCents)} is recorded.
                        </Notice>
                    )}
                    {['ACCEPTED', 'IN_PRODUCTION', 'QA_PASSED', 'QA_FAILED', 'SHIPPED', 'DELIVERED'].includes(job.status) && (
                        <OrderChat
                            title="Buyer messages"
                            intro="The buyer sees your replies on their order page. Ops can see this thread too."
                            adapter={{
                                key: ['shop-chat', job.id],
                                load: () => experienceApi.shopChat(job.id),
                                post: (body) => experienceApi.shopPostChat(job.id, body),
                                upload: (file) => experienceApi.shopChatUpload(job.id, file),
                            }}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
