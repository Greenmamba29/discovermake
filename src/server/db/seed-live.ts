/**
 * Optional Live demo seed (R4): a factory channel for the dev partner shop with one ENDED
 * show whose replay is the committed fixture `public/live/demo-replay.webm`, and a short,
 * signed event log so the replay is not empty. Off by default (tests and e2e build their
 * own state); `bun run db:seed` turns it on outside production.
 *
 * There are no seeded builds, so the demo replay features no product (honest empty card).
 * Idempotent: keyed by the channel handle.
 */
import { eq } from 'drizzle-orm';
import type { Db } from './index';
import { channels, shows } from './schema';
import { appendLiveEvent } from '../live/events';

export const LIVE_DEMO_CHANNEL_HANDLE = 'philly_precision';
export const LIVE_DEMO_REPLAY_URL = '/live/demo-replay.webm';

export async function seedLiveDemo(db: Db, opts: { shopId: string | null }): Promise<{ channelId: string; showId: string } | null> {
    const [existing] = await db.select({ id: channels.id }).from(channels).where(eq(channels.handle, LIVE_DEMO_CHANNEL_HANDLE)).limit(1);
    if (existing) {
        const [show] = await db.select({ id: shows.id }).from(shows).where(eq(shows.channelId, existing.id)).limit(1);
        return show ? { channelId: existing.id, showId: show.id } : null;
    }
    return db.transaction(async (tx) => {
        const [channel] = await tx
            .insert(channels)
            .values({
                handle: LIVE_DEMO_CHANNEL_HANDLE,
                name: 'Philadelphia Precision Works',
                kind: 'factory',
                categories: ['factory-floor', 'workshop'],
                bio: 'Fiber lasers and press brakes in Kensington. Demo channel for local development.',
                shopId: opts.shopId,
            })
            .returning();
        const endedAt = new Date(Date.now() - 2 * 3600_000);
        const startedAt = new Date(endedAt.getTime() - 8_000);
        const [show] = await tx
            .insert(shows)
            .values({
                channelId: channel.id,
                title: 'Inside the factory: cutting brackets on fiber laser 04',
                format: 'factory_live',
                status: 'ENDED',
                scheduledFor: startedAt,
                startedAt,
                endedAt,
                replayUrl: LIVE_DEMO_REPLAY_URL,
                createdBy: 'system:seed',
            })
            .returning();
        const at = (ms: number) => new Date(startedAt.getTime() + ms);
        const host = { kind: 'host' as const, id: 'seed_host', name: 'Philadelphia Precision Works' };
        await appendLiveEvent(show.id, { event: 'show.started', actor: host, payload: { startedAt: startedAt.toISOString(), source: 'none' }, at: at(0) }, tx);
        await appendLiveEvent(show.id, { event: 'chat.message', actor: host, payload: { text: 'Welcome to the floor! Laser 04 is warming up.' }, at: at(1_000) }, tx);
        await appendLiveEvent(show.id, { event: 'machine.started', actor: host, payload: { note: 'Fiber laser 04 · 3 mm 5052' }, at: at(2_500) }, tx);
        await appendLiveEvent(show.id, { event: 'chat.message', actor: { kind: 'viewer', id: 'seed_viewer', name: 'Sam' }, payload: { text: 'How long does a sheet take?' }, at: at(4_000) }, tx);
        await appendLiveEvent(show.id, { event: 'machine.completed', actor: host, payload: { note: 'Sheet done' }, at: at(6_000) }, tx);
        await appendLiveEvent(show.id, { event: 'show.ended', actor: host, payload: { endedAt: endedAt.toISOString(), durationMs: 8_000 }, at: endedAt }, tx);
        return { channelId: channel.id, showId: show.id };
    });
}
