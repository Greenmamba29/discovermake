'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LiveEvent, ShowSnapshot } from '@/contracts/live';
import { liveApi } from './live-api';
import { applyEvent, parseLiveEvent, replayAt, replayBase, stateFromSnapshot, type LiveState } from './live-state';

const BUFFER = 500;

/**
 * Snapshot on join, then the Server-Sent Events stream (`EventSource` reconnects on its own
 * and resumes with Last-Event-ID). Events are buffered so a refetched snapshot is re-folded
 * with anything that arrived after it. ENDED shows replay their log at `positionMs`.
 */
export function useLiveShow(showId: string, opts: { onEvent?: (e: LiveEvent) => void } = {}) {
    const snapshotQuery = useQuery({ queryKey: ['live-snapshot', showId], queryFn: () => liveApi.snapshot(showId) });
    const snapshot = snapshotQuery.data;
    const [live, setLive] = useState<LiveState | null>(null);
    const [positionMs, setPositionMs] = useState(0);
    const [connected, setConnected] = useState(false);
    const buffer = useRef<LiveEvent[]>([]);
    const onEvent = useRef(opts.onEvent);
    onEvent.current = opts.onEvent;

    const isReplay = snapshot?.show.status === 'ENDED' || snapshot?.show.status === 'CANCELLED';

    // (Re)build from each snapshot, re-folding buffered events that are newer than it.
    useEffect(() => {
        if (!snapshot || isReplay) return;
        let s = stateFromSnapshot(snapshot);
        for (const e of buffer.current) s = applyEvent(s, e);
        setLive(s);
    }, [snapshot, isReplay]);

    const lastSeqAtSnapshot = snapshot?.lastSeq ?? 0;
    const follow = !!snapshot && !isReplay;

    useEffect(() => {
        if (!follow) return;
        const receive = (raw: unknown) => {
            const e = parseLiveEvent(raw);
            if (!e) return;
            buffer.current = [...buffer.current.filter((b) => b.seq !== e.seq), e].slice(-BUFFER);
            setLive((prev) => (prev ? applyEvent(prev, e) : prev));
            onEvent.current?.(e);
        };
        if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') {
            let after = lastSeqAtSnapshot;
            let stopped = false;
            const tick = async () => {
                if (stopped) return;
                try {
                    const r = await liveApi.eventsSince(showId, after);
                    r.events.forEach(receive);
                    after = r.lastSeq;
                    setConnected(true);
                } catch {
                    setConnected(false);
                }
                if (!stopped) setTimeout(tick, 2000);
            };
            void tick();
            return () => {
                stopped = true;
            };
        }
        const es = new EventSource(`/api/live/shows/${encodeURIComponent(showId)}/events?after=${lastSeqAtSnapshot}`);
        es.onopen = () => setConnected(true);
        es.onerror = () => setConnected(false);
        es.onmessage = (msg) => {
            try {
                receive(JSON.parse(msg.data));
            } catch {
                // ignore malformed frames
            }
        };
        return () => es.close();
        // Reconnect only when the show or the following mode changes; resumes use Last-Event-ID.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showId, follow]);

    const replay = useMemo(() => {
        if (!snapshot || !isReplay) return null;
        return replayAt(replayBase(snapshot), snapshot.replayEvents ?? [], positionMs);
    }, [snapshot, isReplay, positionMs]);

    const replayDurationMs = useMemo(() => {
        const events = snapshot?.replayEvents ?? [];
        const last = events.length ? events[events.length - 1].streamTsMs : 0;
        const show = snapshot?.show;
        const span = show?.startedAt && show.endedAt ? new Date(show.endedAt).getTime() - new Date(show.startedAt).getTime() : 0;
        return Math.max(last, span);
    }, [snapshot]);

    const refetch = useCallback(() => snapshotQuery.refetch(), [snapshotQuery]);

    return {
        snapshot: snapshot as ShowSnapshot | undefined,
        state: isReplay ? replay : live,
        isReplay,
        positionMs,
        setPositionMs,
        replayDurationMs,
        connected,
        isLoading: snapshotQuery.isLoading,
        error: snapshotQuery.error,
        refetch,
    };
}
