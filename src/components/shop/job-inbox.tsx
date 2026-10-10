'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ChevronRight, Clock, Inbox, Layers, MessageCircle, PackageOpen, RotateCcw, Zap } from 'lucide-react';
import { primeApi } from '@/components/prime/api';
import type { JobStatus, ShopJobSummary } from '@/contracts';
import { StatusPill } from '@/components/ui/status-pill';
import { EmptyState, ErrorState } from '@/components/ui/state';
import { PageSkeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { ApiClientError, api, errorMessage } from '@/lib/api';
import { money, shortDate } from '@/lib/format';
import { JOB_STATUS_TEXT, JOB_UNIVERSAL } from '@/lib/status';
import { cn } from '@/lib/utils';
import { useCountdown } from './use-countdown';

const TABS: { key: 'offered' | 'active' | 'done'; label: string; statuses: JobStatus[] }[] = [
    { key: 'offered', label: 'Offered', statuses: ['OFFERED'] },
    { key: 'active', label: 'Active', statuses: ['ACCEPTED', 'IN_PRODUCTION', 'QA_PASSED', 'SHIPPED'] },
    { key: 'done', label: 'Done', statuses: ['DELIVERED', 'DECLINED', 'EXPIRED', 'QA_FAILED', 'CANCELLED'] },
];

const NEXT_ACTION: Record<ShopJobSummary['nextAction'], string> = {
    ACCEPT_OR_DECLINE: 'Accept or decline',
    RECORD_MILESTONE: 'Start production',
    SUBMIT_INSPECTION: 'Record progress · submit inspection',
    CREATE_SHIPMENT: 'Ready to ship',
    NONE: '',
};

function JobRow({ job, priority = false, unread = 0 }: { job: ShopJobSummary; priority?: boolean; unread?: number }) {
    const countdown = useCountdown(job.status === 'OFFERED' ? job.offerExpiresAt : null);
    return (
        <li>
            <Link href={`/shop/jobs/${job.id}`} className="flex items-center gap-3 px-4 py-4 hover:bg-graphite-850 sm:gap-4" data-testid={`job-row-${job.id}`}>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-fg">{job.orderNumber}</span>
                        <StatusPill status={JOB_UNIVERSAL[job.status]} />
                        {priority && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-signal/15 px-2 py-0.5 text-[11px] font-semibold text-signal" data-testid={`job-priority-${job.id}`}>
                                <Zap className="h-3 w-3" aria-hidden /> Prime priority
                            </span>
                        )}
                        {unread > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-graphite-700 px-2 py-0.5 text-[11px] font-semibold text-fg" data-testid={`job-unread-${job.id}`}>
                                <MessageCircle className="h-3 w-3" aria-hidden /> {unread} new
                            </span>
                        )}
                        {job.kind === 'RECEIVING' && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-graphite-750 px-2 py-0.5 text-[11px] font-semibold text-fg" data-testid={`job-kind-${job.id}`}>
                                <PackageOpen className="h-3 w-3" aria-hidden /> Receiving
                            </span>
                        )}
                        {job.batchId && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-graphite-750 px-2 py-0.5 font-mono text-[11px] text-fg-muted" title="Shares a setup with other jobs on the same material" data-testid={`job-batch-${job.id}`}>
                                <Layers className="h-3 w-3" aria-hidden /> {job.batchId.slice(0, 10)}
                            </span>
                        )}
                        {job.isRework && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber/15 px-2 py-0.5 text-[11px] font-semibold text-amber">
                                <RotateCcw className="h-3 w-3" aria-hidden /> Rework
                            </span>
                        )}
                    </div>
                    <p className="mt-1 truncate text-sm text-fg">
                        {job.quantity} × {job.partFilename}
                    </p>
                    <p className="truncate text-xs text-fg-muted">
                        {job.materialName} · {job.thicknessLabel}
                        {job.finishName ? ` · ${job.finishName}` : ''} · ship by {shortDate(job.shipBy)}
                    </p>
                    <p className="mt-1 text-xs font-medium text-signal">{job.kind === 'RECEIVING' && job.status === 'ACCEPTED' ? 'Waiting for inbound freight · mark it received' : NEXT_ACTION[job.nextAction] || JOB_STATUS_TEXT[job.status]}</p>
                </div>
                <div className="shrink-0 text-right">
                    <p className="font-mono text-sm font-semibold tabular text-fg">{money(job.payoutCents)}</p>
                    <p className="text-[11px] text-fg-subtle">payout</p>
                    {countdown && (
                        <p className={cn('mt-1 inline-flex items-center gap-1 text-[11px] font-semibold', countdown.expired ? 'text-ember' : 'text-amber')}>
                            <Clock className="h-3 w-3" aria-hidden /> {countdown.expired ? 'Expired' : `${countdown.label} left`}
                        </p>
                    )}
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden />
            </Link>
        </li>
    );
}

