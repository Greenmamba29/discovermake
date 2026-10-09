'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Heart, MessageCircleQuestion, Pause, Play, Share2, ShoppingBag } from 'lucide-react';
import type { ClaimSlotsResponse, PollView, ViewerClaim } from '@/contracts/live';
import { ButtonLink } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/state';
import { PageSkeleton } from '@/components/ui/skeleton';
import { ApiClientError, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { liveApi } from './live-api';
import { ChatList, Composer, PollCard, QuestionsList } from './live-chat';
import { ClaimSheet, ConfigureSheet, RemixSheet } from './live-sheets';
import { visibleChat } from './live-state';
import { LiveBadge } from './live-badge';
import { NowShowingCard, SlotCounter } from './now-showing';
import { useLiveShow } from './use-live-show';
import { VideoStage } from './video-stage';

/**
 * Live viewer (Whatnot live show pattern): full-screen vertical stage on phones with the
 * NOW SHOWING card, Build Slot counter, chat and composer over the video; two columns on
 * desktop. ENDED shows are shoppable replays: the event log folds in sync with the player.
 */
export function LiveViewer({ showId }: { showId: string }) {
    const live = useLiveShow(showId, { onEvent: (e) => e.event === 'drop.closed' && setTimeout(() => void live.refetch(), 300) });
    const token = useQuery({ queryKey: ['live-token', showId], queryFn: () => liveApi.token(showId), staleTime: 10 * 60_000, enabled: !!live.snapshot });
    const [sheet, setSheet] = useState<'configure' | 'remix' | 'claim' | null>(null);
    const [liked, setLiked] = useState<boolean | null>(null);
    const [following, setFollowing] = useState<boolean | null>(null);
    const [pollOverride, setPollOverride] = useState<PollView | null>(null);
    const [claims, setClaims] = useState<ViewerClaim[] | null>(null);
    const [viewerHeld, setViewerHeld] = useState<number | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const composerRef = useRef<HTMLInputElement>(null);

    const snapshot = live.snapshot;
    const state = live.state;
    useEffect(() => {
        if (snapshot) {
            setClaims(snapshot.viewerClaims);
            setViewerHeld(snapshot.drop?.viewerClaimedSlots ?? 0);
        }
    }, [snapshot]);

    const chat = useMemo(() => (state ? visibleChat(state) : []), [state]);

    if (live.isLoading) return <PageSkeleton label="Joining the show" />;
    if (live.error || !snapshot || !state) {
        const notFound = live.error instanceof ApiClientError && live.error.status === 404;
        return <ErrorState title={notFound ? 'Show not found' : 'Could not join the show'} message={notFound ? 'This show does not exist or was removed.' : errorMessage(live.error)} action={<ButtonLink href="/live">Back to Live</ButtonLink>} />;
    }

    const show = state.show;
    const signedIn = snapshot.viewerRole !== 'anonymous';
    const isHost = snapshot.viewerRole === 'host' || snapshot.viewerRole === 'cohost';
    const featured = state.featured;
    const drop = state.drop ? { ...state.drop, viewerClaimedSlots: viewerHeld ?? state.drop.viewerClaimedSlots } : null;
    const poll = pollOverride && state.poll && pollOverride.id === state.poll.id ? { ...state.poll, viewerVote: pollOverride.viewerVote } : state.poll;
    const isLiked = liked ?? snapshot.viewerLiked;
    const isFollowing = following ?? show.channel.viewerFollows;
    const source = token.data?.source ?? show.source;
    const held = drop?.viewerClaimedSlots ?? 0;
    const canClaim = !!drop && drop.status === 'OPEN' && signedIn && !live.isReplay && held < drop.perBuyerLimit;
    const claimHint = !drop || drop.status !== 'OPEN' ? null : !signedIn ? 'Sign in to claim a slot.' : held >= drop.perBuyerLimit ? `You hold the maximum of ${drop.perBuyerLimit} slots.` : null;
    const mutedReason = snapshot.viewerMutedUntil ? 'The host muted you for a while' : show.status === 'ENDED' ? 'Chat is closed for replays' : null;

    const like = async () => {
        if (!signedIn) return setNotice('Sign in to like this show.');
        try {
            await liveApi.like(showId);
            setLiked(true);
        } catch (err) {
            setNotice(errorMessage(err));
        }
    };
    const follow = async () => {
        if (!signedIn) return setNotice('Sign in to follow channels.');
        try {
            const r = await liveApi.follow(show.channel.handle, !isFollowing);
            setFollowing(r.following);
        } catch (err) {
            setNotice(errorMessage(err));
        }
    };
    const share = async () => {
        const url = window.location.href;
        try {
            if (navigator.share) await navigator.share({ title: show.title, url });
            else {
                await navigator.clipboard.writeText(url);
                setNotice('Link copied.');
            }
        } catch {
            // share sheet dismissed
        }
    };
    const onClaimed = (r: ClaimSlotsResponse) => {
        setViewerHeld(r.drop.viewerClaimedSlots);
        // The snapshot carries the viewer's claims with their signed order links.
        void live.refetch();
    };

    const replayControls = live.isReplay && source.kind !== 'mp4' && source.kind !== 'hls' ? <ReplayScrubber positionMs={live.positionMs} durationMs={live.replayDurationMs} onChange={live.setPositionMs} /> : null;

    return (
        <div
            className="grid w-full [grid-template-areas:'stage'_'below'] lg:h-[calc(100vh-4rem)] lg:[grid-template-areas:'stage_side'_'stage_below'] lg:grid-cols-[minmax(0,1fr)_420px] lg:grid-rows-[auto_minmax(0,1fr)] lg:overflow-hidden"
            data-testid="live-viewer"
            data-status={show.status}
        >
            {/* Stage */}
            <section className="relative h-[calc(100svh-4rem)] overflow-hidden bg-black [grid-area:stage] lg:h-full" aria-label="Live video">
                <VideoStage show={show} source={source} token={token.data ?? null} onTime={live.isReplay ? live.setPositionMs : undefined} />
                <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/80 to-transparent" aria-hidden />
                <header className="absolute inset-x-0 top-0 flex items-start gap-2 p-3">
                    <Link href="/live" className="pointer-events-auto rounded-full bg-black/60 p-2 text-white hover:bg-black/80" aria-label="Back to Live">
                        <ArrowLeft className="h-4 w-4" aria-hidden />
                    </Link>
                    <div className="min-w-0 flex-1">
                        <h1 className="truncate font-display text-base font-bold text-white sm:text-lg" data-testid="show-title">
                            {show.title}
                        </h1>
                        <p className="truncate text-xs text-white/80">
                            {show.channel.name} · <span className="font-mono">{show.displayId}</span>
                        </p>
                        <div className="mt-1.5 flex items-center gap-2">
                            <LiveBadge status={show.status} viewerCount={show.viewerCount} />
                        </div>
                    </div>
                    {!isHost && (
                        <button type="button" onClick={follow} className={cn('shrink-0 rounded-full px-3 py-1.5 text-xs font-bold', isFollowing ? 'bg-black/60 text-white ring-1 ring-white/40' : 'bg-white text-graphite-950')} data-testid="follow-button" aria-pressed={isFollowing}>
                            {isFollowing ? 'Following' : 'Follow'}
                        </button>
                    )}
                    {isHost && (
                        <Link href={`/studio/shows/${showId}`} className="shrink-0 rounded-full bg-white px-3 py-1.5 text-xs font-bold text-graphite-950">
                            Control room
                        </Link>
                    )}
                </header>

                {/* Right action rail */}
                <nav aria-label="Show actions" className="absolute right-2 top-[38%] flex flex-col items-center gap-3 lg:top-auto lg:bottom-6">
                    <RailButton label={`Like, ${show.likeCount} likes`} onClick={like} active={isLiked} testId="rail-like">
                        <Heart className={cn('h-5 w-5', isLiked && 'fill-current')} aria-hidden />
                        <span className="text-[11px] tabular">{show.likeCount}</span>
                    </RailButton>
                    <RailButton label="Ask a question" onClick={() => composerRef.current?.focus()} testId="rail-ask">
                        <MessageCircleQuestion className="h-5 w-5" aria-hidden />
                    </RailButton>
                    <RailButton label="Share this show" onClick={share} testId="rail-share">
                        <Share2 className="h-5 w-5" aria-hidden />
                    </RailButton>
                    {featured?.canBuy && featured.quoteId ? (
                        <Link href={`/checkout/${featured.quoteId}`} aria-label="Buy the product on screen" className="flex h-11 w-11 flex-col items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80" data-testid="rail-cart">
                            <ShoppingBag className="h-5 w-5" aria-hidden />
                        </Link>
                    ) : (
                        <RailButton label="Nothing to buy yet" onClick={() => setNotice('Nothing on screen can be bought yet.')} testId="rail-cart">
                            <ShoppingBag className="h-5 w-5" aria-hidden />
                        </RailButton>
                    )}
                </nav>
                {notice && (
                    <p className="absolute inset-x-3 top-24 z-10 rounded-lg bg-black/80 px-3 py-2 text-sm text-white" role="status" onClick={() => setNotice(null)}>
                        {notice}
                    </p>
                )}
            </section>

            {/* Overlay on phones, side column on desktop */}
            <div className="pointer-events-none z-10 self-end [grid-area:stage] lg:pointer-events-auto lg:self-stretch lg:overflow-y-auto lg:border-l lg:border-graphite-700 lg:bg-graphite-950 lg:p-4 lg:[grid-area:side]">
                <div className="pointer-events-auto space-y-2 bg-gradient-to-t from-black via-black/80 to-transparent px-3 pb-3 pr-16 pt-10 lg:bg-none lg:p-0 lg:pr-0">
                    <ChatList lines={chat.slice(-30)} className="max-h-28 lg:max-h-64" />
                    {replayControls}
                    <NowShowingCard featured={featured} onMakeMine={() => setSheet('configure')} onRemix={() => setSheet('remix')} compact />
                    {drop && <SlotCounter drop={drop} ending={state.dropEnding} onClaim={() => setSheet('claim')} canClaim={canClaim} claimHint={claimHint} />}
                    <Composer ref={composerRef} showId={showId} signedIn={signedIn} disabledReason={mutedReason} />
                </div>
            </div>

            {/* Below the fold on phones, lower side column on desktop */}
            <div className="space-y-3 p-3 [grid-area:below] lg:overflow-y-auto lg:border-l lg:border-t lg:border-graphite-700 lg:p-4" tabIndex={0} role="region" aria-label="Questions, polls and your slots">
                {claims && claims.length > 0 && <MyClaims claims={claims} />}
                {state.milestones.length > 0 && <Milestones events={state.milestones.map((m) => ({ seq: m.seq, label: m.event, note: (m.payload as { note?: string | null }).note ?? null }))} />}
                {poll && <PollCard poll={poll} showId={showId} signedIn={signedIn && !live.isReplay} onVoted={setPollOverride} />}
                <QuestionsList questions={state.questions} />
                <p className="text-xs text-fg-subtle">
                    {live.isReplay ? 'Shoppable replay: the product card and slot counter follow the recording.' : live.connected ? 'Connected · updates arrive live.' : 'Connecting to live updates…'}
                </p>
            </div>

            <ConfigureSheet open={sheet === 'configure'} onClose={() => setSheet(null)} featured={featured} />
            <RemixSheet open={sheet === 'remix'} onClose={() => setSheet(null)} featured={featured} />
            <ClaimSheet open={sheet === 'claim'} onClose={() => setSheet(null)} drop={drop} onClaimed={onClaimed} />
        </div>
    );
}

function RailButton({ label, onClick, active, testId, children }: { label: string; onClick: () => void; active?: boolean; testId: string; children: React.ReactNode }) {
    return (
        <button type="button" onClick={onClick} aria-label={label} className={cn('flex h-11 w-11 flex-col items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80', active && 'text-live')} data-testid={testId}>
            {children}
        </button>
    );
}

const MILESTONE_LABELS: Record<string, string> = {
    'machine.started': 'Machine started',
    'machine.completed': 'Machine finished',
    'inspection.passed': 'Inspection passed',
    'prototype.completed': 'Prototype complete',
};

function Milestones({ events }: { events: { seq: number; label: string; note: string | null }[] }) {
    return (
        <section aria-labelledby="milestones-heading" className="rounded-2xl bg-graphite-900 p-3 ring-1 ring-graphite-700" data-testid="milestones">
            <h2 id="milestones-heading" className="font-display text-base font-bold">
                On the factory floor
            </h2>
            <ul className="mt-1 space-y-1 text-sm text-fg-muted">
                {events.map((e) => (
                    <li key={e.seq}>
                        <span className="text-signal">●</span> {MILESTONE_LABELS[e.label] ?? e.label}
                        {e.note ? ` · ${e.note}` : ''}
                    </li>
                ))}
            </ul>
        </section>
    );
}

const CLAIM_LABEL: Record<ViewerClaim['status'], string> = {
    RESERVED: 'Held · authorize payment',
    AUTHORIZED: 'Authorized · charged if the drop succeeds',
    CAPTURED: 'Confirmed · in production',
    RELEASED: 'Released · nothing charged',
    EXPIRED: 'Expired · nothing charged',
};

function MyClaims({ claims }: { claims: ViewerClaim[] }) {
    return (
        <section aria-labelledby="claims-heading" className="rounded-2xl bg-graphite-900 p-3 ring-1 ring-graphite-700" data-testid="my-claims">
            <h2 id="claims-heading" className="font-display text-base font-bold">
                Your Build Slots
            </h2>
            <ul className="mt-2 space-y-1.5 text-sm">
                {claims.map((c) => (
                    <li key={c.claimId} className="flex flex-wrap items-center justify-between gap-2" data-testid="my-claim" data-status={c.status}>
                        <span className="text-fg">
                            {c.quantity} slot{c.quantity === 1 ? '' : 's'} · <span className="text-fg-muted">{CLAIM_LABEL[c.status]}</span>
                        </span>
                        {c.orderUrl && (
                            <a href={c.orderUrl} className="text-xs font-semibold text-fg underline underline-offset-2" data-testid="my-claim-order">
                                View order
                            </a>
                        )}
                    </li>
                ))}
            </ul>
        </section>
    );
}

function ReplayScrubber({ positionMs, durationMs, onChange }: { positionMs: number; durationMs: number; onChange: (ms: number) => void }) {
    const [playing, setPlaying] = useState(false);
    useEffect(() => {
        if (!playing) return;
        const t = setInterval(() => onChange(Math.min(durationMs, positionMs + 500)), 500);
        return () => clearInterval(t);
    }, [playing, positionMs, durationMs, onChange]);
    const fmt = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`;
    return (
        <div className="flex items-center gap-2 rounded-xl bg-graphite-900/90 p-2 ring-1 ring-graphite-700" data-testid="replay-scrubber">
            <button type="button" onClick={() => setPlaying((p) => !p)} className="rounded-lg p-1.5 text-fg hover:bg-graphite-800" aria-label={playing ? 'Pause replay' : 'Play replay'}>
                {playing ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
            </button>
            <label className="sr-only" htmlFor="replay-position">
                Replay position
            </label>
            <input id="replay-position" type="range" min={0} max={Math.max(1, durationMs)} step={500} value={Math.min(positionMs, durationMs)} onChange={(e) => onChange(Number(e.target.value))} className="min-w-0 flex-1 accent-[#5fe08a]" data-testid="replay-range" />
            <span className="font-mono text-xs tabular text-fg-muted">
                {fmt(positionMs)} / {fmt(durationMs)}
            </span>
        </div>
    );
}
