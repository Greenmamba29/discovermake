'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Pause, Play, Share2 } from 'lucide-react';
import type { ClipCard } from '@/contracts/media';
import { ButtonLink } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/state';
import { PageSkeleton } from '@/components/ui/skeleton';
import { ApiClientError, errorMessage } from '@/lib/api';
import { ClipProductChips, ClipVideo, fmtClock } from './clip-card';
import { logFeedEvents, mediaApi } from './media-api';

/** `/clips/:clipId`: a shoppable clip (TikTok-style vertical player; the product pins at its timestamp). */
export function ClipPlayer({ clipId }: { clipId: string }) {
    const clip = useQuery({ queryKey: ['media-clip', clipId], queryFn: () => mediaApi.clip(clipId), retry: false });
    if (clip.isLoading) return <PageSkeleton label="Loading the clip" />;
    if (clip.error || !clip.data) {
        const notFound = clip.error instanceof ApiClientError && clip.error.status === 404;
        return <ErrorState title={notFound ? 'Clip not found' : 'Could not load the clip'} message={notFound ? 'This clip was removed or the link is wrong.' : errorMessage(clip.error)} action={<ButtonLink href="/discover">Back to Discover</ButtonLink>} />;
    }
    return <Player clip={clip.data} />;
}

function Player({ clip }: { clip: ClipCard }) {
    const [playing, setPlaying] = useState(true);
    const [posMs, setPosMs] = useState(0);
    const [notice, setNotice] = useState<string | null>(null);
    const logged = useRef(false);
    useEffect(() => {
        if (logged.current) return;
        logged.current = true;
        logFeedEvents([{ kind: 'play', itemKind: 'clip', itemId: clip.id, tab: 'clip_page' }]);
    }, [clip.id]);
    const replayHref = `/live/${clip.showId}?t=${Math.floor(clip.startMs / 1000)}`;
    const share = async () => {
        const url = window.location.href;
        try {
            if (navigator.share) await navigator.share({ title: clip.title, url });
            else {
                await navigator.clipboard.writeText(url);
                setNotice('Link copied.');
            }
        } catch {
            // dismissed
        }
    };
    return (
        <div className="mx-auto grid w-full max-w-5xl gap-6 px-4 pb-16 pt-6 sm:px-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]" data-testid="clip-player" data-clip-id={clip.id}>
            <div className="relative overflow-hidden rounded-2xl bg-black ring-1 ring-graphite-700">
                <ClipVideo clip={clip} playing={playing} onPosition={setPosMs} className="max-h-[75svh]" />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-black/90 to-transparent" aria-hidden />
                <button type="button" onClick={() => setPlaying((p) => !p)} className="absolute left-3 top-3 inline-flex min-h-[36px] items-center gap-1.5 rounded-full bg-black/65 px-3 text-xs font-semibold text-white" data-testid="clip-toggle" aria-label={playing ? 'Pause clip' : 'Play clip'}>
                    {playing ? <Pause className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
                    {fmtClock(Math.min(posMs, clip.endMs - clip.startMs))} / {fmtClock(clip.endMs - clip.startMs)}
                </button>
                <div className="absolute inset-x-3 bottom-3">
                    <ClipProductChips clip={clip} visible={posMs >= clip.productAtMs || !playing} />
                </div>
            </div>
            <div className="min-w-0">
                <p className="eyebrow">Clip · {clip.showDisplayId}</p>
                <h1 className="mt-1 font-display font-wide text-2xl font-extrabold sm:text-3xl">{clip.title}</h1>
                <p className="mt-1 text-sm text-fg-muted">
                    From{' '}
                    <Link href={`/c/${clip.channel.handle}`} className="font-semibold text-fg underline-offset-2 hover:underline">
                        {clip.channel.name}
                    </Link>
                    ’s show “{clip.showTitle}”, {fmtClock(clip.startMs)}–{fmtClock(clip.endMs)}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                    <ButtonLink href={replayHref} variant="secondary" size="sm" data-testid="clip-replay-link">
                        Watch the full replay from {fmtClock(clip.startMs)}
                    </ButtonLink>
                    {clip.build?.published && (
                        <ButtonLink href={`/b/${clip.build.buildId}`} variant="secondary" size="sm" data-testid="clip-build-link">
                            Build page · remix
                        </ButtonLink>
                    )}
                    <button type="button" onClick={share} className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-fg-muted hover:bg-graphite-800 hover:text-fg">
                        <Share2 className="h-4 w-4" aria-hidden /> Share
                    </button>
                </div>
                {notice && (
                    <p className="mt-2 text-sm text-fg-muted" role="status">
                        {notice}
                    </p>
                )}
                {clip.build && (
                    <section aria-labelledby="clip-product-heading" className="mt-6 rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700">
                        <h2 id="clip-product-heading" className="font-display text-lg font-bold">
                            On screen
                        </h2>
                        <p className="mt-1 text-sm text-fg-muted">
                            {clip.build.title} · <span className="font-mono">{clip.build.displayId}</span>
                        </p>
                        <p className="mt-2 text-sm text-fg-muted">Make Mine copies the design to your own build so you can configure it and order it; the creator earns a royalty on your order.</p>
                    </section>
                )}
            </div>
        </div>
    );
}
