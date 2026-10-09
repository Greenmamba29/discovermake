'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { INSIGHT_RANGES, type InsightRange, type InsightsView } from '@/contracts/media';
import { buttonClass } from '@/components/ui/button';
import { Notice } from '@/components/ui/state';
import { PageSkeleton } from '@/components/ui/skeleton';
import { ApiClientError, errorMessage } from '@/lib/api';
import { money } from '@/lib/format';
import { cn } from '@/lib/utils';
import { EarningsChart, ProductMixChart } from './charts';
import { mediaApi } from './media-api';
import { RemixTreeView } from './remix-tree';
import { StudioNav } from './studio-nav';

const RANGE_LABEL: Record<InsightRange, string> = { '7d': '7 days', '30d': '30 days', '90d': '90 days', all: 'All time' };

/** `/studio/insights` (SoundCloud Insights · DoorDash Merchant product mix · Square best sellers). */
export function InsightsScreen() {
    const [range, setRange] = useState<InsightRange>('30d');
    const insights = useQuery({ queryKey: ['media-insights', range], queryFn: () => mediaApi.insights(range), retry: false });
    if (insights.error instanceof ApiClientError && insights.error.status === 401) {
        return (
            <div className="mx-auto w-full max-w-xl px-4 py-16 text-center sm:px-6">
                <h1 className="font-display font-wide text-3xl font-extrabold">Sign in to see your insights</h1>
                <Link href="/signin?next=/studio/insights" className={buttonClass('primary', 'md', 'mt-6')}>
                    Sign in
                </Link>
            </div>
        );
    }
    return (
        <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6" data-testid="insights">
            <p className="eyebrow">Creator Studio</p>
            <h1 className="mt-1 font-display font-wide text-3xl font-extrabold">Insights</h1>
            <div className="mt-4">
                <StudioNav />
            </div>
            <div role="group" aria-label="Date range" className="mt-6 flex flex-wrap gap-2" data-testid="insights-range">
                {INSIGHT_RANGES.map((r) => (
                    <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)} className={cn('min-h-[44px] rounded-full px-4 text-sm font-semibold ring-1 ring-inset', range === r ? 'bg-signal/15 text-signal ring-signal/60' : 'bg-graphite-850 text-fg-muted ring-graphite-600 hover:text-fg')} data-testid={`range-${r}`}>
                        {RANGE_LABEL[r]}
                    </button>
                ))}
            </div>
            {insights.isLoading ? (
                <PageSkeleton label="Crunching your numbers" />
            ) : insights.error || !insights.data ? (
                <Notice tone="error" className="mt-4">
                    {errorMessage(insights.error)}
                </Notice>
            ) : (
                <Body data={insights.data} />
            )}
        </div>
    );
}

