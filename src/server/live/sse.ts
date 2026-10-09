/**
 * GET /api/live/shows/:id/events?after=<seq>
 *
 * Server-Sent Events: one `data:` frame per LiveEvent with `id: <seq>`, so the browser's
 * automatic reconnect resumes from `Last-Event-ID` (which wins over `after`). The stream polls
 * the log about once a second, sends a heartbeat comment every 15 s, and closes after about
 * 5 minutes so clients reconnect (and proxies never hold one connection forever).
 * `?format=json` answers the new events as JSON for polling clients and tests.
 *
 * Upgrade path (documented in docs/architecture/r4-live.md): Postgres LISTEN/NOTIFY or
 * LiveKit data tracks for push; the payload and seq semantics stay the same.
 */
import { randomUUID } from 'node:crypto';
import type { LiveEvent } from '../../contracts/live';
import { listLiveEvents } from './events';
import { dropPresence, refreshViewerCount, touchPresence } from './presence';

export const SSE_POLL_MS = 1_000;
export const SSE_HEARTBEAT_MS = 15_000;
export const SSE_LIFETIME_MS = 5 * 60_000;

export type LiveStreamOptions = {
    pollMs?: number;
    heartbeatMs?: number;
    lifetimeMs?: number;
    /** Presence key (user id); anonymous streams get a random one. Null disables presence (tests, replays). */
    presenceKey?: string | null;
    signal?: AbortSignal;
};

/** Resume point: Last-Event-ID (browser reconnect) wins over `?after=`. */
export function resumeSeq(request: Request): number {
    const header = request.headers.get('last-event-id');
    const fromHeader = header !== null && /^\d{1,10}$/.test(header.trim()) ? Number(header.trim()) : null;
    if (fromHeader !== null) return fromHeader;
    const after = new URL(request.url).searchParams.get('after');
    return after && /^\d{1,10}$/.test(after) ? Number(after) : 0;
}

export function formatSseEvent(e: LiveEvent): string {
    return `id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        if (signal?.aborted) return resolve();
        const t = setTimeout(done, ms);
        function done() {
            clearTimeout(t);
            signal?.removeEventListener('abort', done);
            resolve();
        }
        signal?.addEventListener('abort', done, { once: true });
    });
}

export function liveEventStream(showId: string, after: number, opts: LiveStreamOptions = {}): ReadableStream<Uint8Array> {
    const pollMs = opts.pollMs ?? SSE_POLL_MS;
    const heartbeatMs = opts.heartbeatMs ?? SSE_HEARTBEAT_MS;
    const lifetimeMs = opts.lifetimeMs ?? SSE_LIFETIME_MS;
    const presenceKey = opts.presenceKey === undefined ? `anon:${randomUUID()}` : opts.presenceKey;
    const encoder = new TextEncoder();
    const stop = new AbortController();
    opts.signal?.addEventListener('abort', () => stop.abort(), { once: true });

    return new ReadableStream<Uint8Array>({
        async start(controller) {
            const send = (text: string) => {
                if (stop.signal.aborted) return;
                try {
                    controller.enqueue(encoder.encode(text));
                } catch {
                    stop.abort();
                }
            };
            let last = after;
            const startedAt = Date.now();
            let lastBeat = startedAt;
            let lastPresence = 0;
            send(`retry: 2000\n: connected after ${after}\n\n`);
            try {
                while (!stop.signal.aborted && Date.now() - startedAt < lifetimeMs) {
                    const events = await listLiveEvents(showId, { after: last, limit: 200 });
                    for (const e of events) {
                        send(formatSseEvent(e));
                        last = e.seq;
                    }
                    const now = Date.now();
                    if (presenceKey && now - lastPresence >= heartbeatMs) {
                        lastPresence = now;
                        await touchPresence(showId, presenceKey).catch(() => undefined);
                        await refreshViewerCount(showId).catch(() => undefined);
                    }
                    if (now - lastBeat >= heartbeatMs) {
                        lastBeat = now;
                        send(`: heartbeat ${new Date(now).toISOString()}\n\n`);
                    }
                    await sleep(pollMs, stop.signal);
                }
            } catch (err) {
                console.error(`[live] event stream for ${showId} failed`, err);
                send(`: error, reconnect\n\n`);
            } finally {
                if (presenceKey?.startsWith('anon:')) await dropPresence(showId, presenceKey).catch(() => undefined);
                stop.abort();
                try {
                    controller.close();
                } catch {
                    // already closed by the client
                }
            }
        },
        cancel() {
            stop.abort();
        },
    });
}

export const SSE_HEADERS: Record<string, string> = {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
};
