'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Scissors } from 'lucide-react';
import type { ClipSuggestion } from '@/contracts/media';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/state';
import { errorMessage } from '@/lib/api';
import { fmtClock } from './clip-card';
import { mediaApi } from './media-api';

/** Clip Moment for an ended show: suggested windows from the event log, one tap to publish a clip. */
export function ClipStudio({ showId }: { showId: string }) {
    const clips = useQuery({ queryKey: ['show-clips', showId], queryFn: () => mediaApi.showClips(showId) });
    const data = clips.data;
    return (
        <section aria-labelledby="clip-studio-heading" className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700" data-testid="clip-studio">
            <h2 id="clip-studio-heading" className="flex items-center gap-2 font-display text-lg font-bold">
                <Scissors className="h-5 w-5 text-fg-muted" aria-hidden /> Clips from the replay
            </h2>
            <p className="mt-1 text-sm text-fg-muted">Each product moment and drop is suggested from the show&apos;s event log. Clips point into the replay with the product pinned, and appear in Discover and on your channel.</p>
            {clips.error && <Notice tone="error">{errorMessage(clips.error)}</Notice>}
            {data && data.clips.length > 0 && (
                <ul className="mt-3 space-y-1.5 text-sm" aria-label="Published clips">
                    {data.clips.map((c) => (
                        <li key={c.id} className="flex items-center justify-between gap-2" data-testid="published-clip">
                            <Link href={`/clips/${c.id}`} className="truncate font-semibold text-fg underline-offset-2 hover:underline">
                                {c.title}
                            </Link>
                            <span className="shrink-0 font-mono text-xs text-fg-subtle">
                                {fmtClock(c.startMs)}–{fmtClock(c.endMs)} · {c.origin === 'system' ? 'auto' : 'yours'}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
            {data && (
                <ul className="mt-3 space-y-2">
                    {data.suggestions.length === 0 && <li className="text-sm text-fg-muted">No product moments in this show yet.</li>}
                    {data.suggestions.map((s) => (
                        <SuggestionRow key={s.eventSeq} showId={showId} s={s} onCreated={() => void clips.refetch()} />
                    ))}
                </ul>
            )}
        </section>
    );
}

function SuggestionRow({ showId, s, onCreated }: { showId: string; s: ClipSuggestion; onCreated: () => void }) {
    const [title, setTitle] = useState(s.title);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const create = async () => {
        setBusy(true);
        setError(null);
        try {
            await mediaApi.createClip(showId, { startMs: s.startMs, endMs: s.endMs, title, buildId: s.buildId });
            onCreated();
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(false);
        }
    };
    const inputId = `clip-title-${s.eventSeq}`;
    return (
        <li className="rounded-xl bg-graphite-850 p-3 ring-1 ring-graphite-700" data-testid="clip-suggestion" data-reason={s.reason}>
            <p className="font-mono text-xs text-fg-subtle">
                {fmtClock(s.startMs)}–{fmtClock(s.endMs)} · {s.reason}
            </p>
            <div className="mt-2 flex gap-2">
                <label htmlFor={inputId} className="sr-only">
                    Clip title
                </label>
                <input id={inputId} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} className="h-10 min-w-0 flex-1 rounded-lg bg-graphite-800 px-3 text-sm text-fg ring-1 ring-inset ring-graphite-600 focus:outline-none focus:ring-2 focus:ring-signal" data-testid="clip-suggestion-title" />
                <Button size="sm" onClick={create} loading={busy} data-testid="clip-create">
                    Create clip
                </Button>
            </div>
            {error && <p className="mt-1 text-xs text-ember">{error}</p>}
        </li>
    );
}