export function JobInbox() {
    const router = useRouter();
    const [tab, setTab] = useState<(typeof TABS)[number]['key']>('offered');
    const { data, error, isLoading, refetch, isFetching } = useQuery({ queryKey: ['shop-jobs'], queryFn: () => api.shopJobs(), refetchInterval: 10_000 });
    // R3: Prime priority + unread buyer messages per order (best effort; the list works without it).
    const flags = useQuery({ queryKey: ['shop-flags'], queryFn: () => primeApi.shopFlags(), refetchInterval: 10_000, retry: false });
    const flagOf = (orderId: string) => flags.data?.orders[orderId] ?? { priority: false, unread: 0 };
    const unauthorized = error instanceof ApiClientError && error.status === 401;
    useEffect(() => {
        if (unauthorized) router.replace('/shop');
    }, [unauthorized, router]);

    // Land on the tab with work in it.
    const [autoTabbed, setAutoTabbed] = useState(false);
    useEffect(() => {
        if (!data || autoTabbed) return;
        setAutoTabbed(true);
        if (!data.jobs.some((j) => j.status === 'OFFERED') && data.jobs.some((j) => TABS[1].statuses.includes(j.status))) setTab('active');
    }, [data, autoTabbed]);

    if (isLoading || unauthorized) return <PageSkeleton label="Loading jobs" />;
    if (error || !data) return <ErrorState title="Could not load jobs" message={errorMessage(error)} action={<Button onClick={() => refetch()}>Try again</Button>} />;

    const current = TABS.find((t) => t.key === tab)!;
    const jobs = data.jobs
        .filter((j) => current.statuses.includes(j.status))
        .sort((a, b) => Number(flagOf(b.orderId).priority) - Number(flagOf(a.orderId).priority) || b.createdAt.localeCompare(a.createdAt));

    return (
        <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
            <div className="flex items-end justify-between gap-3">
                <div>
                    <p className="eyebrow">Shop Console</p>
                    <h1 className="mt-1 font-display font-wide text-3xl font-extrabold">Jobs</h1>
                </div>
                <p className="font-mono text-[11px] text-fg-subtle" aria-live="polite">
                    {isFetching ? 'Refreshing…' : 'Auto-refreshes every 10 s'}
                </p>
            </div>
            <div className="mt-6 flex gap-1 rounded-xl bg-graphite-900 p-1 ring-1 ring-graphite-700" role="tablist" aria-label="Job status">
                {TABS.map((t) => {
                    const count = data.jobs.filter((j) => t.statuses.includes(j.status)).length;
                    const selected = t.key === tab;
                    return (
                        <button
                            key={t.key}
                            type="button"
                            role="tab"
                            aria-selected={selected}
                            aria-controls="job-list"
                            onClick={() => setTab(t.key)}
                            className={cn('flex h-10 flex-1 items-center justify-center gap-2 rounded-lg text-sm font-semibold', selected ? 'bg-graphite-700 text-fg' : 'text-fg-muted hover:text-fg')}
                            data-testid={`jobs-tab-${t.key}`}
                        >
                            {t.label}
                            <span className={cn('rounded-full px-1.5 font-mono text-[11px]', selected ? 'bg-signal text-signal-ink' : 'bg-graphite-700 text-fg-muted')}>{count}</span>
                        </button>
                    );
                })}
            </div>
            <div id="job-list" role="tabpanel" className="mt-4">
                {jobs.length === 0 ? (
                    <EmptyState icon={<Inbox className="h-8 w-8" aria-hidden />} title={tab === 'offered' ? 'No new offers' : tab === 'active' ? 'Nothing in production' : 'No finished jobs yet'}>
                        {tab === 'offered' ? 'New jobs appear here the moment an order is paid. Offers stay open for a limited time.' : 'Accepted jobs move here as you work on them.'}
                    </EmptyState>
                ) : (
                    <ul className="divide-y divide-graphite-700 overflow-hidden rounded-2xl bg-graphite-900 ring-1 ring-graphite-700">
                        {jobs.map((j) => (
                            <JobRow key={j.id} job={j} priority={flagOf(j.orderId).priority} unread={flagOf(j.orderId).unread} />
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
