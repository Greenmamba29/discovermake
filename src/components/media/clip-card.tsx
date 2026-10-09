'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Play, Radio, ShoppingBag, Sparkles } from 'lucide-react';
import type { ClipCard } from '@/contracts/media';
import { errorMessage } from '@/lib/api';
import { money } from '@/lib/format';
import { cn } from '@/lib/utils';
import { logFeedEvents, mediaApi } from './media-api';

export const fmtClock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`;

/**
 * Plays the clip's time range of the replay (muted, looping inside the range). The player
 * seeks; nothing is transcoded. Reports the position inside the clip in ms.
 */
export function ClipVideo({ clip, playing, onPosition, className, controls = false }: { clip: ClipCard; playing: boolean; onPosition?: (ms: number) => void; className?: string; controls?: boolean }) {
    const ref = useRef<HTMLVideoElement>(null);
    const playable = clip.source.kind === 'mp4';
    const start = clip.startMs / 1000;
    const end = clip.endMs / 1000;

    useEffect(() => {
        const v = ref.current;
        if (!v || !playable) return;
        if (playing) {
            if (v.currentTime < start || v.currentTime >= end) v.currentTime = start;
            void v.play().catch(() => undefined);
        } else {
            v.pause();
        }
    }, [playing, playable, start, end]);

    if (!playable) {
        return (
            <div className={cn('flex aspect-[9/12] w-full flex-col items-center justify-center bg-[radial-gradient(ellipse_at_top,#202423,#0c0e0d_70%)] px-4 text-center', className)}>
                <Radio className="h-8 w-8 text-fg-subtle" aria-hidden />
                <p className="mt-2 text-xs text-fg-muted">Replay recording not available yet</p>
            </div>
        );
    }
    return (
        <video
            ref={ref}
            src={clip.source.kind === 'mp4' ? clip.source.url : undefined}
            muted
            playsInline
            preload="metadata"
            controls={controls}
            className={cn('aspect-[9/12] w-full bg-black object-cover', className)}
            aria-label={`${clip.title}, ${fmtClock(clip.startMs)} to ${fmtClock(clip.endMs)} of ${clip.showTitle}`}
            data-testid="clip-video"
            onLoadedMetadata={(e) => {
                if (e.currentTarget.currentTime < start) e.currentTarget.currentTime = start;
            }}
            onTimeUpdate={(e) => {
                const v = e.currentTarget;
                if (v.currentTime >= end || (v.duration && v.currentTime >= v.duration - 0.05)) {
                    v.currentTime = start;
                    if (!playing) v.pause();
                }
                onPosition?.(Math.max(0, Math.round((v.currentTime - start) * 1000)));
            }}
        />
    );
}

/** Make Mine (copy the design as your own build) / Buy chips for the product pinned on a clip. */
export function ClipProductChips({ clip, visible, compact = false }: { clip: ClipCard; visible: boolean; compact?: boolean }) {
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const b = clip.build;
    if (!b) return null;
    const makeMine = async () => {
        setBusy(true);
        setError(null);
        try {
            const made = await mediaApi.make(b.buildId, 'clone', clip.id);
            router.push(made.nextUrl);
        } catch (err) {
            setError(errorMessage(err));
            setBusy(false);
        }
    };
    return (
        <div className={cn('space-y-1.5 transition-opacity', visible ? 'opacity-100' : 'pointer-events-none opacity-0')} data-testid="clip-product" data-build-id={b.buildId} aria-hidden={!visible}>
            <p className={cn('truncate font-semibold text-white drop-shadow', compact ? 'text-xs' : 'text-sm')}>
                {b.title}
                {b.priceCents !== null ? ` · ${money(b.priceCents)}` : ''}
            </p>
            <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={makeMine} disabled={busy} tabIndex={visible ? 0 : -1} className="inline-flex min-h-[32px] items-center gap-1 rounded-full bg-signal px-3 text-xs font-bold text-signal-ink disabled:opacity-80" data-testid="clip-make-mine">
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />} Make Mine
                </button>
                {b.canBuy && b.quoteId && (
                    <Link href={`/checkout/${b.quoteId}`} tabIndex={visible ? 0 : -1} className="inline-flex min-h-[32px] items-center gap-1 rounded-full bg-white px-3 text-xs font-bold text-graphite-950" data-testid="clip-buy">
                        <ShoppingBag className="h-3.5 w-3.5" aria-hidden /> Buy
                    </Link>
                )}
            </div>
            {error && (
                <p className="rounded bg-black/70 px-2 py-1 text-xs text-white" role="alert">
                    {error}
                </p>
            )}
        </div>
    );
}

/** A clip in a feed: plays its range muted on hover / tap; the product is pinned at its timestamp. */
export function ClipCardView({ clip, tab, position }: { clip: ClipCard; tab?: string; position?: number }) {
    const [playing, setPlaying] = useState(false);
    const [posMs, setPosMs] = useState(0);
    const played = useRef(false);
    const titleId = `clip-card-${clip.id}`;
    const start = useCallback(() => {
        setPlaying(true);
        if (!played.current) {
            played.current = true;
            logFeedEvents([{ kind: 'play', itemKind: 'clip', itemId: clip.id, tab: (tab as never) ?? 'for_you', position }]);
        }
    }, [clip.id, tab, position]);
    const showProduct = !playing || posMs >= clip.productAtMs;
    return (
        <article
            className="mb-4 break-inside-avoid overflow-hidden rounded-2xl bg-graphite-900 ring-1 ring-graphite-700"
            aria-labelledby={titleId}
            data-testid="feed-clip"
            data-clip-id={clip.id}
            onMouseEnter={start}
            onMouseLeave={() => setPlaying(false)}
        >
            <div className="relative">
                <ClipVideo clip={clip} playing={playing} onPosition={setPosMs} />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/85 to-transparent" aria-hidden />
                <button
                    type="button"
                    onClick={() => (playing ? setPlaying(false) : start())}
                    className="absolute left-2 top-2 inline-flex min-h-[32px] items-center gap-1 rounded-full bg-black/65 px-2.5 text-xs font-semibold text-white"
                    aria-label={playing ? `Pause clip ${clip.title}` : `Play clip ${clip.title}`}
                    data-testid="clip-play"
                >
                    <Play className="h-3.5 w-3.5" aria-hidden /> {fmtClock(clip.endMs - clip.startMs)}
                </button>
                <div className="absolute inset-x-2 bottom-2">
                    <ClipProductChips clip={clip} visible={showProduct} compact />
                </div>
            </div>
            <Link href={`/clips/${clip.id}`} className="block p-3" data-testid="clip-open">
                <h3 id={titleId} className="font-display text-sm font-bold text-fg">
                    {clip.title}
                </h3>
                <p className="mt-0.5 text-xs text-fg-muted">
                    {clip.channel.name} · {clip.showDisplayId}
                </p>
            </Link>
        </article>
    );
}
