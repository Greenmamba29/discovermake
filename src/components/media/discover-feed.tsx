'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Loader2, Radio, Search, X } from 'lucide-react';
import type { FeedItem, FeedTab, SearchResponse } from '@/contracts/media';
import { EmptyState, Notice } from '@/components/ui/state';
import { errorMessage } from '@/lib/api';
import { INTERESTS } from '@/lib/interests';
import { cn } from '@/lib/utils';
import { LiveBadge } from '@/components/live/live-badge';
import { BuildCardView } from './build-card';
import { ClipCardView } from './clip-card';
import { logFeedEvents, mediaApi } from './media-api';

const TABS: { key: FeedTab; label: string }[] = [
    { key: 'for_you', label: 'For you' },
    { key: 'live', label: 'Live' },
    { key: 'new', label: 'New' },
    { key: 'trending', label: 'Trending' },
];

/**
 * Discover feed (workflow 10: Pinterest home feed / Behance): For you · Live · New · Trending,
 * a mobile-first masonry grid with infinite scroll on a real keyset cursor, and search
 * (Postgres full-text over builds, channels and clips). Impressions and clicks are logged.
 */
export function DiscoverFeed() {
    const [tab, setTab] = useState<FeedTab>('for_you');
    const [query, setQuery] = useState('');
    const [submitted, setSubmitted] = useState('');
    const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

    const onKey = (e: React.KeyboardEvent, i: number) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const next = (i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
        setTab(TABS[next].key);
        tabRefs.current[next]?.focus();
    };
    const submit = (e: FormEvent) => {
        e.preventDefault();
        setSubmitted(query.trim());
    };

    return (
        <div>
            <form role="search" onSubmit={submit} className="relative" data-testid="discover-search">
                <label htmlFor="discover-q" className="sr-only">
                    Search builds, channels and clips
                </label>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
                <input
                    id="discover-q"
                    type="search"
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        if (!e.target.value) setSubmitted('');
                    }}
                    placeholder="Search builds, channels and clips"
                    className="h-12 w-full rounded-xl bg-graphite-850 pl-10 pr-24 text-[15px] text-fg ring-1 ring-inset ring-graphite-600 placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-signal"
                    data-testid="discover-search-input"
                />
                <button type="submit" className="absolute right-1.5 top-1/2 h-9 -translate-y-1/2 rounded-lg bg-graphite-700 px-3 text-sm font-semibold text-fg hover:bg-graphite-600" data-testid="discover-search-submit">
                    Search
                </button>
            </form>

            {submitted ? (
                <SearchResults q={submitted} onClear={() => (setSubmitted(''), setQuery(''))} />
            ) : (
                <>
                    <div role="tablist" aria-label="Discover feeds" className="mt-4 flex gap-1 overflow-x-auto border-b border-graphite-700" data-testid="feed-tabs">
                        {TABS.map((t, i) => (
                            <button
                                key={t.key}
                                ref={(el) => {
                                    tabRefs.current[i] = el;
                                }}
                                type="button"
                                role="tab"
                                id={`feed-tab-${t.key}`}
                                aria-selected={tab === t.key}
                                aria-controls={`feed-panel-${t.key}`}
                                tabIndex={tab === t.key ? 0 : -1}
                                onClick={() => setTab(t.key)}
                                onKeyDown={(e) => onKey(e, i)}
                                className={cn('min-h-[44px] whitespace-nowrap border-b-2 px-4 text-sm font-semibold transition-colors', tab === t.key ? 'border-signal text-fg' : 'border-transparent text-fg-muted hover:text-fg')}
                                data-testid={`feed-tab-${t.key}`}
                            >
                                {t.key === 'live' && <Radio className="mr-1 inline h-3.5 w-3.5 text-live" aria-hidden />}
                                {t.label}
                            </button>
                        ))}
                    </div>
                    <FeedPanel key={tab} tab={tab} />
                </>
            )}
        </div>
    );
}

