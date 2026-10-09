'use client';

import { useEffect, useRef, useState } from 'react';
import { Radio, VolumeX } from 'lucide-react';
import type { LiveTokenResponse, ShowView, VideoSource } from '@/contracts/live';
import { cn } from '@/lib/utils';

/**
 * The video area. Commerce never goes into the video (ADR-0003): everything shoppable is an
 * overlay rendered by the page from Live Build Protocol events.
 *
 *   livekit  livekit-client, subscribe-only for viewers (token from /token)
 *   hls      native HLS (Safari) or hls.js
 *   mp4      <video> (replays); `onTime` drives the shoppable replay
 *   none     a poster with a plain status line
 */
export function VideoStage({
    show,
    source,
    token,
    onTime,
    className,
}: {
    show: ShowView;
    source: VideoSource;
    token: LiveTokenResponse | null;
    onTime?: (ms: number) => void;
    className?: string;
}) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const audioRef = useRef<HTMLAudioElement>(null);
    const [muted, setMuted] = useState(true);
    const [problem, setProblem] = useState<string | null>(null);

    // LiveKit
    useEffect(() => {
        if (source.kind !== 'livekit' || !token?.livekit) return;
        let cancelled = false;
        let disconnect: (() => void) | null = null;
        (async () => {
            try {
                const { Room, RoomEvent, Track } = await import('livekit-client');
                const room = new Room({ adaptiveStream: true, dynacast: true });
                room.on(RoomEvent.TrackSubscribed, (track) => {
                    if (track.kind === Track.Kind.Video && videoRef.current) track.attach(videoRef.current);
                    if (track.kind === Track.Kind.Audio && audioRef.current) track.attach(audioRef.current);
                });
                await room.connect(token.livekit!.url, token.livekit!.token);
                if (cancelled) await room.disconnect();
                else disconnect = () => void room.disconnect();
            } catch {
                if (!cancelled) setProblem('The live video could not connect. The shop overlay keeps working.');
            }
        })();
        return () => {
            cancelled = true;
            disconnect?.();
        };
    }, [source.kind, token]);

    // HLS
    useEffect(() => {
        if (source.kind !== 'hls' || !videoRef.current) return;
        const video = videoRef.current;
        let destroy: (() => void) | null = null;
        if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = source.url;
        } else {
            void import('hls.js').then(({ default: Hls }) => {
                if (!Hls.isSupported()) {
                    setProblem('This browser cannot play the live video.');
                    return;
                }
                const hls = new Hls({ lowLatencyMode: true });
                hls.loadSource(source.url);
                hls.attachMedia(video);
                hls.on(Hls.Events.ERROR, (_e, data) => {
                    if (data.fatal) setProblem('The live video stopped. Reconnecting may help.');
                });
                destroy = () => hls.destroy();
            });
        }
        return () => destroy?.();
    }, [source]);

    const statusLine =
        show.status === 'SCHEDULED'
            ? `Starts ${new Date(show.scheduledFor).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`
            : show.status === 'LIVE'
              ? 'Live now · no video source is connected, the shop overlay is live'
              : 'Replay · no recording for this show, the event log replays below';

    return (
        <div className={cn('relative h-full w-full overflow-hidden bg-graphite-950', className)} data-testid="video-stage" data-source={source.kind}>
            {source.kind === 'none' ? (
                <div className="flex h-full w-full flex-col items-center justify-center bg-[radial-gradient(ellipse_at_top,#202423,#0c0e0d_70%)] px-6 text-center">
                    <Radio className="h-10 w-10 text-fg-subtle" aria-hidden />
                    <p className="mt-3 max-w-xs text-sm text-fg-muted" data-testid="video-status">
                        {statusLine}
                    </p>
                </div>
            ) : (
                <>
                    <video
                        ref={videoRef}
                        className="h-full w-full object-cover lg:object-contain"
                        src={source.kind === 'mp4' ? source.url : undefined}
                        autoPlay
                        playsInline
                        muted={muted}
                        loop={false}
                        controls={source.kind === 'mp4'}
                        onTimeUpdate={(e) => onTime?.(Math.round(e.currentTarget.currentTime * 1000))}
                        onSeeked={(e) => onTime?.(Math.round(e.currentTarget.currentTime * 1000))}
                        aria-label={`${show.title} video`}
                        data-testid="video-element"
                    />
                    <audio ref={audioRef} autoPlay muted={muted} />
                    {muted && source.kind !== 'mp4' && (
                        <button type="button" onClick={() => setMuted(false)} className="absolute left-3 top-16 inline-flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-xs font-semibold text-white">
                            <VolumeX className="h-3.5 w-3.5" aria-hidden /> Tap to unmute
                        </button>
                    )}
                </>
            )}
            {problem && (
                <p className="absolute inset-x-3 top-16 rounded-lg bg-black/75 px-3 py-2 text-xs text-white" role="status">
                    {problem}
                </p>
            )}
        </div>
    );
}
