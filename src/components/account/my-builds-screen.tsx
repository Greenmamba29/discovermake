'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Box, ChevronRight, GitFork, RotateCcw, Wrench } from 'lucide-react';
import { MY_BUILDS_TABS, type MyBuildRow, type MyBuildsTab } from '@/contracts/account';
import { Button, ButtonLink } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, Notice } from '@/components/ui/state';
import { StatusPill } from '@/components/ui/status-pill';
import { errorMessage } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { accountApi, toAppPath } from './account-api';
import { ORIGIN_LABELS, TAB_LABELS } from './labels';

const EMPTY_COPY: Record<MyBuildsTab, { title: string; body: string }> = {
    all: { title: 'Nothing here yet', body: 'Upload a drawing or describe a part. Your builds show up here with Reorder, Remix and Repair.' },
    created: { title: 'No builds made yet', body: 'Upload a drawing or describe what you want to make.' },
    remixed: { title: 'No remixes yet', body: 'Remix any approved build to make it your own.' },
    ordered: { title: 'No orders yet', body: 'Builds you order appear here, ready to reorder in one tap.' },
    following: { title: 'Not following anything', body: 'Follow builds from creators and shops to keep them here.' },
};

/**
 * My Builds (workflow 09, Mobbin: Yami status tabs + Glovo "Reorder" rows + Subway
 * "Order again": Customize = Remix, Add = Reorder). Guests see this device's builds with a
 * prompt to sign in and keep them.
 */
