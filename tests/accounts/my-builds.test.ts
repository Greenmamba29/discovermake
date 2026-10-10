/** My Builds tabs and counts (guest and signed in), Following, Reorder, preferences and profile routes. */
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MeResponse, MyBuildsResponse, Preferences, ReorderResponse } from '@/contracts/account';
import { approveVersion, buildGraphWriteLimiter, forkBuild } from '@/server/build-graph';
import { builds, devicePreferences, quotes } from '@/server/db/schema';
import { resetEnvCache } from '@/server/env';
import { createBuildFromIntent } from '@/server/make-ai';
import { completeSignIn } from '@/server/auth/users';
import { GET as myBuildsRoute } from '@/app/api/me/builds/route';
import { POST as reorderRoute } from '@/app/api/me/builds/[buildId]/reorder/route';
import { POST as followRoute, DELETE as unfollowRoute } from '@/app/api/builds/[buildId]/follow/route';
import { PUT as preferencesRoute } from '@/app/api/me/preferences/route';
import { GET as meRoute, PATCH as patchMe } from '@/app/api/me/route';
import { POST as checkoutRoute } from '@/app/api/checkout/route';
import { createQuote } from '@/server/quote';
import { orders } from '@/server/db/schema';
import { checkoutBody } from '../orders/fixtures';
import { AL_6061 } from './fixtures';
import { BRACKET_INTENT, insertIntent } from '../build-graph/fixtures';
import { useTestDb } from '../support/db';
import { analyzedPart, placedOrder, useLocalStorage } from './fixtures';
import { newDevice, params, req, signedInUser, type Principal } from './helpers';

async function myBuilds(p: Principal | null, tab = 'all') {
    const res = await myBuildsRoute(req('GET', `/api/me/builds?tab=${tab}`, p), params({}));
    expect(res.status).toBe(200);
    return MyBuildsResponse.parse(await res.json());
}

