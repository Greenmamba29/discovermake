'use client';

/** View-only Live: the video and the title. No chat, questions, polls, likes or shopping. */
import { useQuery } from '@tanstack/react-query';
import type { LiveTokenResponse, ShowView } from '@/contracts/live';
import { VideoStage } from '@/components/live/video-stage';
import { apiFetch, errorMessage } from '@/lib/api';

export function KidLiveViewer({ showId }: { showId: string }) {
    const q = useQuery({ queryKey: ['kid-live', showId], queryFn: () => apiFetch<{ show: ShowView; token: LiveTokenResponse }>(`/api/kids/live/${encodeURIComponent(showId)}`) });
    if (q.isPending) return <p className="text-lg font-bold text-ink-muted">Loading…</p>;
    if (q.isError) return <p className="text-lg font-bold text-ink">{errorMessage(q.error)}</p>;
    const { show, token } = q.data;
    return (
        <div className="flex flex-col gap-3" data-testid="kid-live-viewer">
            <h2 className="text-xl font-extrabold text-ink">{show.title}</h2>
            <div className="overflow-hidden rounded-3xl bg-ink">
                <VideoStage show={show} source={token.source} token={token} className="aspect-video w-full" />
            </div>
        </div>
    );
}
