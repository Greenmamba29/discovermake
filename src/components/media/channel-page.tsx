'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { CalendarClock, Factory, GraduationCap, PlayCircle, UserRound } from 'lucide-react';
import type { ShowView } from '@/contracts/live';
import type { ChannelMediaPage } from '@/contracts/media';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState, ErrorState } from '@/components/ui/state';
import { PageSkeleton } from '@/components/ui/skeleton';
import { ApiClientError, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { liveApi } from '@/components/live/live-api';
import { LiveBadge } from '@/components/live/live-badge';
import { BuildCardView } from './build-card';
import { ClipCardView } from './clip-card';
import { mediaApi } from './media-api';

const KIND: Record<ChannelMediaPage['channel']['kind'], { label: string; icon: typeof UserRound }> = {
    creator: { label: 'Creator', icon: UserRound },
    factory: { label: 'Factory', icon: Factory },
    campus: { label: 'Campus', icon: GraduationCap },
};

/** `/c/:handle` (Whatnot seller profile): header + follow, live now / upcoming, builds, clips, replays. */
export function ChannelScreen({ handle }: { handle: string }) {
    const page = useQuery({ queryKey: ['media-channel', handle], queryFn: () => mediaApi.channel(handle), retry: false });
    const [following, setFollowing] = useState<{ on: boolean; count: number } | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    if (page.isLoading) return <PageSkeleton label="Loading the channel" />;
    if (page.error || !page.data) {
        const notFound = page.error instanceof ApiClientError && page.error.status === 404;
        return <ErrorState title={notFound ? 'Channel not found' : 'Could not load the channel'} message={notFound ? 'No channel has that handle.' : errorMessage(page.error)} action={<ButtonLink href="/discover">Back to Discover</ButtonLink>} />;
    }
    const data = page.data;
    const c = data.channel;
    const kind = KIND[c.kind];
    const isFollowing = following?.on ?? c.viewerFollows;
    const followers = following?.count ?? c.followerCount;
    const toggle = async () => {
        try {
            const r = await liveApi.follow(c.handle, !isFollowing);
            setFollowing({ on: r.following, count: r.followerCount });
        } catch (err) {
            setNotice(err instanceof ApiClientError && err.status === 401 ? 'Sign in to follow channels.' : errorMessage(err));
        }
    };
    return (
        <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6" data-testid="channel-page" data-kind={c.kind}>
            <header className="flex flex-wrap items-center gap-4" data-testid="channel-header">
                <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-graphite-750 font-display text-2xl font-extrabold text-fg ring-2 ring-signal/40" aria-hidden>
                    {c.name.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                    <h1 className="font-display font-wide text-2xl font-extrabold sm:text-3xl">{c.name}</h1>
                    <p className="flex flex-wrap items-center gap-x-2 text-sm text-fg-muted">
                        <span>@{c.handle}</span>
                        <span className="inline-flex items-center gap-1">
                            <kind.icon className="h-3.5 w-3.5" aria-hidden /> {kind.label}
                        </span>
                        <span data-testid="channel-followers">
                            {followers} follower{followers === 1 ? '' : 's'}
                        </span>
                        <span>· {data.stats.publishedBuilds} builds</span>
                    </p>
                    {c.bio && <p className="mt-1 max-w-2xl text-sm text-fg-muted">{c.bio}</p>}
                </div>
                {data.viewerIsOwner ? (
                    <ButtonLink href="/studio" variant="secondary" size="sm">
                        Creator Studio
                    </ButtonLink>
                ) : (
                    <button type="button" onClick={toggle} aria-pressed={isFollowing} className={cn('min-h-[44px] rounded-full px-5 text-sm font-bold', isFollowing ? 'bg-graphite-750 text-fg ring-1 ring-graphite-600' : 'bg-signal text-signal-ink')} data-testid="channel-follow">
                        {isFollowing ? 'Following' : 'Follow'}
                    </button>
                )}
            </header>
            {notice && (
                <p className="mt-3 text-sm text-fg-muted" role="status">
                    {notice}
                </p>
            )}

            {(data.live.length > 0 || data.upcoming.length > 0) && (
                <section aria-labelledby="channel-live-heading" className="mt-8">
                    <h2 id="channel-live-heading" className="font-display text-lg font-bold">
                        Live and upcoming
                    </h2>
                    <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {[...data.live, ...data.upcoming].map((s) => (
                            <ShowTile key={s.id} show={s} />
                        ))}
                    </ul>
                </section>
            )}

            <section aria-labelledby="channel-builds-heading" className="mt-8" data-testid="channel-builds">
                <h2 id="channel-builds-heading" className="font-display text-lg font-bold">
                    Builds
                </h2>
                {data.builds.length === 0 ? (
                    <div className="mt-3">
                        <EmptyState title="No published builds yet">{data.viewerIsOwner ? 'Publish a build from Creator Studio · Publishing.' : 'Follow the channel to see new builds.'}</EmptyState>
                    </div>
                ) : (
                    <div className="mt-3 columns-2 gap-3 sm:gap-4 lg:columns-3">
                        {data.builds.map((b) => (
                            <BuildCardView key={b.buildId} build={b} />
                        ))}
                    </div>
                )}
            </section>

            {data.clips.length > 0 && (
                <section aria-labelledby="channel-clips-heading" className="mt-8" data-testid="channel-clips">
                    <h2 id="channel-clips-heading" className="font-display text-lg font-bold">
                        Clips
                    </h2>
                    <div className="mt-3 columns-2 gap-3 sm:gap-4 lg:columns-4">
                        {data.clips.map((clip) => (
                            <ClipCardView key={clip.id} clip={clip} tab="channel" />
                        ))}
                    </div>
                </section>
            )}

            <section aria-labelledby="channel-replays-heading" className="mt-8" data-testid="channel-replays">
                <h2 id="channel-replays-heading" className="font-display text-lg font-bold">
                    Replays
                </h2>
                {data.replays.length === 0 ? (
                    <p className="mt-2 text-sm text-fg-muted">No replays yet.</p>
                ) : (
                    <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {data.replays.map((s) => (
                            <ShowTile key={s.id} show={s} />
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}

function ShowTile({ show }: { show: ShowView }) {
    return (
        <li>
            <Link href={`/live/${show.id}`} className="flex items-center gap-3 rounded-2xl bg-graphite-900 p-3 ring-1 ring-graphite-700 hover:bg-graphite-850" data-testid="channel-show" data-status={show.status}>
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-graphite-800" aria-hidden>
                    {show.status === 'SCHEDULED' ? <CalendarClock className="h-5 w-5 text-fg-muted" /> : <PlayCircle className="h-5 w-5 text-fg-muted" />}
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-fg">{show.title}</span>
                    <span className="mt-0.5 flex items-center gap-2 text-xs text-fg-muted">
                        <LiveBadge status={show.status} viewerCount={show.viewerCount} />
                        {show.status === 'SCHEDULED' ? new Date(show.scheduledFor).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : show.displayId}
                    </span>
                </span>
            </Link>
        </li>
    );
}