describe('My Builds', () => {
    const ctx = useTestDb({ seed: true });
    useLocalStorage();
    beforeAll(() => {
        delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        resetEnvCache();
    });
    beforeEach(() => buildGraphWriteLimiter.reset());

    it('guest: this device’s builds by tab, with counts, actions and previews; claimed on sign-in', async () => {
        const guest = newDevice();
        const upload = await analyzedPart({ deviceHash: guest.deviceHash }, 'plate.dxf');
        const ordered = await analyzedPart({ deviceHash: guest.deviceHash }, 'ordered.dxf');
        await placedOrder(ctx.db, ordered.partId, 'guest-buyer@example.com');
        const made = await createBuildFromIntent(await insertIntent(ctx.db, BRACKET_INTENT), { owner: { ownerUserId: null, deviceHash: guest.deviceHash } });
        await approveVersion(made.buildId, 1);
        const remix = await forkBuild(made.buildId, 'remix', undefined, { owner: { ownerUserId: null, deviceHash: guest.deviceHash } });
        await analyzedPart({ deviceHash: newDevice().deviceHash }); // someone else's

        const all = await myBuilds(guest);
        expect(all.guest).toBe(true);
        expect(all.counts).toEqual({ all: 4, created: 3, remixed: 1, ordered: 1, following: 0 });
        expect(all.rows).toHaveLength(4);
        const orderedRow = all.rows.find((r) => r.buildId === ordered.buildId)!;
        expect(orderedRow).toMatchObject({ origin: 'upload', partId: ordered.partId, actions: { reorder: true, remix: false, repair: true }, trustState: 'ORDERABLE' });
        expect(orderedRow.lastOrder).toMatchObject({ status: 'PAID' });
        expect(orderedRow.previewSvg).toBeTruthy();
        expect(orderedRow.previewSize?.widthMm).toBeGreaterThan(0);
        expect(all.rows.find((r) => r.buildId === upload.buildId)!.actions).toEqual({ reorder: false, remix: false, repair: false });
        expect(all.rows.find((r) => r.buildId === made.buildId)!.actions.remix).toBe(true);
        expect(all.rows.find((r) => r.buildId === remix.buildId)).toMatchObject({ origin: 'remix', derivedFromBuildId: made.buildId });

        expect((await myBuilds(guest, 'remixed')).rows.map((r) => r.buildId)).toEqual([remix.buildId]);
        expect((await myBuilds(guest, 'ordered')).rows.map((r) => r.buildId)).toEqual([ordered.buildId]);
        expect((await myBuilds(guest, 'created')).rows).toHaveLength(3);
        expect((await myBuilds(newDevice())).counts.all).toBe(0);
        expect((await myBuilds(null)).rows).toEqual([]);

        // Sign in on this device: the builds move to the account; the device list empties.
        const r = await completeSignIn({ method: 'email', email: 'guest-buyer@example.com', deviceHash: guest.deviceHash });
        expect(r.claimed).toEqual({ builds: 4, orders: 1 });
        expect((await myBuilds(guest)).counts.all).toBe(0);
        const signed = await myBuilds({ ...guest, session: r.session.secret });
        expect(signed.guest).toBe(false);
        expect(signed.counts).toMatchObject({ all: 4, created: 3, remixed: 1, ordered: 1 });
    });

    it('signed in: owned + ordered-by-me builds; Following lists followed builds', async () => {
        const me = await signedInUser('me-builds@example.com');
        const mine = await analyzedPart({ ownerUserId: me.userId, deviceHash: me.deviceHash });
        // A build I ordered from another device stays its device's, but shows in my list.
        const elsewhere = await analyzedPart({ deviceHash: newDevice().deviceHash });
        await placedOrder(ctx.db, elsewhere.partId, 'me-builds@example.com', { buyerUserId: me.userId });
        const theirs = await analyzedPart({ deviceHash: newDevice().deviceHash });

        expect((await followRoute(req('POST', `/api/builds/${theirs.buildId}/follow`, null), params({ buildId: theirs.buildId }))).status).toBe(401);
        const f = await followRoute(req('POST', `/api/builds/${theirs.buildId}/follow`, me), params({ buildId: theirs.buildId }));
        expect(await f.json()).toEqual({ following: true });
        await followRoute(req('POST', `/api/builds/${theirs.buildId}/follow`, me), params({ buildId: theirs.buildId })); // idempotent
        expect((await followRoute(req('POST', '/api/builds/bld_missing/follow', me), params({ buildId: 'bld_missing' }))).status).toBe(404);

        const list = await myBuilds(me);
        expect(list.counts).toEqual({ all: 2, created: 2, remixed: 0, ordered: 1, following: 1 });
        expect(list.rows.map((r) => r.buildId).sort()).toEqual([mine.buildId, elsewhere.buildId].sort());
        expect((await myBuilds(me, 'following')).rows.map((r) => r.buildId)).toEqual([theirs.buildId]);

        const u = await unfollowRoute(req('DELETE', `/api/builds/${theirs.buildId}/follow`, me), params({ buildId: theirs.buildId }));
        expect(await u.json()).toEqual({ following: false });
        expect((await myBuilds(me)).counts.following).toBe(0);
    });

    it('reorder: a fresh orderable quote with the last order’s selections; buyer may reorder; 409 without an order', async () => {
        const owner = newDevice();
        const part = await analyzedPart({ deviceHash: owner.deviceHash });
        const res409 = await reorderRoute(req('POST', `/api/me/builds/${part.buildId}/reorder`, owner), params({ buildId: part.buildId }));
        expect(res409.status).toBe(409);

        const buyer = await signedInUser('reorder-buyer@example.com');
        const { quoteId: firstQuote } = await placedOrder(ctx.db, part.partId, 'reorder-buyer@example.com', { buyerUserId: buyer.userId, quantity: 7 });

        const res = await reorderRoute(req('POST', `/api/me/builds/${part.buildId}/reorder`, owner), params({ buildId: part.buildId }));
        expect(res.status).toBe(201);
        const body = ReorderResponse.parse(await res.json());
        expect(body.quoteId).not.toBe(firstQuote);
        expect(body.checkoutUrl).toBe(`http://localhost:3100/checkout/${body.quoteId}`);
        const [first] = await ctx.db.select().from(quotes).where(eq(quotes.id, firstQuote));
        const [fresh] = await ctx.db.select().from(quotes).where(eq(quotes.id, body.quoteId));
        expect(fresh.config).toEqual(first.config);
        expect(fresh).toMatchObject({ quantity: 7, status: 'READY', trustLevel: 'BINDING', partId: part.partId });

        // The signed-in buyer (not the build's device) may reorder their own order.
        expect((await reorderRoute(req('POST', `/api/me/builds/${part.buildId}/reorder`, buyer), params({ buildId: part.buildId }))).status).toBe(201);
        expect((await reorderRoute(req('POST', `/api/me/builds/${part.buildId}/reorder`, await signedInUser()), params({ buildId: part.buildId }))).status).toBe(403);
        expect((await reorderRoute(req('POST', '/api/me/builds/bld_missing/reorder', owner), params({ buildId: 'bld_missing' }))).status).toBe(404);
    });

    it('checkout attaches the order to the signed-in buyer (guest checkout stays unattached)', async () => {
        const me = await signedInUser('checkout-me@example.com');
        const part = await analyzedPart({ ownerUserId: me.userId, deviceHash: me.deviceHash });
        const q1 = await createQuote({ partId: part.partId, ...AL_6061, quantity: 2 });
        const signed = await checkoutRoute(req('POST', '/api/checkout', me, checkoutBody(q1.id, { buyer: { email: 'gift-to@example.com', name: 'Ada' } })), params({}));
        expect(signed.status).toBe(201);
        const [o1] = await ctx.db.select().from(orders).where(eq(orders.id, (await signed.json()).orderId));
        expect(o1.buyerUserId).toBe(me.userId);
        const q2 = await createQuote({ partId: part.partId, ...AL_6061, quantity: 3 });
        const guest = await checkoutRoute(req('POST', '/api/checkout', newDevice(), checkoutBody(q2.id)), params({}));
        const [o2] = await ctx.db.select().from(orders).where(eq(orders.id, (await guest.json()).orderId));
        expect(o2.buyerUserId).toBeNull();
    });

    it('preferences: guest -> device, signed in -> account; profile, handles and becoming a creator', async () => {
        const guest = newDevice();
        const put = await preferencesRoute(req('PUT', '/api/me/preferences', guest, { intent: 'discover', interests: ['bikes', 'bikes', 'garden'], complete: true }), params({}));
        expect(Preferences.parse(await put.json())).toEqual({ intent: 'discover', interests: ['bikes', 'garden'] });
        const [row] = await ctx.db.select().from(devicePreferences).where(eq(devicePreferences.deviceHash, guest.deviceHash));
        expect(row.onboardedAt).not.toBeNull();
        expect(MeResponse.parse(await (await meRoute(req('GET', '/api/me', guest), params({}))).json()).preferences).toEqual({ intent: 'discover', interests: ['bikes', 'garden'] });
        expect((await preferencesRoute(req('PUT', '/api/me/preferences', guest, { interests: ['not-a-topic'] }), params({}))).status).toBe(400);

        const r = await completeSignIn({ method: 'email', email: 'prefs-route@example.com', deviceHash: guest.deviceHash });
        const user: Principal = { ...guest, session: r.session.secret };
        let me = MeResponse.parse(await (await meRoute(req('GET', '/api/me', user), params({}))).json());
        expect(me.preferences).toEqual({ intent: 'discover', interests: ['bikes', 'garden'] });
        expect(me.viewer?.onboardedAt).not.toBeNull();
        await preferencesRoute(req('PUT', '/api/me/preferences', user, { intent: 'sell' }), params({}));
        me = MeResponse.parse(await (await meRoute(req('GET', '/api/me', user), params({}))).json());
        expect(me.preferences.intent).toBe('sell');

        expect((await patchMe(req('PATCH', '/api/me', guest, { displayName: 'X' }), params({}))).status).toBe(401);
        const noHandle = await patchMe(req('PATCH', '/api/me', user, { becomeCreator: true }), params({}));
        expect(noHandle.status).toBe(400);
        const ok = await patchMe(req('PATCH', '/api/me', user, { displayName: 'Ada', handle: 'ada_makes', becomeCreator: true }), params({}));
        expect(MeResponse.parse(await ok.json()).viewer).toMatchObject({ displayName: 'Ada', handle: 'ada_makes', roles: ['buyer', 'creator'] });

        const other = await signedInUser();
        const taken = await patchMe(req('PATCH', '/api/me', other, { handle: 'ada_makes' }), params({}));
        expect(taken.status).toBe(409);
        expect((await patchMe(req('PATCH', '/api/me', other, { handle: 'Bad Handle' }), params({}))).status).toBe(400);
        const [b] = await ctx.db.select().from(builds).limit(1);
        expect(b).toBeTruthy();
    });
});