function FeedPanel({ tab }: { tab: FeedTab }) {
    const feed = useInfiniteQuery({
        queryKey: ['media-feed', tab],
        queryFn: ({ pageParam }) => mediaApi.feed(tab, pageParam),
        initialPageParam: null as string | null,
        getNextPageParam: (last) => last.nextCursor,
    });
    const sentinel = useRef<HTMLDivElement>(null);
    const logged = useRef(new Set<string>());
    const pages = feed.data?.pages;
    const items = useMemo(() => pages?.flatMap((p) => p.items) ?? [], [pages]);
    const seeded = feed.data?.pages[0]?.seededBy;
    const { hasNextPage, isFetchingNextPage, fetchNextPage } = feed;

    useEffect(() => {
        const el = sentinel.current;
        if (!el || !hasNextPage) return;
        const io = new IntersectionObserver((entries) => {
            if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
        });
        io.observe(el);
        return () => io.disconnect();
    }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

    // Impressions: each item once per mount, batched per page.
    useEffect(() => {
        const fresh = items.map((it, i) => ({ it, i })).filter(({ it }) => !logged.current.has(it.id));
        if (!fresh.length) return;
        fresh.forEach(({ it }) => logged.current.add(it.id));
        logFeedEvents(fresh.slice(0, 50).map(({ it, i }) => ({ kind: 'impression' as const, itemKind: it.kind, itemId: it.id, tab, position: i, score: it.score })));
    }, [items, tab]);

    return (
        <section id={`feed-panel-${tab}`} role="tabpanel" aria-labelledby={`feed-tab-${tab}`} className="mt-4" data-testid="feed-panel" data-tab={tab}>
            <h2 className="sr-only">{TABS.find((t) => t.key === tab)?.label}</h2>
            {tab === 'for_you' && seeded && seeded.source !== 'none' && (
                <p className="mb-3 text-sm text-fg-muted" data-testid="feed-seeded">
                    Picked for you from {seeded.interests.slice(0, 3).map((s) => INTERESTS[s]?.label ?? s).join(', ')}
                    {seeded.interests.length > 3 ? ' and more' : ''}.
                </p>
            )}
            {feed.isLoading ? (
                <p className="flex items-center gap-2 py-8 text-sm text-fg-muted" role="status">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading the feed…
                </p>
            ) : feed.error ? (
                <Notice tone="error">{errorMessage(feed.error)}</Notice>
            ) : items.length === 0 ? (
                <EmptyState title={tab === 'live' ? 'Nothing live right now' : 'Nothing published yet'}>
                    {tab === 'live' ? 'Follow a channel to hear when it goes live, or browse replays on the Live tab.' : 'Creators publish their builds from Creator Studio. Start from a template below in the meantime.'}
                </EmptyState>
            ) : (
                <div className="columns-2 gap-3 sm:gap-4 lg:columns-3 xl:columns-4" data-testid="feed-grid">
                    {items.map((it, i) => (
                        <FeedCard key={`${it.kind}:${it.id}`} item={it} tab={tab} position={i} />
                    ))}
                </div>
            )}
            <div ref={sentinel} aria-hidden className="h-1" />
            {hasNextPage && (
                <div className="mt-2 flex justify-center">
                    <button type="button" onClick={() => void fetchNextPage()} disabled={isFetchingNextPage} className="min-h-[44px] rounded-xl px-4 text-sm font-semibold text-fg-muted ring-1 ring-inset ring-graphite-600 hover:text-fg" data-testid="feed-more">
                        {isFetchingNextPage ? 'Loading…' : 'Show more'}
                    </button>
                </div>
            )}
        </section>
    );
}

function FeedCard({ item, tab, position }: { item: FeedItem; tab: FeedTab | 'search'; position: number }) {
    const click = () => logFeedEvents([{ kind: 'click', itemKind: item.kind, itemId: item.id, tab, position, score: item.score }]);
    if (item.kind === 'build') return <BuildCardView build={item.build} onOpen={click} />;
    if (item.kind === 'clip') return <ClipCardView clip={item.clip} tab={tab} position={position} />;
    const s = item.show;
    return (
        <article className="mb-4 break-inside-avoid overflow-hidden rounded-2xl bg-graphite-900 ring-1 ring-graphite-700" data-testid="feed-show" data-show-id={s.id} aria-labelledby={`feed-show-${s.id}`}>
            <Link href={`/live/${s.id}`} onClick={click} className="block">
                <div className="flex aspect-[4/3] flex-col justify-between bg-[radial-gradient(ellipse_at_top,#26302b,#0c0e0d_75%)] p-3">
                    <LiveBadge status={s.status} viewerCount={s.viewerCount} />
                    <p className="text-xs text-white/80">{s.status === 'SCHEDULED' ? new Date(s.scheduledFor).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : s.displayId}</p>
                </div>
                <div className="p-3">
                    <h3 id={`feed-show-${s.id}`} className="font-display text-sm font-bold text-fg">
                        {s.title}
                    </h3>
                    <p className="mt-0.5 text-xs text-fg-muted">{s.channel.name}</p>
                </div>
            </Link>
        </article>
    );
}

function SearchResults({ q, onClear }: { q: string; onClear: () => void }) {
    const search = useQuery({ queryKey: ['media-search', q], queryFn: () => mediaApi.search(q) });
    const data: SearchResponse | undefined = search.data;
    const total = data ? data.builds.length + data.channels.length + data.clips.length : 0;
    return (
        <section className="mt-4" aria-labelledby="search-heading" data-testid="search-results">
            <div className="flex items-center justify-between gap-2">
                <h2 id="search-heading" className="font-display text-lg font-bold" aria-live="polite">
                    {search.isLoading ? `Searching “${q}”…` : `${total} result${total === 1 ? '' : 's'} for “${q}”`}
                </h2>
                <button type="button" onClick={onClear} className="inline-flex min-h-[44px] items-center gap-1 rounded-lg px-2 text-sm text-fg-muted hover:text-fg" data-testid="search-clear">
                    <X className="h-4 w-4" aria-hidden /> Clear
                </button>
            </div>
            {search.error && <Notice tone="error">{errorMessage(search.error)}</Notice>}
            {data && total === 0 && <EmptyState title="No matches">Try fewer words, or browse the feed.</EmptyState>}
            {data && data.channels.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-2" aria-label="Channels">
                    {data.channels.map((c) => (
                        <li key={c.id}>
                            <Link href={`/c/${c.handle}`} className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-graphite-850 px-4 text-sm font-semibold ring-1 ring-graphite-600 hover:bg-graphite-800" data-testid="search-channel">
                                {c.name} <span className="text-fg-subtle">@{c.handle}</span>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
            {data && data.builds.length + data.clips.length > 0 && (
                <div className="mt-4 columns-2 gap-3 sm:gap-4 lg:columns-3 xl:columns-4">
                    {data.builds.map((b, i) => (
                        <FeedCard key={b.buildId} item={{ kind: 'build', id: b.buildId, score: 0, build: b }} tab="search" position={i} />
                    ))}
                    {data.clips.map((c, i) => (
                        <FeedCard key={c.id} item={{ kind: 'clip', id: c.id, score: 0, clip: c }} tab="search" position={data.builds.length + i} />
                    ))}
                </div>
            )}
        </section>
    );
}
