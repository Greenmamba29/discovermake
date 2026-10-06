'use client';

import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Circle, ClipboardCheck, XCircle } from 'lucide-react';
import { MILESTONE_KINDS } from '@/contracts';
import { StatusPill } from '@/components/ui/status-pill';
import { PageSkeleton } from '@/components/ui/skeleton';
import { MILESTONE_LABELS } from '@/lib/status';
import { dateTime, shortDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Timeline } from './timeline';
import { MissingToken, OrderLoadError, orderLink } from './order-tracker';
import { useOrder } from './use-order';

/** Screen 05 · Production Run: milestones from the shop, inspection, activity feed. */
export function ProductionRun({ orderId, token }: { orderId: string; token: string | null }) {
    const { data: order, error, isLoading } = useOrder(orderId, token);
    if (!token) return <MissingToken />;
    if (isLoading) return <PageSkeleton label="Loading production" />;
    if (error && !order) return <OrderLoadError error={error} />;
    if (!order) return null;

    const firstAt = new Map<string, string>();
    for (const m of [...order.milestones].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))) if (!firstAt.has(m.kind)) firstAt.set(m.kind, m.occurredAt);
    const started = order.milestones.length ? [...order.milestones].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))[0].occurredAt : null;
    const relevant = MILESTONE_KINDS.filter((k) => k !== 'BENDING' || order.summary.serviceNames.some((n) => /bend/i.test(n)) || firstAt.has(k)).filter(
        (k) => k !== 'FINISHING' || order.summary.finishName !== null || firstAt.has(k),
    );

    return (
        <div className="mx-auto w-full max-w-4xl px-4 pb-16 pt-6 sm:px-6">
            <Link href={orderLink(order.id, token)} className="inline-flex items-center gap-1 rounded text-sm text-fg-muted hover:text-fg">
                <ArrowLeft className="h-4 w-4" aria-hidden /> Back to tracking
            </Link>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                    <p className="eyebrow">Production run · {order.orderNumber}</p>
                    <h1 className="mt-1 font-display font-wide text-3xl font-extrabold">{order.shop ? `In the shop at ${order.shop.name}` : 'Production slot confirmed'}</h1>
                </div>
                <StatusPill status={order.universalStatus} />
            </div>

            <dl className="mt-6 grid grid-cols-2 gap-3 rounded-2xl bg-graphite-900 p-4 text-sm ring-1 ring-graphite-700 sm:grid-cols-4">
                <div>
                    <dt className="text-fg-subtle">Quantity</dt>
                    <dd className="font-mono font-semibold tabular">{order.summary.quantity}</dd>
                </div>
                <div>
                    <dt className="text-fg-subtle">Started</dt>
                    <dd className="font-semibold">{started ? dateTime(started) : 'Not yet'}</dd>
                </div>
                <div>
                    <dt className="text-fg-subtle">Ships by</dt>
                    <dd className="font-semibold">{shortDate(order.promisedShipDate)}</dd>
                </div>
                <div>
                    <dt className="text-fg-subtle">Progress</dt>
                    <dd className="font-mono font-semibold tabular">{order.progressPct}%</dd>
                </div>
            </dl>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-graphite-700" role="progressbar" aria-label="Order progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={order.progressPct}>
                <div className="h-full rounded-full bg-signal transition-[width] duration-500" style={{ width: `${order.progressPct}%` }} />
            </div>

            <div className="mt-6 grid gap-6 md:grid-cols-2">
                <section aria-labelledby="milestones-heading" className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700 sm:p-5">
                    <h2 id="milestones-heading" className="font-display text-lg font-bold">
                        Production milestones
                    </h2>
                    <ol className="mt-4 space-y-3" data-testid="production-milestones">
                        {relevant.map((k) => {
                            const at = firstAt.get(k);
                            return (
                                <li key={k} className="flex items-center gap-3">
                                    {at ? <CheckCircle2 className="h-5 w-5 shrink-0 text-signal" aria-hidden /> : <Circle className="h-5 w-5 shrink-0 text-graphite-500" aria-hidden />}
                                    <span className={cn('flex-1 text-sm', at ? 'text-fg' : 'text-fg-subtle')}>{MILESTONE_LABELS[k].label}</span>
                                    <span className="font-mono text-[11px] text-fg-subtle">{at ? dateTime(at) : 'Pending'}</span>
                                </li>
                            );
                        })}
                    </ol>
                    {order.inspection && (
                        <div className={cn('mt-5 flex items-center gap-3 rounded-xl p-3 ring-1 ring-inset', order.inspection.outcome === 'PASS' ? 'bg-signal/10 ring-signal/30' : 'bg-ember/10 ring-ember/35')}>
                            {order.inspection.outcome === 'PASS' ? <ClipboardCheck className="h-5 w-5 text-signal" aria-hidden /> : <XCircle className="h-5 w-5 text-ember" aria-hidden />}
                            <p className="text-sm">
                                <span className="font-semibold">{order.inspection.outcome === 'PASS' ? 'Passed inspection' : 'Failed inspection · rework underway'}</span>
                                <span className="block font-mono text-[11px] text-fg-subtle">{dateTime(order.inspection.at)}</span>
                            </p>
                        </div>
                    )}
                </section>
                <section aria-labelledby="activity-heading" className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700 sm:p-5">
                    <h2 id="activity-heading" className="mb-4 font-display text-lg font-bold">
                        Recent activity
                    </h2>
                    <Timeline entries={order.timeline} limit={12} />
                </section>
            </div>
        </div>
    );
}
