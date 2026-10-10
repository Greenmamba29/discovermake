'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { EmptyState, Notice } from '@/components/ui/state';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import { errorMessage } from '@/lib/api';
import { dateTime, plural } from '@/lib/format';
import { cn } from '@/lib/utils';
import { sourcingApi } from '../api';
import { JOB_FILTERS, JOB_PILL } from './labels';

/** Sourcing job queue with status filters (GET /api/admin/sourcing/jobs?status=). */
export function JobQueue({ token }: { token: string }) {
    const [filter, setFilter] = useState(0);
    const status = JOB_FILTERS[filter].status;
    const list = useQuery({ queryKey: ['sourcing-jobs', token, status ?? 'ALL'], queryFn: () => sourcingApi.adminJobs(token, status), refetchInterval: 10_000 });
    return (
        <div>
            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                <div className="flex w-max gap-1 rounded-xl bg-graphite-900 p-1 ring-1 ring-graphite-700 sm:w-full" role="group" aria-label="Job status filter">
                    {JOB_FILTERS.map((f, i) => (
                        <button
                            key={f.label}
                            type="button"
                            aria-pressed={i === filter}
                            onClick={() => setFilter(i)}
                            className={cn('h-9 shrink-0 rounded-lg px-3 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-signal sm:flex-1', i === filter ? 'bg-graphite-700 text-fg' : 'text-fg-muted hover:text-fg')}
                            data-testid={`sourcing-filter-${f.status ?? 'ALL'}`}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>
            </div>
            <div className="mt-4" aria-live="polite" aria-busy={list.isFetching}>
                {list.isLoading ? (
                    <div className="space-y-2">
                        <Skeleton className="h-16" />
                        <Skeleton className="h-16" />
                    </div>
                ) : list.error ? (
                    <Notice tone="error">{errorMessage(list.error)}</Notice>
                ) : !list.data || list.data.length === 0 ? (
                    <EmptyState title="No sourcing jobs here">Jobs appear when a buyer asks for partner quotes or ops create one.</EmptyState>
                ) : (
                    <ul className="divide-y divide-graphite-700 overflow-hidden rounded-2xl bg-graphite-900 ring-1 ring-graphite-700" data-testid="sourcing-job-list">
                        {list.data.map((j) => (
                            <li key={j.id}>
                                <Link href={`/admin/sourcing/jobs/${encodeURIComponent(j.id)}`} className="flex items-center gap-3 px-4 py-3 hover:bg-graphite-850 focus:outline-none focus-visible:bg-graphite-850 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal" data-testid={`sourcing-job-${j.displayId}`}>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="font-mono text-sm font-semibold">{j.displayId}</span>
                                            <StatusPill status={JOB_PILL[j.status]} />
                                            <span className="font-mono text-[11px] text-fg-subtle">{j.status}</span>
                                            <span className="rounded-md bg-graphite-750 px-2 py-0.5 text-[11px] text-fg-muted">{j.channel}</span>
                                            {j.pendingApprovalCount > 0 && (
                                                <span className="rounded-full bg-amber/15 px-2 py-0.5 text-[11px] font-semibold text-amber">{plural(j.pendingApprovalCount, 'approval')} pending</span>
                                            )}
                                        </div>
                                        <p className="truncate text-xs text-fg-muted">
                                            {j.request.name} · {j.buildDisplayId} v{j.designVersion} · qty {j.request.quantity.toLocaleString('en-US')} · {plural(j.offerCount, 'offer')} · {dateTime(j.createdAt)}
                                        </p>
                                    </div>
                                    <ChevronRight className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden />
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