function Body({ data }: { data: InsightsView }) {
    const t = data.totals;
    const tiles = [
        { label: 'Earnings', value: money(t.earningsCents, data.currency), testId: 'tile-earnings' },
        { label: 'Royalties', value: money(t.royaltiesCents, data.currency), testId: 'tile-royalties' },
        { label: 'Live revenue', value: money(t.liveRevenueCents, data.currency), testId: 'tile-live' },
        { label: 'Orders', value: String(t.orders), testId: 'tile-orders' },
        { label: 'Remixes', value: String(t.remixes), testId: 'tile-remixes' },
        { label: 'Show views', value: String(t.showViews), sub: `${t.likes} likes`, testId: 'tile-views' },
        { label: 'Slot conversion', value: t.slotConversionPct === null ? '–' : `${t.slotConversionPct}%`, sub: 'slots per viewer', testId: 'tile-conversion' },
    ];
    return (
        <>
            <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7" data-testid="insights-totals">
                {tiles.map((tile) => (
                    <div key={tile.label} className="rounded-xl bg-graphite-900 p-3 ring-1 ring-graphite-700" data-testid={tile.testId}>
                        <dt className="text-xs text-fg-muted">{tile.label}</dt>
                        <dd className="font-display text-xl font-bold tabular">{tile.value}</dd>
                        {tile.sub && <dd className="text-xs text-fg-subtle">{tile.sub}</dd>}
                    </div>
                ))}
            </dl>
            <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <section aria-labelledby="earnings-heading" className="min-w-0 rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700">
                    <h2 id="earnings-heading" className="font-display text-lg font-bold">
                        Earnings over time
                    </h2>
                    <div className="mt-3">
                        <EarningsChart series={data.series} currency={data.currency} />
                    </div>
                </section>
                <section aria-labelledby="mix-heading" className="min-w-0 rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700">
                    <h2 id="mix-heading" className="font-display text-lg font-bold">
                        Product mix
                    </h2>
                    <div className="mt-3">
                        <ProductMixChart rows={data.productMix} currency={data.currency} />
                    </div>
                </section>
            </div>
            <section aria-labelledby="best-heading" className="mt-6 min-w-0 rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700" data-testid="best-sellers">
                <h2 id="best-heading" className="font-display text-lg font-bold">
                    Best sellers
                </h2>
                {data.topBuilds.length === 0 ? (
                    <p className="mt-2 text-sm text-fg-muted">Publish a build to see how it sells.</p>
                ) : (
                    <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Best sellers table">
                        <table className="w-full min-w-[480px] text-left text-sm">
                            <thead className="text-xs text-fg-muted">
                                <tr>
                                    <th scope="col" className="py-2 pr-3 font-medium">Build</th>
                                    <th scope="col" className="py-2 pr-3 font-medium">Orders</th>
                                    <th scope="col" className="py-2 pr-3 font-medium">Remixes</th>
                                    <th scope="col" className="py-2 font-medium">Earned</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.topBuilds.map((b) => (
                                    <tr key={b.buildId} className="border-t border-graphite-800" data-testid="best-seller-row" data-build-id={b.buildId}>
                                        <td className="py-2 pr-3">
                                            {b.published ? (
                                                <Link href={`/b/${b.buildId}`} className="font-semibold text-fg underline-offset-2 hover:underline">
                                                    {b.title}
                                                </Link>
                                            ) : (
                                                b.title
                                            )}
                                        </td>
                                        <td className="py-2 pr-3 tabular">{b.orders}</td>
                                        <td className="py-2 pr-3 tabular">{b.remixes}</td>
                                        <td className="py-2 tabular">{money(b.earningsCents, data.currency)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>
            <div className="mt-6 grid gap-6 lg:grid-cols-2">
                <section aria-labelledby="tree-heading" className="min-w-0 rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700">
                    <h2 id="tree-heading" className="font-display text-lg font-bold">
                        Remix tree
                    </h2>
                    {data.remixTree.length === 0 ? <p className="mt-2 text-sm text-fg-muted">No remixes of your builds yet.</p> : <div className="mt-3 space-y-4">{data.remixTree.map((n) => <RemixTreeView key={n.buildId} node={n} />)}</div>}
                </section>
                <section aria-labelledby="shows-heading" className="min-w-0 rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700" data-testid="show-stats">
                    <h2 id="shows-heading" className="font-display text-lg font-bold">
                        Shows
                    </h2>
                    {data.shows.length === 0 ? (
                        <p className="mt-2 text-sm text-fg-muted">No shows in this range.</p>
                    ) : (
                        <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Show stats table">
                            <table className="w-full min-w-[480px] text-left text-sm">
                                <thead className="text-xs text-fg-muted">
                                    <tr>
                                        <th scope="col" className="py-2 pr-3 font-medium">Show</th>
                                        <th scope="col" className="py-2 pr-3 font-medium">Views</th>
                                        <th scope="col" className="py-2 pr-3 font-medium">Likes</th>
                                        <th scope="col" className="py-2 pr-3 font-medium">Slots</th>
                                        <th scope="col" className="py-2 font-medium">Revenue</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.shows.map((s) => (
                                        <tr key={s.showId} className="border-t border-graphite-800">
                                            <td className="py-2 pr-3">
                                                <Link href={`/studio/shows/${s.showId}`} className="font-semibold text-fg underline-offset-2 hover:underline">
                                                    {s.title}
                                                </Link>
                                                <span className="block text-xs text-fg-subtle">
                                                    {s.displayId} · {s.clips} clip{s.clips === 1 ? '' : 's'}
                                                </span>
                                            </td>
                                            <td className="py-2 pr-3 tabular">{s.uniqueViewers}</td>
                                            <td className="py-2 pr-3 tabular">{s.likes}</td>
                                            <td className="py-2 pr-3 tabular">
                                                {s.slotsClaimed}
                                                {s.slotConversionPct !== null ? ` (${s.slotConversionPct}%)` : ''}
                                            </td>
                                            <td className="py-2 tabular">{money(s.revenueCents, data.currency)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>
            </div>
        </>
    );
}
