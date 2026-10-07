import { Check, Loader2 } from 'lucide-react';
import type { BuildSourcingView } from '@/contracts';
import { plural, relativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

type Job = BuildSourcingView['jobs'][number];

const STEPS = ['Request received', 'Matching partners', 'Collecting quotes', 'Route ready'] as const;

const STEP_INDEX: Record<Job['status'], number> = { QUEUED: 1, LEASED: 1, IN_PROGRESS: 2, COMPLETE: 3, CANCELLED: 0, FAILED: 0 };

const STATUS_LINE: Partial<Record<Job['status'], string>> = {
    QUEUED: 'Your request is in line. Partners usually start replying within a business day.',
    LEASED: 'A sourcing specialist picked up your request and is matching partners.',
    IN_PROGRESS: 'Partners are quoting your build. New offers appear below as they arrive.',
};

/** Uber-style "Finding manufacturing partners…" state for an active sourcing job. */
export function SourcingProgress({ job, offerCount }: { job: Job; offerCount: number }) {
    const current = STEP_INDEX[job.status];
    return (
        <div className="rounded-2xl bg-graphite-850 p-4 ring-1 ring-graphite-700" data-testid="sourcing-progress" data-status={job.status}>
            <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-signal/15 text-signal" aria-hidden>
                    <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" />
                </span>
                <div className="min-w-0 flex-1" role="status" aria-live="polite" aria-atomic="true">
                    <p className="font-display text-lg font-bold">Finding manufacturing partners…</p>
                    <p className="mt-0.5 text-sm text-fg-muted">{STATUS_LINE[job.status]}</p>
                    <p className="mt-1 text-xs text-fg-subtle">
                        {job.displayId} · {plural(job.quantity, 'part')} · requested {relativeTime(job.createdAt)}
                        {offerCount > 0 && ` · ${plural(offerCount, 'offer')} so far`}
                    </p>
                </div>
            </div>
            <ol className="mt-4 grid grid-cols-4 gap-1.5" aria-label="Sourcing progress">
                {STEPS.map((label, i) => {
                    const done = i < current;
                    const active = i === current;
                    return (
                        <li key={label} className="min-w-0" aria-current={active ? 'step' : undefined}>
                            <span className={cn('block h-1.5 rounded-full', done ? 'bg-signal' : active ? 'animate-pulse bg-signal/60 motion-reduce:animate-none' : 'bg-graphite-700')} aria-hidden />
                            <span className={cn('mt-1.5 flex items-center gap-1 text-[11px] leading-tight', done || active ? 'text-fg' : 'text-fg-subtle')}>
                                {done && <Check className="h-3 w-3 shrink-0 text-signal" aria-hidden />}
                                <span className="truncate">{label}</span>
                                <span className="sr-only">{done ? ' (done)' : active ? ' (in progress)' : ''}</span>
                            </span>
                        </li>
                    );
                })}
            </ol>
        </div>
    );
}
