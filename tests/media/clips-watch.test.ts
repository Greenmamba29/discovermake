/**
 * Clip engine (suggestions from the Live Build Protocol, host + system clips, chapters) and
 * Watch My Build (token / owner access, wrong token 404, the milestone stream, shop camera).
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { GET as clipsRoute, POST as createClipRoute } from '@/app/api/media/shows/[showId]/clips/route';
import { GET as watchRoute } from '@/app/api/orders/[orderId]/watch/route';
import type { LiveEvent } from '@/contracts/live';
import { DEV_SHOP_ID } from '@/server/db/seed';
import { channels, clips, manufacturingJobs, showFeaturedBuilds, shows } from '@/server/db/schema';
import { handleIntent } from '@/server/live';
import { replayChapters, suggestClips } from '@/server/media';
import { acceptJob, recordMilestone } from '@/server/shops';
import { useTestDb } from '../support/db';
import { quietConsole } from '../orders/fixtures';
import { makeUser, req, setupShow } from '../live/fixtures';
import { createQuoteFixture as shopQuoteFixture } from '../shop/fixtures';
import { paidOrder } from './fixtures';

type Ev = Pick<LiveEvent, 'event' | 'seq' | 'streamTsMs' | 'buildId' | 'payload'>;
const ev = (seq: number, event: Ev['event'], streamTsMs: number, payload: Record<string, unknown> = {}, buildId?: string): Ev => ({ seq, event, streamTsMs, payload, buildId });

describe('clip engine', () => {
    const ctx = useTestDb({ seed: true });
    beforeAll(() => quietConsole());

    it('suggests one window per product focus / drop start, capped and ordered', () => {
        const events = [
            ev(1, 'show.started', 0),
            ev(2, 'product.focus', 5_000, { name: 'Lamp plate' }, 'bld_a'),
            ev(3, 'chat.message', 6_000),
            ev(4, 'product.focus', 20_000, { name: 'Bracket' }, 'bld_b'),
            ev(5, 'drop.started', 25_000, { drop: { title: 'Bracket run' } }, 'bld_b'),
            ev(6, 'drop.closed', 90_000, {}, 'bld_b'),
        ];
        const s = suggestClips(events, 120_000);
        expect(s.map((x) => x.reason)).toEqual(['product.focus', 'product.focus', 'drop.started']);
        // First product: 2 s lead-in, ends at the next focus.
        expect(s[0]).toMatchObject({ startMs: 3_000, endMs: 20_000, title: 'Now showing: Lamp plate', buildId: 'bld_a', eventSeq: 2 });
        // Last product: capped at 30 s after the moment.
        expect(s[1]).toMatchObject({ startMs: 18_000, endMs: 50_000, buildId: 'bld_b' });
        expect(s[2]).toMatchObject({ title: 'Drop: Bracket run', startMs: 23_000, endMs: 55_000 });
        // A moment at the very end still yields a playable (>= 3 s) window.
        const tail = suggestClips([ev(1, 'product.focus', 9_000, { name: 'X' }, 'bld_x')], 9_500);
        expect(tail[0].endMs - tail[0].startMs).toBeGreaterThanOrEqual(3_000);
        expect(replayChapters(events as LiveEvent[]).map((c) => c.title)).toEqual(['Show starts', 'Lamp plate', 'Bracket', 'Drop opens: Bracket run', 'Drop closes']);
    });

    it('the system clips each product moment when the show ends; the host cuts more from the replay', async () => {
        const s = await setupShow(ctx.db);
        await handleIntent(await s.hostAccess(), { intent: 'feature_product', buildId: s.fixture.build.id });
        // Live shows cannot be clipped yet.
        const early = await createClipRoute(req(`/api/media/shows/${s.show.id}/clips`, { user: s.host, body: { startMs: 0, endMs: 10_000, title: 'Too early' } }), { params: Promise.resolve({ showId: s.show.id }) });
        expect(early.status).toBe(409);
        await handleIntent(await s.hostAccess(), { intent: 'end_show' });
        const auto = await ctx.db.select().from(clips).where(eq(clips.showId, s.show.id));
        expect(auto).toHaveLength(1);
        expect(auto[0]).toMatchObject({ origin: 'system', buildId: s.fixture.build.id });

        const viewer = await makeUser('viewer');
        const asViewer = await (await clipsRoute(req(`/api/media/shows/${s.show.id}/clips`, { user: viewer }), { params: Promise.resolve({ showId: s.show.id }) })).json();
        expect(asViewer.viewerIsHost).toBe(false);
        expect(asViewer.suggestions).toEqual([]);
        expect(asViewer.chapters.length).toBeGreaterThanOrEqual(2);
        const asHost = await (await clipsRoute(req(`/api/media/shows/${s.show.id}/clips`, { user: s.host }), { params: Promise.resolve({ showId: s.show.id }) })).json();
        expect(asHost.suggestions.length).toBe(1);

        const denied = await createClipRoute(req(`/api/media/shows/${s.show.id}/clips`, { user: viewer, body: { startMs: 0, endMs: 10_000, title: 'Not mine' } }), { params: Promise.resolve({ showId: s.show.id }) });
        expect(denied.status).toBe(403);
        const tooShort = await createClipRoute(req(`/api/media/shows/${s.show.id}/clips`, { user: s.host, body: { startMs: 0, endMs: 1_000, title: 'Blink' } }), { params: Promise.resolve({ showId: s.show.id }) });
        expect(tooShort.status).toBe(400);
        const made = await createClipRoute(req(`/api/media/shows/${s.show.id}/clips`, { user: s.host, body: { startMs: 0, endMs: 12_000, title: 'The bracket reveal' } }), { params: Promise.resolve({ showId: s.show.id }) });
        expect(made.status).toBe(201);
        const card = await made.json();
        expect(card).toMatchObject({ title: 'The bracket reveal', origin: 'host', startMs: 0, endMs: 12_000, build: { buildId: s.fixture.build.id, canBuy: true } });
    });
});

describe('Watch My Build', () => {
    const ctx = useTestDb({ seed: true });
    beforeAll(() => quietConsole());

    const watch = (orderId: string, opts: { token?: string; user?: Parameters<typeof req>[1]['user'] } = {}) =>
        watchRoute(req(`/api/orders/${orderId}/watch${opts.token ? `?t=${encodeURIComponent(opts.token)}` : ''}`, { user: opts.user }), { params: Promise.resolve({ orderId }) });

    it('answers only the order link token or the signed-in buyer (wrong token = 404) and streams every milestone', async () => {
        const fixture = await shopQuoteFixture(ctx.db);
        const buyer = await makeUser('buyer');
        const { orderId, token } = await paidOrder(fixture.quote.id, buyer);

        expect((await watch(orderId)).status).toBe(404);
        const flipped = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
        const wrong = await watch(orderId, { token: flipped });
        expect(wrong.status).toBe(404);
        const missing = await watch('ord_missing0000000000000', { token });
        expect(await wrong.json()).toEqual(await missing.json());
        expect((await watch(orderId, { user: await makeUser('stranger') })).status).toBe(404);
        expect((await watch(orderId, { user: buyer })).status).toBe(200);

        // The shop works the job in the Shop Console: each step posts to the stream.
        const [job] = await ctx.db.select().from(manufacturingJobs).where(eq(manufacturingJobs.orderId, orderId));
        expect(job.shopId).toBe(DEV_SHOP_ID);
        await acceptJob(DEV_SHOP_ID, job.id);
        await recordMilestone(DEV_SHOP_ID, job.id, { kind: 'CUTTING', note: 'Fiber laser, nest 3 of 4' });
        await recordMilestone(DEV_SHOP_ID, job.id, { kind: 'BENDING' });
        const view = await (await watch(orderId, { token })).json();
        expect(view.posts.map((p: { kind: string }) => p.kind)).toEqual(['paid', 'accepted', 'cutting', 'bending']);
        expect(view.posts[2]).toMatchObject({ label: 'Cutting started', note: 'Fiber laser, nest 3 of 4', actor: 'shop' });
        expect(view).toMatchObject({ inProduction: true, status: 'IN_PRODUCTION', camera: null });

        // A build_live show on the shop's channel featuring this build is embedded.
        const [channel] = await ctx.db.insert(channels).values({ handle: `shopcam_${Date.now().toString(36)}`, name: 'Dev Shop floor', kind: 'factory', shopId: DEV_SHOP_ID }).returning();
        const [show] = await ctx.db.insert(shows).values({ channelId: channel.id, title: 'Cell 2 laser', format: 'build_live', status: 'LIVE', scheduledFor: new Date(), startedAt: new Date(), hlsUrl: 'https://cams.example.com/cell2.m3u8', createdBy: 'shop' }).returning();
        await ctx.db.insert(showFeaturedBuilds).values({ showId: show.id, buildId: fixture.build.id });
        const withCam = await (await watch(orderId, { token })).json();
        expect(withCam.camera).toMatchObject({ showId: show.id, status: 'LIVE', source: { kind: 'hls' }, channelName: 'Dev Shop floor' });
    });
});
