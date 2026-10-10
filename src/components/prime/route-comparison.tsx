'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { BadgeCheck, Factory, Globe2, Leaf, Package, Star } from 'lucide-react';
import type { RouteCandidateView, RouteComparisonView } from '@/contracts';
import { TrustChip } from '@/components/trust/trust-chip';
import { InfoTip } from '@/components/ui/info-tip';
import { Skeleton } from '@/components/ui/skeleton';
import { Notice } from '@/components/ui/state';
import { errorMessage } from '@/lib/api';
import { money, shortDate } from '@/lib/format';
import { primeApi } from '@/lib/prime-api';
import { cn } from '@/lib/utils';
import { regionName } from '@/components/sourcing/regions';

const TABS = [
    { key: 'suppliers', label: 'Suppliers' },
    { key: 'processes', label: 'Processes' },
    { key: 'impact', label: 'Impact' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

function CandidateCard({ c }: { c: RouteCandidateView }) {
    const where = c.kind === 'supplier' ? `Made in ${regionName(c.location)}` : c.location;
    return (
        <article className={cn('rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700', c.recommended && 'ring-signal/60')} data-testid={`route-candidate-${c.id}`} data-recommended={c.recommended || undefined}>
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-semibold text-fg">
                        {c.kind === 'shop' ? <Factory className="h-4 w-4 text-fg-muted" aria-hidden /> : <Globe2 className="h-4 w-4 text-fg-muted" aria-hidden />}
                        <span className="break-words">{c.label}</span>
                        {c.recommended && <span className="rounded-full bg-signal/15 px-2 py-0.5 text-[11px] font-semibold text-signal">Recommended</span>}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
                        <span>{where}</span>
                        <span className="inline-flex items-center gap-1">
                            {c.rating != null ? (
                                <>
                                    <Star className="h-3.5 w-3.5" aria-hidden /> {c.rating.toFixed(1)}
                                </>
                            ) : c.verified ? (
                                <>
                                    <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> Verified
                                </>
                            ) : (
                                'Not verified yet'
                            )}
                        </span>
                        {c.filledFromStock && (
                            <span className="inline-flex items-center gap-1 text-signal">
                                <Package className="h-3.5 w-3.5" aria-hidden /> Material in stock
                            </span>
                        )}
                    </p>
                </div>
                <TrustChip level={c.trustLevel} />
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <div className="min-w-0">
                    <dt className="text-xs text-fg-subtle">Total</dt>
                    <dd className="font-mono font-semibold tabular">{money(c.totalCents)}</dd>
                </div>
                <div className="min-w-0">
                    <dt className="text-xs text-fg-subtle">Delivery by</dt>
                    <dd className="font-semibold">{shortDate(c.arrivesBy)}</dd>
                </div>
                <div className="min-w-0">
                    <dt className="text-xs text-fg-subtle">CO₂e</dt>
                    <dd className="font-mono tabular">≈ {Math.round(c.co2Kg)} kg</dd>
                </div>
            </dl>
            {c.capabilities.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                    {[...c.capabilities, ...c.certifications].slice(0, 6).map((x) => (
                        <li key={x} className="max-w-full truncate rounded-md bg-graphite-750 px-2 py-0.5 text-fg-muted">
                            {x}
                        </li>
                    ))}
                </ul>
            )}
        </article>
    );
}

function Suppliers({ view }: { view: RouteComparisonView }) {
    return (
        <div className="space-y-3">
            <p className="flex items-center text-sm text-fg-muted">
                Ranked on price, delivery date, quality and CO₂.
                <InfoTip
                    label="route ranking"
                    text={`We weigh total price ${Math.round(view.weights.cost * 100)}%, delivery date ${Math.round(view.weights.date * 100)}%, quality ${Math.round(view.weights.quality * 100)}% and CO₂ ${Math.round(view.weights.co2 * 100)}%. Only a binding or supplier-confirmed route can be Recommended. Delivery dates are our 90th-percentile estimates.`}
                />
            </p>
            <ul className="space-y-3" aria-label="Manufacturing routes">
                {view.candidates.map((c) => (
                    <li key={c.id}>
                        <CandidateCard c={c} />
                    </li>
                ))}
            </ul>
        </div>
    );
}

function Processes({ view }: { view: RouteComparisonView }) {
    return (
        <ol className="space-y-2" aria-label="Process steps">
            {view.processes.map((p, i) => (
                <li key={`${p.step}-${i}`} className="flex gap-3 rounded-xl bg-graphite-900 p-3 ring-1 ring-graphite-700">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-graphite-750 font-mono text-xs text-fg" aria-hidden>
                        {i + 1}
                    </span>
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-fg">{p.step}</p>
                        <p className="break-words text-sm text-fg-muted">{p.detail}</p>
                    </div>
                </li>
            ))}
        </ol>
    );
}

function Impact({ view }: { view: RouteComparisonView }) {
    const max = Math.max(1, ...view.candidates.map((c) => c.co2Kg));
    return (
        <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm text-fg">
                <Leaf className="h-4 w-4 text-signal" aria-hidden /> Material alone ≈ <span className="font-mono tabular">{view.impact.materialKgCo2e} kg</span> CO₂e
            </p>
            <ul className="space-y-2" aria-label="CO2 per route">
                {view.candidates.map((c) => (
                    <li key={c.id} className="rounded-xl bg-graphite-900 p-3 ring-1 ring-graphite-700">
                        <div className="flex items-center justify-between gap-2 text-sm">
                            <span className="min-w-0 truncate text-fg">{c.label}</span>
                            <span className="shrink-0 font-mono tabular text-fg-muted">≈ {Math.round(c.co2Kg)} kg</span>
                        </div>
                        <div className="mt-2 h-1.5 rounded-full bg-graphite-750" aria-hidden>
                            <div className="h-1.5 rounded-full bg-signal" style={{ width: `${Math.max(4, Math.round((c.co2Kg / max) * 100))}%` }} />
                        </div>
                    </li>
                ))}
            </ul>
            <p className="text-xs text-fg-subtle">{view.impact.method}</p>
        </div>
    );
}

/** Manufacturing Route comparison (workflow 04 · screen 03): Suppliers · Processes · Impact. Buyer-safe. */
export function RouteComparison({ buildId, quoteId }: { buildId: string; quoteId: string }) {
    const [tab, setTab] = useState<TabKey>('suppliers');
    const q = useQuery({ queryKey: ['route-comparison', buildId, quoteId], queryFn: () => primeApi.routes(buildId, quoteId), refetchInterval: 30_000 });
    return (
        <section aria-labelledby="compare-heading" className="space-y-3" data-testid="route-comparison">
            <div>
                <p className="eyebrow">Compare routes</p>
                <h2 id="compare-heading" className="mt-1 font-display text-xl font-bold">
                    Every way to make it
                </h2>
            </div>
            <div className="flex gap-1 rounded-xl bg-graphite-900 p-1 ring-1 ring-graphite-700" role="tablist" aria-label="Route details">
                {TABS.map((t) => (
                    <button
                        key={t.key}
                        type="button"
                        role="tab"
                        id={`route-tab-${t.key}`}
                        aria-selected={tab === t.key}
                        aria-controls={`route-panel-${t.key}`}
                        onClick={() => setTab(t.key)}
                        className={cn('flex h-10 min-w-0 flex-1 items-center justify-center rounded-lg text-sm font-semibold', tab === t.key ? 'bg-graphite-700 text-fg' : 'text-fg-muted hover:text-fg')}
                        data-testid={`route-tab-${t.key}`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>
            <div id={`route-panel-${tab}`} role="tabpanel" aria-labelledby={`route-tab-${tab}`}>
                {q.isLoading ? (
                    <div role="status" aria-live="polite">
                        <span className="sr-only">Comparing routes…</span>
                        <Skeleton className="h-28" />
                    </div>
                ) : q.error || !q.data ? (
                    <Notice tone="error" title="Couldn't compare routes">
                        {errorMessage(q.error)}
                    </Notice>
                ) : tab === 'suppliers' ? (
                    <Suppliers view={q.data} />
                ) : tab === 'processes' ? (
                    <Processes view={q.data} />
                ) : (
                    <Impact view={q.data} />
                )}
            </div>
        </section>
    );
}