export function MyBuildsScreen({ initialTab }: { initialTab: MyBuildsTab }) {
    const router = useRouter();
    const [tab, setTab] = useState<MyBuildsTab>(initialTab);
    const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
    const q = useQuery({ queryKey: ['my-builds', tab], queryFn: () => accountApi.myBuilds(tab), placeholderData: (prev) => prev });

    function select(next: MyBuildsTab, focus = false) {
        setTab(next);
        router.replace(next === 'all' ? '/builds' : `/builds?tab=${next}`, { scroll: false });
        if (focus) tabRefs.current[next]?.focus();
    }

    function onTabKey(e: KeyboardEvent<HTMLButtonElement>) {
        const i = MY_BUILDS_TABS.indexOf(tab);
        const move = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (e.key === 'Home') select(MY_BUILDS_TABS[0], true);
        else if (e.key === 'End') select(MY_BUILDS_TABS[MY_BUILDS_TABS.length - 1], true);
        else if (move) select(MY_BUILDS_TABS[(i + move + MY_BUILDS_TABS.length) % MY_BUILDS_TABS.length], true);
        else return;
        e.preventDefault();
    }

    const data = q.data;
    return (
        <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
            <p className="eyebrow">Builds</p>
            <h1 className="mt-2 font-display font-wide text-3xl font-extrabold">My builds</h1>
            <p className="mt-1 text-fg-muted">Everything you made, remixed, ordered or follow.</p>

            {data?.guest && ((data.counts.all ?? 0) > 0 || tab !== 'all') && (
                <Notice
                    tone="warning"
                    className="mt-6"
                    title="Sign in to keep these builds"
                    testId="builds-guest-banner"
                    action={
                        <ButtonLink href="/signin?next=/builds&mode=create" size="sm" data-testid="builds-guest-signin">
                            Sign in
                        </ButtonLink>
                    }
                >
                    They are saved in this browser only. Sign in and they move to your account, on every device.
                </Notice>
            )}

            <div className="-mx-4 mt-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                <div role="tablist" aria-label="Filter builds" className="flex min-w-max gap-2 border-b border-graphite-700 pb-3" data-testid="builds-tabs">
                    {MY_BUILDS_TABS.map((t) => {
                        const active = t === tab;
                        return (
                            <button
                                key={t}
                                ref={(el) => {
                                    tabRefs.current[t] = el;
                                }}
                                type="button"
                                role="tab"
                                id={`builds-tab-${t}`}
                                aria-selected={active}
                                aria-controls="builds-panel"
                                tabIndex={active ? 0 : -1}
                                onClick={() => select(t)}
                                onKeyDown={onTabKey}
                                data-testid={`builds-tab-${t}`}
                                className={cn(
                                    'inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-signal',
                                    active ? 'bg-fg text-graphite-950' : 'bg-graphite-800 text-fg-muted ring-1 ring-inset ring-graphite-600 hover:text-fg',
                                )}
                            >
                                {TAB_LABELS[t]}
                                <span className={cn('rounded-full px-1.5 font-mono text-xs', active ? 'bg-graphite-950/15' : 'bg-graphite-700')} data-testid={`builds-count-${t}`}>
                                    {data?.counts[t] ?? 0}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>

            <div role="tabpanel" id="builds-panel" aria-labelledby={`builds-tab-${tab}`} className="mt-5" aria-busy={q.isFetching || undefined}>
                {q.isPending ? (
                    <div className="space-y-3" role="status" aria-live="polite">
                        <span className="sr-only">Loading your builds…</span>
                        <Skeleton className="h-36" />
                        <Skeleton className="h-36" />
                    </div>
                ) : q.isError ? (
                    <Notice tone="error" title="We could not load your builds">
                        {errorMessage(q.error)}
                    </Notice>
                ) : data && data.rows.length === 0 ? (
                    <EmptyState
                        title={EMPTY_COPY[tab].title}
                        icon={<Box className="h-8 w-8" aria-hidden />}
                        action={
                            <ButtonLink href="/make" size="lg" data-testid="builds-empty-cta">
                                Make something
                            </ButtonLink>
                        }
                    >
                        {EMPTY_COPY[tab].body}
                    </EmptyState>
                ) : (
                    <ul className="flex flex-col gap-3" data-testid="builds-list">
                        {data!.rows.map((row) => (
                            <BuildRow key={row.buildId} row={row} />
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}

function openHref(row: MyBuildRow): string {
    if (row.origin === 'upload' && row.partId) return `/parts/${encodeURIComponent(row.partId)}`;
    if (row.origin === 'reconstruct') return `/reconstruct/${encodeURIComponent(row.buildId)}`;
    return `/build/${encodeURIComponent(row.buildId)}/workspace`;
}

function Preview({ row }: { row: MyBuildRow }) {
    if (row.previewSvg && row.previewSize && row.previewSize.widthMm > 0 && row.previewSize.heightMm > 0) {
        const { widthMm: w, heightMm: h } = row.previewSize;
        const pad = Math.max(w, h) * 0.08;
        return (
            <svg viewBox={`${-pad} ${-pad} ${w + pad * 2} ${h + pad * 2}`} className="h-full w-full" aria-hidden preserveAspectRatio="xMidYMid meet">
                <path d={row.previewSvg} fillRule="evenodd" fill="#a9afab" />
            </svg>
        );
    }
    return <Box className="h-7 w-7 text-fg-subtle" aria-hidden />;
}

function BuildRow({ row }: { row: MyBuildRow }) {
    const router = useRouter();
    const [pending, setPending] = useState<'reorder' | 'remix' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const errorId = `build-${row.buildId}-error`;

    async function reorder() {
        setError(null);
        setPending('reorder');
        try {
            const res = await accountApi.reorder(row.buildId);
            router.push(toAppPath(res.checkoutUrl));
        } catch (err) {
            setError(errorMessage(err));
            setPending(null);
        }
    }

    async function remix() {
        setError(null);
        setPending('remix');
        try {
            const res = await accountApi.remix(row.buildId);
            router.push(`/build/${encodeURIComponent(res.buildId)}/workspace`);
        } catch (err) {
            setError(errorMessage(err));
            setPending(null);
        }
    }

    const titleId = `build-${row.buildId}-title`;
    return (
        <li className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700" aria-labelledby={titleId} data-testid={`build-row-${row.buildId}`} data-display-id={row.displayId}>
            <Link href={openHref(row)} className="group flex items-start gap-3 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-signal">
                <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-graphite-800 p-1.5 ring-1 ring-inset ring-graphite-700">
                    <Preview row={row} />
                </span>
                <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                        <span id={titleId} className="truncate font-semibold text-fg group-hover:underline">
                            {row.name}
                        </span>
                        <StatusPill status={row.status} />
                    </span>
                    <span className="mt-1 block font-mono text-xs text-fg-subtle">
                        {row.displayId} · {ORIGIN_LABELS[row.origin]}
                        {row.currentVersion > 1 ? ` · v${row.currentVersion}` : ''}
                    </span>
                    <span className="mt-1 block text-xs text-fg-muted">
                        {row.lastOrder ? `Ordered ${dateTime(row.lastOrder.placedAt)} · ${row.lastOrder.orderNumber}` : `Updated ${dateTime(row.updatedAt)}`}
                    </span>
                </span>
                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-fg-subtle" aria-hidden />
            </Link>
            <div className="mt-3 grid grid-cols-3 gap-2" role="group" aria-label={`Actions for ${row.name}`}>
                <Button
                    size="sm"
                    onClick={reorder}
                    loading={pending === 'reorder'}
                    disabled={!row.actions.reorder || pending !== null}
                    aria-describedby={error ? errorId : undefined}
                    title={row.actions.reorder ? 'Order the same part again with the same options' : 'Order it once to reorder'}
                    data-testid="build-reorder"
                >
                    {pending !== 'reorder' && <RotateCcw className="h-4 w-4" aria-hidden />}
                    Reorder
                </Button>
                <Button
                    size="sm"
                    variant="secondary"
                    onClick={remix}
                    loading={pending === 'remix'}
                    disabled={!row.actions.remix || pending !== null}
                    aria-describedby={error ? errorId : undefined}
                    title={row.actions.remix ? 'Copy the approved design into a new build you can change' : 'Approve a design version to remix it'}
                    data-testid="build-remix"
                >
                    {pending !== 'remix' && <GitFork className="h-4 w-4" aria-hidden />}
                    Remix
                </Button>
                {row.actions.repair && row.partId ? (
                    <ButtonLink href={`/parts/${encodeURIComponent(row.partId)}?replacement=1`} size="sm" variant="secondary" title="Quote a replacement for this part" data-testid="build-repair">
                        <Wrench className="h-4 w-4" aria-hidden />
                        Repair
                    </ButtonLink>
                ) : (
                    <Button size="sm" variant="secondary" disabled title="Repair is available after an order" data-testid="build-repair">
                        <Wrench className="h-4 w-4" aria-hidden />
                        Repair
                    </Button>
                )}
            </div>
            {error && (
                <p id={errorId} role="alert" className="mt-2 text-xs font-medium text-ember">
                    {error}
                </p>
            )}
        </li>
    );
}
