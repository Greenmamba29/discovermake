'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { CalendarClock, Clapperboard, Radio, Video } from 'lucide-react';
import { CHANNEL_CATEGORIES, type ChannelCategory, type ShowView } from '@/contracts/live';
import { buttonClass } from '@/components/ui/button';
import { EmptyState, ErrorState } from '@/components/ui/state';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { liveApi } from './live-api';
import { LiveBadge } from './live-badge';

export const CATEGORY_LABELS: Record<ChannelCategory, string> = {
    'mega-builds': 'Mega Builds',
    'factory-floor': 'Factory Floor',
    drops: 'Drops',
    workshop: 'Workshop',
    materials: 'Materials',
    reconstruction: 'Reconstruction',
};

const FORMAT_LABELS: Record<ShowView['format'], string> = {
    creator_live: 'Creator Live',
    product_live: 'Product Live',
    live_drop: 'Live Drop',
    build_live: 'Build Live',
    factory_live: 'Factory Live',
};

function when(iso: string): string {
    return new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function ShowTile({ show, size = 'md' }: { show: ShowView; size?: 'md' | 'lg' }) {
    return (
        <Link
            href={`/live/${show.id}`}
            className={cn('group flex flex-col overflow-hidden rounded-2xl bg-graphite-900 ring-1 ring-graphite-700 transition-colors hover:ring-graphite-500', size === 'lg' ? 'w-56 shrink-0 sm:w-64' : 'w-full')}
            data-testid="show-tile"
            data-status={show.status}
        >
            <div className={cn('relative flex items-end bg-[radial-gradient(ellipse_at_top,#2b302e,#111413_75%)] p-3', size === 'lg' ? 'aspect-[3/4]' : 'aspect-video')}>
                <div className="absolute left-3 top-3">
                    <LiveBadge status={show.status} viewerCount={show.status === 'LIVE' ? show.viewerCount : undefined} />
                </div>
                <Video className="absolute right-3 top-3 h-4 w-4 text-fg-subtle" aria-hidden />
                <p className="line-clamp-3 font-display text-lg font-bold leading-tight text-fg">{show.title}</p>
            </div>
            <div className="p-3">
                <p className="truncate text-sm font-semibold text-fg">{show.channel.name}</p>
                <p className="truncate text-xs text-fg-muted">
                    {FORMAT_LABELS[show.format]} · {show.status === 'SCHEDULED' ? when(show.scheduledFor) : show.status === 'ENDED' && show.endedAt ? `Aired ${when(show.endedAt)}` : show.displayId}
                </p>
            </div>
        </Link>
    );
}

export function LiveHome() {
    const [category, setCategory] = useState<ChannelCategory | null>(null);
    const home = useQuery({ queryKey: ['live-home', category], queryFn: () => liveApi.home(category) });

    return (
        <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6">
            <p className="eyebrow">DiscoverMake Live</p>
            <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
                <h1 className="font-display font-wide text-3xl font-extrabold">Watch it made. Make it yours.</h1>
                <Link href="/studio" className={buttonClass('secondary', 'sm')} data-testid="go-live-cta">
                    <Radio className="h-4 w-4" aria-hidden /> Go live
                </Link>
            </div>

            <div className="-mx-4 mt-5 overflow-x-auto px-4 sm:mx-0 sm:px-0" data-testid="category-chips">
                <div className="flex w-max gap-2" role="group" aria-label="Channel categories">
                    <Chip active={category === null} onClick={() => setCategory(null)}>
                        All
                    </Chip>
                    {CHANNEL_CATEGORIES.map((c) => (
                        <Chip key={c} active={category === c} onClick={() => setCategory(c)} testId={`chip-${c}`}>
                            {CATEGORY_LABELS[c]}
                        </Chip>
                    ))}
                </div>
            </div>

            {home.isLoading ? (
                <div className="mt-8 grid gap-4 sm:grid-cols-3" role="status" aria-label="Loading shows">
                    <Skeleton className="h-64" />
                    <Skeleton className="h-64" />
                    <Skeleton className="h-64" />
                </div>
            ) : home.error || !home.data ? (
                <ErrorState title="Live could not load" message={errorMessage(home.error)} />
            ) : (
                <>
                    <section aria-labelledby="live-now" className="mt-8" data-testid="live-now">
                        <h2 id="live-now" className="flex items-center gap-2 font-display text-xl font-bold">
                            <span className="h-2 w-2 rounded-full bg-live" aria-hidden /> Live now
                        </h2>
                        {home.data.live.length === 0 ? (
                            <div className="mt-3">
                                <EmptyState title="Nobody is live right now" icon={<Radio className="h-8 w-8" aria-hidden />}>
                                    Check the schedule below, or start your own show from Creator Studio.
                                </EmptyState>
                            </div>
                        ) : (
                            <div className="-mx-4 mt-3 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                                <ul className="flex w-max gap-3">
                                    {home.data.live.map((s) => (
                                        <li key={s.id}>
                                            <ShowTile show={s} size="lg" />
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </section>

                    <section aria-labelledby="upcoming" className="mt-10" data-testid="upcoming">
                        <h2 id="upcoming" className="flex items-center gap-2 font-display text-xl font-bold">
                            <CalendarClock className="h-5 w-5 text-fg-muted" aria-hidden /> Upcoming
                        </h2>
                        {home.data.upcoming.length === 0 ? (
                            <p className="mt-2 text-sm text-fg-muted">No shows are scheduled yet.</p>
                        ) : (
                            <ul className="mt-3 divide-y divide-graphite-700 rounded-2xl bg-graphite-900 ring-1 ring-graphite-700">
                                {home.data.upcoming.map((s) => (
                                    <li key={s.id}>
                                        <Link href={`/live/${s.id}`} className="flex items-center justify-between gap-3 p-3 hover:bg-graphite-850">
                                            <span className="min-w-0">
                                                <span className="block truncate font-semibold text-fg">{s.title}</span>
                                                <span className="block truncate text-xs text-fg-muted">
                                                    {s.channel.name} · {FORMAT_LABELS[s.format]}
                                                </span>
                                            </span>
                                            <span className="shrink-0 font-mono text-xs text-fg-muted">{when(s.scheduledFor)}</span>
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>

                    <section aria-labelledby="replays" className="mt-10" data-testid="replays">
                        <h2 id="replays" className="flex items-center gap-2 font-display text-xl font-bold">
                            <Clapperboard className="h-5 w-5 text-fg-muted" aria-hidden /> Shoppable replays
                        </h2>
                        {home.data.replays.length === 0 ? (
                            <p className="mt-2 text-sm text-fg-muted">Replays appear here after a show ends.</p>
                        ) : (
                            <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                {home.data.replays.map((s) => (
                                    <li key={s.id}>
                                        <ShowTile show={s} />
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                </>
            )}
        </div>
    );
}

function Chip({ active, onClick, children, testId }: { active: boolean; onClick: () => void; children: React.ReactNode; testId?: string }) {
    return (
        <button
            type="button"
            aria-pressed={active}
            onClick={onClick}
            className={cn('h-9 whitespace-nowrap rounded-full px-4 text-sm font-semibold ring-1 ring-inset', active ? 'bg-fg text-graphite-950 ring-fg' : 'text-fg-muted ring-graphite-600 hover:text-fg')}
            data-testid={testId ?? 'chip-all'}
        >
            {children}
        </button>
    );
}
