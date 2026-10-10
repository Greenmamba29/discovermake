/**
 * The optional Live demo seed: a factory channel with an ENDED show whose replay is the
 * committed WebM fixture, a signed event log, and a snapshot that serves the whole log.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GET as snapshotRoute } from '@/app/api/live/shows/[showId]/route';
import { GET as homeRoute } from '@/app/api/live/route';
import { LIVE_DEMO_REPLAY_URL, seedLiveDemo } from '@/server/db/seed-live';
import { DEV_SHOP_ID } from '@/server/db/seed';
import { verifyLiveEvent } from '@/server/live';
import { useTestDb } from '../support/db';
import { req } from './fixtures';

describe('Live demo seed', () => {
    const ctx = useTestDb({ seed: { liveDemo: true } });

    it('seeds one replay with a committed video and a signed log, idempotently', async () => {
        expect(existsSync(path.join(process.cwd(), 'public', LIVE_DEMO_REPLAY_URL))).toBe(true);
        const again = await seedLiveDemo(ctx.db, { shopId: DEV_SHOP_ID });
        expect(again).not.toBeNull();

        const home = await (await homeRoute(req('/api/live'), { params: Promise.resolve({}) })).json();
        expect(home.replays).toHaveLength(1);
        expect(home.replays[0]).toMatchObject({ status: 'ENDED', source: { kind: 'mp4', url: LIVE_DEMO_REPLAY_URL }, channel: { kind: 'factory' } });

        const showId = home.replays[0].id as string;
        const snap = await (await snapshotRoute(req(`/api/live/shows/${showId}`), { params: Promise.resolve({ showId }) })).json();
        expect(snap.replayEvents.map((e: { event: string }) => e.event)).toEqual(['show.started', 'chat.message', 'machine.started', 'chat.message', 'machine.completed', 'show.ended']);
        for (const e of snap.replayEvents) expect(verifyLiveEvent(e)).toBe(true);
        expect(snap.replayEvents[snap.replayEvents.length - 1].streamTsMs).toBe(8000);
    });
});
