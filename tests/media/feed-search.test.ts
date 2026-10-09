/**
 * Discover feed + search against a real database: the For You heuristic is deterministic and
 * seeded by onboarding interests (user, else device), keyset cursors page without repeats,
 * New / Trending orderings, feed event logging, and Postgres full-text search.
 */
import { eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { GET as feedRoute } from '@/app/api/media/feed/route';
import { POST as feedEventsRoute } from '@/app/api/media/feed/events/route';
import { GET as searchRoute } from '@/app/api/media/search/route';
import { DEVICE_COOKIE } from '@/contracts/account';
import { hashDeviceSecret } from '@/server/auth/device';
import { devicePreferences, feedEvents, users } from '@/server/db/schema';
import { decodeCursor, encodeCursor, feedPage, prefixTsQuery, rankScore, recordFeedEvents, searchMedia } from '@/server/media';
import { upsertChannel } from '@/server/live';
import { hasTrigram, resetTrigramCache } from '@/server/media/search';
import { useTestDb } from '../support/db';
import { quietConsole } from '../orders/fixtures';
import { BASE, makeUser, req, viewerOf } from '../live/fixtures';
import { creatorBuild, publish } from './fixtures';

const NO_PARAMS = { params: Promise.resolve({}) };
const BASE_FEATURES = { ageMs: 0, followers: 0, paidOrders: 0, engagement: { clicks: 0, plays: 0, makeThis: 0, orders: 0 }, makeability: 90, orderable: true, makeable: true, liveNow: false, followedChannel: false };

describe('ranking (pure)', () => {
    it('is deterministic and follows each factor in the heuristic', () => {
        const f = { ...BASE_FEATURES, interests: ['lighting'] };
        expect(rankScore(f, ['lighting'])).toBe(rankScore(f, ['lighting']));
        expect(rankScore(f, ['lighting'])).toBeGreaterThan(rankScore(f, ['bikes']));
        expect(rankScore(f, [])).toBeGreaterThan(rankScore(f, ['bikes'])); // no picks = neutral
        expect(rankScore({ ...f, ageMs: 30 * 86_400_000 }, [])).toBeLessThan(rankScore(f, [])); // novelty
        expect(rankScore({ ...f, engagement: { clicks: 10, plays: 0, makeThis: 2, orders: 1 } }, [])).toBeGreaterThan(rankScore(f, [])); // engagement
        expect(rankScore({ ...f, orderable: false, makeable: false }, [])).toBeLessThan(rankScore(f, [])); // availability
        expect(rankScore({ ...f, followers: 100 }, [])).toBeGreaterThan(rankScore(f, [])); // creator quality
        expect(rankScore({ ...f, followedChannel: true }, ['bikes'])).toBeGreaterThan(rankScore(f, ['bikes']));
        expect(rankScore({ ...f, makeability: 40 }, [])).toBeLessThan(rankScore(f, []));
    });

    it('round-trips cursors and ignores a cursor from another tab', () => {
        const c = { t: 'new', s: 12.5, i: 'bld_x', a: 1_700_000_000_000 };
        expect(decodeCursor(encodeCursor(c), 'new')).toEqual(c);
        expect(decodeCursor(encodeCursor(c), 'for_you')).toBeNull();
        expect(decodeCursor('garbage', 'new')).toBeNull();
        expect(prefixTsQuery('Bent lamp!!')).toBe('bent:* & lamp:*');
        expect(prefixTsQuery('  ')).toBeNull();
    });
});

describe('Discover feed and search', () => {
    const ctx = useTestDb({ seed: true });
    beforeAll(() => quietConsole());

    async function seedBuilds() {
        const lamp = await creatorBuild(ctx.db, { name: 'Lamp Maker' });
        await publish(lamp.viewer, lamp.fixture.build.id, { title: 'Walnut desk lamp', tags: ['lighting', 'walnut'], description: 'A bent aluminum arm on a walnut base.' });
        const bike = await creatorBuild(ctx.db, { name: 'Bike Maker' });
        await publish(bike.viewer, bike.fixture.build.id, { title: 'Handlebar phone mount', tags: ['bikes'] });
        const desk = await creatorBuild(ctx.db, { name: 'Desk Maker' });
        await publish(desk.viewer, desk.fixture.build.id, { title: 'Monitor riser bracket', tags: ['desk-setup', 'brackets-mounts'] });
        // A private build never shows up.
        const hidden = await creatorBuild(ctx.db);
        await publish(hidden.viewer, hidden.fixture.build.id, { title: 'Secret lamp prototype', visibility: 'private', tags: ['lighting'] });
        return { lamp: lamp.fixture.build.id, bike: bike.fixture.build.id, desk: desk.fixture.build.id, hidden: hidden.fixture.build.id, lampCreator: lamp };
    }

    it('seeds For You from the user’s interests (else the device’s), deterministically, and pages with a cursor', async () => {
        const ids = await seedBuilds();
        const cyclist = await makeUser('cyclist');
        await ctx.db.update(users).set({ interests: ['bikes'] }).where(eq(users.id, cyclist.id));
        const now = new Date();
        const a = await feedPage({ tab: 'for_you', viewer: { userId: cyclist.id, deviceHash: null }, now });
        const b = await feedPage({ tab: 'for_you', viewer: { userId: cyclist.id, deviceHash: null }, now });
        expect(a.seededBy).toEqual({ source: 'user', interests: ['bikes'] });
        expect(a.items[0]).toMatchObject({ kind: 'build', id: ids.bike });
        expect(a.items.map((i) => [i.id, i.score])).toEqual(b.items.map((i) => [i.id, i.score]));
        expect(a.items.map((i) => i.id)).not.toContain(ids.hidden);

        // Guest device with onboarding picks.
        const device = 'guest-device-secret-0000000000000000';
        await ctx.db.insert(devicePreferences).values({ deviceHash: hashDeviceSecret(device), interests: ['lighting'] });
        const res = await feedRoute(new Request(`${BASE}/api/media/feed?tab=for_you`, { headers: { cookie: `${DEVICE_COOKIE}=${device}` } }), NO_PARAMS);
        const guest = await res.json();
        expect(guest.seededBy.source).toBe('device');
        expect(guest.items[0].id).toBe(ids.lamp);

        // Keyset paging: one per page, no repeats, ends with a null cursor.
        const seen: string[] = [];
        let cursor: string | null = null;
        for (let i = 0; i < 5; i++) {
            const page = await feedPage({ tab: 'new', viewer: { userId: null, deviceHash: null }, cursor, limit: 1 });
            seen.push(...page.items.map((x) => x.id));
            cursor = page.nextCursor;
            if (!cursor) break;
        }
        expect(seen).toEqual([ids.desk, ids.bike, ids.lamp]);
        expect(cursor).toBeNull();
    });

    it('trending follows logged engagement; feed events are recorded (rate limited) for the learned ranker', async () => {
        const viewerA = await makeUser('fan');
        const before = await feedPage({ tab: 'trending', viewer: { userId: null, deviceHash: null } });
        const target = before.items[before.items.length - 1].id;
        const res = await feedEventsRoute(req('/api/media/feed/events', { user: viewerA, body: { events: [{ kind: 'click', itemKind: 'build', itemId: target, tab: 'trending', position: 2 }, { kind: 'make_this', itemKind: 'build', itemId: target, tab: 'trending' }] } }), NO_PARAMS);
        expect(res.status).toBe(201);
        expect(await res.json()).toEqual({ recorded: 2 });
        const rows = await ctx.db.select().from(feedEvents).where(eq(feedEvents.itemId, target));
        expect(rows.map((r) => r.kind).sort()).toEqual(['click', 'make_this']);
        expect(rows[0].viewerKey).toBe(viewerA.id);
        const after = await feedPage({ tab: 'trending', viewer: { userId: null, deviceHash: null } });
        expect(after.items[0].id).toBe(target);
        const bad = await feedEventsRoute(req('/api/media/feed/events', { user: viewerA, body: { events: [{ kind: 'click', itemKind: 'build', itemId: 'not an id' }] } }), NO_PARAMS);
        expect(bad.status).toBe(400);
        expect(await recordFeedEvents({ userId: null, deviceHash: 'abc' }, [{ kind: 'impression', itemKind: 'build', itemId: target, tab: 'for_you' }])).toBe(1);
    });

    it('searches published builds, channels and clips with Postgres full-text search', async () => {
        const lamp = await searchMedia('lamp');
        expect(lamp.builds.map((b) => b.title)).toEqual(['Walnut desk lamp']); // the private one is excluded
        expect((await searchMedia('brack')).builds.map((b) => b.title)).toContain('Monitor riser bracket'); // prefix
        expect((await searchMedia('walnut aluminum')).builds).toHaveLength(1); // description + tags
        expect((await searchMedia('zzzz-nothing')).builds).toHaveLength(0);
        const host = await makeUser('host', ['buyer', 'creator'], 'Amanda');
        await upsertChannel(await viewerOf(host), { name: 'Amanda Makes Lamps', handle: `amanda_${Date.now().toString(36)}`.slice(0, 24), kind: 'creator', categories: ['workshop'], bio: 'Lighting builds every Thursday.' });
        const viaRoute = await (await searchRoute(req('/api/media/search?q=thursday'), NO_PARAMS)).json();
        expect(viaRoute.channels.map((c: { name: string }) => c.name)).toContain('Amanda Makes Lamps');
        expect(['fts', 'fts+trgm']).toContain(viaRoute.mode);
        expect(viaRoute.mode).toBe((await hasTrigram()) ? 'fts+trgm' : 'fts');
        // The GIN expression index exists for the planner.
        const idx = (await ctx.db.execute(sql`select indexname from pg_indexes where tablename = 'build_publications' and indexname = 'build_publications_fts_idx'`)) as unknown as unknown[];
        expect(idx.length).toBe(1);

        // With pg_trgm installed (a trusted extension), typos match too.
        let trgm = false;
        try {
            await ctx.db.execute(sql`create extension if not exists pg_trgm`);
            trgm = true;
        } catch {
            trgm = false; // no permission here: the FTS-only path above is what runs
        }
        resetTrigramCache();
        if (trgm) {
            const fuzzy = await searchMedia('Handlebar phone mounnt');
            expect(fuzzy.mode).toBe('fts+trgm');
            expect(fuzzy.builds.map((b) => b.title)).toContain('Handlebar phone mount');
        }
    });
});
