/**
 * Live Build Protocol against a real database: seq assignment under concurrency, signatures
 * on persisted events, host-only intents, late-joiner snapshots and the SSE endpoint.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { LiveEvent } from '@/contracts/live';
import { GET as eventsRoute } from '@/app/api/live/shows/[showId]/events/route';
import { POST as intentsRoute } from '@/app/api/live/shows/[showId]/intents/route';
import { POST as chatRoute } from '@/app/api/live/shows/[showId]/chat/route';
import { GET as snapshotRoute } from '@/app/api/live/shows/[showId]/route';
import { domainEvents, liveEvents } from '@/server/db/schema';
import { appendLiveEvent, buildSnapshot, handleIntent, liveEventStream, loadShowAccess, resetLiveRateLimits, verifyLiveEvent } from '@/server/live';
import { useTestDb } from '../support/db';
import { quietConsole } from '../orders/fixtures';
import { req, setupShow, makeUser } from './fixtures';

vi.mock('@/server/dispatch', async (orig) => ({ ...(await orig<typeof import('@/server/dispatch')>()), dispatchOrder: async () => null }));

const params = (showId: string) => ({ params: Promise.resolve({ showId }) });

async function readSse(res: Response, until: (frames: string[]) => boolean, timeoutMs = 5000): Promise<string[]> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const frames: string[] = [];
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !until(frames)) {
        const chunk = await Promise.race([reader.read(), new Promise<{ done: true; value: undefined }>((r) => setTimeout(() => r({ done: true, value: undefined }), Math.max(1, deadline - Date.now())))]);
        if (chunk.done) break;
        buf += decoder.decode(chunk.value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
            frames.push(buf.slice(0, i));
            buf = buf.slice(i + 2);
        }
    }
    await reader.cancel().catch(() => undefined);
    return frames;
}

function dataFrames(frames: string[]): LiveEvent[] {
    return frames.filter((f) => f.includes('data: ')).map((f) => JSON.parse(f.split('\n').find((l) => l.startsWith('data: '))!.slice(6)) as LiveEvent);
}

describe('Live Build Protocol', () => {
    const ctx = useTestDb({ seed: true });
    beforeAll(async () => {
        quietConsole();
        await resetLiveRateLimits();
    });

    it('assigns a gap-free, monotonic seq per show under concurrent appends', async () => {
        const { show } = await setupShow(ctx.db);
        const before = (await ctx.db.select().from(liveEvents).where(eq(liveEvents.showId, show.id))).length;
        const results = await Promise.all(
            Array.from({ length: 25 }, (_, i) => appendLiveEvent(show.id, { event: 'chat.message', actor: { kind: 'viewer', id: `usr_v${i}`, name: null }, payload: { text: `hi ${i}` } })),
        );
        const seqs = results.map((r) => r.seq).sort((a, b) => a - b);
        expect(new Set(seqs).size).toBe(25);
        const rows = await ctx.db.select().from(liveEvents).where(eq(liveEvents.showId, show.id));
        const all = rows.map((r) => r.seq).sort((a, b) => a - b);
        expect(all).toEqual(Array.from({ length: before + 25 }, (_, i) => i + 1));
    });

    it('signs server events (show.started, product.focus) with a valid stored signature, and mirrors them to the outbox', async () => {
        const { show, fixture, hostAccess } = await setupShow(ctx.db);
        const { event } = await handleIntent(await hostAccess(), { intent: 'feature_product', buildId: fixture.build.id });
        expect(event?.event).toBe('product.focus');
        expect(event?.sig).toBeTruthy();
        const rows = await ctx.db.select().from(liveEvents).where(eq(liveEvents.showId, show.id));
        const stored = rows.map((r) => ({ event: r.event, sig: r.sig, seq: r.seq }));
        expect(stored.find((r) => r.event === 'show.started')?.sig).toBeTruthy();
        const res = await eventsRoute(req(`/api/live/shows/${show.id}/events?after=0&format=json`), params(show.id));
        const body = (await res.json()) as { events: LiveEvent[] };
        for (const e of body.events) expect(verifyLiveEvent(e)).toBe(true);
        const focus = body.events.find((e) => e.event === 'product.focus')!;
        expect(focus.payload).toMatchObject({ buildId: fixture.build.id, canBuy: true, priceCents: 500, quoteId: fixture.quote.id });
        const mirrored = await ctx.db.select().from(domainEvents).where(eq(domainEvents.correlationId, show.id));
        expect(mirrored.map((m) => m.eventType)).toEqual(expect.arrayContaining(['live.show_started', 'live.product_featured']));
    });

    it('viewers cannot send intents (403), signed out is 401, and nothing is appended', async () => {
        const { show, fixture } = await setupShow(ctx.db);
        const count = async () => (await ctx.db.select().from(liveEvents).where(eq(liveEvents.showId, show.id))).length;
        const n = await count();
        const viewer = await makeUser('viewer');
        for (const intent of [{ intent: 'feature_product', buildId: fixture.build.id }, { intent: 'end_show' }, { intent: 'close_drop' }]) {
            const r = await intentsRoute(req(`/api/live/shows/${show.id}/intents`, { body: intent, user: viewer }), params(show.id));
            expect(r.status).toBe(403);
        }
        const anon = await intentsRoute(req(`/api/live/shows/${show.id}/intents`, { body: { intent: 'end_show' } }), params(show.id));
        expect(anon.status).toBe(401);
        expect(await count()).toBe(n);
        // Even server code refuses to sign a commerce event on behalf of a viewer.
        await expect(appendLiveEvent(show.id, { event: 'product.focus', actor: { kind: 'viewer', id: viewer.id, name: null }, payload: {} })).rejects.toThrow(/server-signed/);
    });

    it('builds a snapshot with the last focus, recent chat minus removed lines, questions and lastSeq', async () => {
        const { show, fixture, hostAccess, host } = await setupShow(ctx.db);
        await handleIntent(await hostAccess(), { intent: 'feature_product', buildId: fixture.build.id });
        const viewer = await makeUser('snap');
        const c1 = await chatRoute(req(`/api/live/shows/${show.id}/chat`, { body: { text: 'first!' }, user: viewer }), params(show.id));
        expect(c1.status).toBe(201);
        const first = ((await c1.json()) as { event: LiveEvent }).event;
        await chatRoute(req(`/api/live/shows/${show.id}/chat`, { body: { text: 'does it come in black?' }, user: viewer }), params(show.id));
        await handleIntent(await hostAccess(), { intent: 'remove_chat', eventSeq: first.seq });

        const res = await snapshotRoute(req(`/api/live/shows/${show.id}`, { user: viewer }), params(show.id));
        expect(res.status).toBe(200);
        const snap = await res.json();
        expect(snap.featured).toMatchObject({ buildId: fixture.build.id, canBuy: true });
        expect(snap.recentChat.map((e: LiveEvent) => e.payload.text)).toEqual(['does it come in black?']);
        expect(snap.viewerRole).toBe('viewer');
        expect(snap.show.status).toBe('LIVE');
        expect(snap.show.displayId).toMatch(/^LIVE-\d+$/);
        const maxSeq = Math.max(...(await ctx.db.select().from(liveEvents).where(eq(liveEvents.showId, show.id))).map((r) => r.seq));
        expect(snap.lastSeq).toBe(maxSeq);
        const hostSnap = await buildSnapshot(await loadShowAccess(req('/', { user: host }), show.id));
        expect(hostSnap.viewerRole).toBe('host');
    });

    it('SSE emits only events after `after`, with id = seq, and Last-Event-ID wins on reconnect', async () => {
        const { show } = await setupShow(ctx.db);
        for (let i = 0; i < 4; i++) await appendLiveEvent(show.id, { event: 'chat.message', actor: { kind: 'viewer', id: 'usr_sse1', name: null }, payload: { text: `m${i}` } });
        const rows = await ctx.db.select().from(liveEvents).where(eq(liveEvents.showId, show.id));
        const last = Math.max(...rows.map((r) => r.seq));

        const controller = new AbortController();
        const res = await eventsRoute(req(`/api/live/shows/${show.id}/events?after=${last - 2}`, { signal: controller.signal }), params(show.id));
        expect(res.headers.get('content-type')).toContain('text/event-stream');
        const frames = await readSse(res, (f) => dataFrames(f).length >= 2);
        controller.abort();
        const got = dataFrames(frames);
        expect(got.map((e) => e.seq)).toEqual([last - 1, last]);
        expect(frames.find((f) => f.includes(`id: ${last}\n`))).toBeTruthy();
        expect(frames[0]).toContain('retry: 2000');

        // Reconnect with Last-Event-ID (the browser keeps the original ?after=0 URL).
        const c2 = new AbortController();
        const res2 = await eventsRoute(req(`/api/live/shows/${show.id}/events?after=0`, { headers: { 'last-event-id': String(last - 1) }, signal: c2.signal }), params(show.id));
        const appended = appendLiveEvent(show.id, { event: 'chat.message', actor: { kind: 'viewer', id: 'usr_sse1', name: null }, payload: { text: 'live one' } });
        const frames2 = await readSse(res2, (f) => dataFrames(f).length >= 2);
        c2.abort();
        await appended;
        expect(dataFrames(frames2).map((e) => e.seq)).toEqual([last, last + 1]);
    });

    it('streams heartbeats and closes after its lifetime', async () => {
        const { show } = await setupShow(ctx.db);
        const stream = liveEventStream(show.id, 0, { pollMs: 20, heartbeatMs: 30, lifetimeMs: 150, presenceKey: null });
        const frames = await readSse(new Response(stream), () => false, 2000);
        expect(frames.some((f) => f.startsWith(': heartbeat'))).toBe(true);
        expect(dataFrames(frames).length).toBeGreaterThan(0);
    });
});
