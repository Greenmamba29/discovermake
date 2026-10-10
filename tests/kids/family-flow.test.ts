/**
 * Kids & Family end to end on the server: profiles and limits, PIN, hand-off and the session lock,
 * the guard on kid-forbidden routes, kid design -> golden workshop output -> BINDING print quote,
 * "Ask a grown-up" within / over the spending limit (email to the grown-up only), approve ->
 * the grown-up's own checkout with Prime benefits, decline, cross-family isolation, exit with the
 * PIN (rate limited), and one-tap profile deletion.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as checkoutRoute } from '@/app/api/checkout/route';
import { GET as familyRoute } from '@/app/api/family/route';
import { POST as addKidRoute } from '@/app/api/family/kids/route';
import { DELETE as deleteKidRoute, PATCH as patchKidRoute } from '@/app/api/family/kids/[kidId]/route';
import { POST as handOffRoute } from '@/app/api/family/kids/[kidId]/hand-off/route';
import { PUT as pinRoute } from '@/app/api/family/pin/route';
import { POST as approveRoute } from '@/app/api/family/requests/[requestId]/approve/route';
import { POST as declineRoute } from '@/app/api/family/requests/[requestId]/decline/route';
import { POST as kidDesignRoute } from '@/app/api/kids/designs/route';
import { POST as kidExitRoute } from '@/app/api/kids/exit/route';
import { GET as kidMeRoute } from '@/app/api/kids/me/route';
import { POST as kidAskRoute } from '@/app/api/kids/requests/route';
import { GET as kidThingsRoute } from '@/app/api/kids/things/route';
import { GET as cartRoute } from '@/app/api/me/cart/route';
import { PATCH as meRoute } from '@/app/api/me/route';
import { POST as makeAiIntakeRoute } from '@/app/api/make-ai/intake/route';
import { POST as partsRoute } from '@/app/api/parts/route';
import { POST as liveChatRoute } from '@/app/api/live/shows/[showId]/chat/route';
import { POST as reconstructRoute } from '@/app/api/reconstruct/route';
import { POST as publishRoute } from '@/app/api/media/builds/[buildId]/publish/route';
import { KID_COOKIE, type FamilyView, type KidDesignView, type KidProfileView, type KidThingView } from '@/contracts/kids';
import { getViewer } from '@/server/auth/viewer';
import { builds, familyActivity, kidDesigns, kidModeLocks, kidProfiles, kidRequests, orderBenefits, orders, quotes } from '@/server/db/schema';
import { resetEnvCache } from '@/server/env';
import { createKidDesign, getKidSession, priceKidDesign, approveKidRequest, listKidThings, askGrownUp, pinAttemptLimiter } from '@/server/kids';
import { kidAskLimiter, kidDesignLimiter } from '@/server/kids/rate-limit';
import { handlePaymentSucceeded } from '@/server/orders';
import { startMembership } from '@/server/prime/membership';
import { LocalDiskStorage, setStorage } from '@/server/storage';
import { cookieHeader, params, req, setCookieValue, signedInUser, type Principal } from '../accounts/helpers';
import { checkoutBody } from '../orders/fixtures';
import { useTestDb as withTestDb } from '../support/db';
import { goldenKidWorker } from '../support/kids-golden';

const notifySpy = vi.hoisted(() => vi.fn());
vi.mock('@/server/notify', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/server/notify')>();
    return { ...actual, notify: (...args: Parameters<typeof actual.notify>) => (notifySpy(...args), actual.notify(...args)) };
});

const ctx = withTestDb({ seed: true });
let storageDir = '';

beforeAll(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), 'dm-kids-'));
    setStorage(new LocalDiskStorage({ rootDir: storageDir, appUrl: 'http://localhost:3100', signingSecret: 'test-storage-secret' }));
    process.env.CAD_WORKER_URL = 'http://cad-worker.test';
    process.env.CAD_WORKER_TOKEN = 'worker-token';
    resetEnvCache();
});
afterAll(async () => {
    delete process.env.CAD_WORKER_URL;
    delete process.env.CAD_WORKER_TOKEN;
    resetEnvCache();
    setStorage(null);
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
});
beforeEach(async () => {
    await Promise.all([pinAttemptLimiter.reset(), kidDesignLimiter.reset(), kidAskLimiter.reset()]);
    notifySpy.mockClear();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

type Family = { parent: Principal; kid: KidProfileView; kidCookie: string };

const withKid = (p: Principal, kidCookie: string) => ({ cookie: `${cookieHeader(p).cookie}; ${KID_COOKIE}=${encodeURIComponent(kidCookie)}` });
const kidReq = (f: Family, method: string, url: string, body?: unknown) => req(method, url, null, body, withKid(f.parent, f.kidCookie));

async function addKid(parent: Principal, body: Record<string, unknown>): Promise<Response> {
    return addKidRoute(req('POST', '/api/family/kids', parent, body), params({}));
}

async function family(nickname = 'Mia', ageBand = '10-12'): Promise<Family> {
    const parent = await signedInUser();
    const created = await addKid(parent, { nickname, ageBand, avatar: 'fox' });
    expect(created.status).toBe(201);
    const kid = (await created.json()) as KidProfileView;
    expect((await pinRoute(req('PUT', '/api/family/pin', parent, { pin: '2468' }), params({}))).status).toBe(200);
    const handed = await handOffRoute(req('POST', `/api/family/kids/${kid.id}/hand-off`, parent), params({ kidId: kid.id }));
    expect(handed.status).toBe(200);
    const kidCookie = setCookieValue(handed, KID_COOKIE)!;
    expect(kidCookie).toMatch(/^v1\./);
    expect(handed.headers.getSetCookie().find((c) => c.startsWith(`${KID_COOKIE}=`))).toMatch(/HttpOnly/i);
    return { parent, kid, kidCookie };
}

async function kidSession(f: Family) {
    const s = await getKidSession(kidReq(f, 'GET', '/api/kids/me'));
    expect(s, 'live kid session').not.toBeNull();
    return s!;
}

async function pricedDesign(f: Family, label = 'MIA'): Promise<KidDesignView> {
    const worker = goldenKidWorker();
    const d = await createKidDesign(await kidSession(f), { template: 'name_keychain', params: { label, color: 'blue', size: 'small' } }, { fetchImpl: worker });
    expect(worker.calls).toHaveLength(1);
    return d;
}

describe('family setup', () => {
    it('adds up to 4 kid profiles with age-band defaults, then refuses a fifth', async () => {
        const parent = await signedInUser();
        const first = (await (await addKid(parent, { nickname: 'Mia', ageBand: '6-9', avatar: 'owl' })).json()) as KidProfileView;
        expect(first).toMatchObject({ nickname: 'Mia', ageBand: '6-9', avatar: 'owl', spendingLimitCents: 2500, liveViewing: false, discoverBrowsing: false, allowedTemplates: ['name_keychain', 'bookmark'] });
        const teen = (await (await addKid(parent, { nickname: 'Sam', ageBand: '13-17', avatar: 'robot' })).json()) as KidProfileView;
        expect(teen).toMatchObject({ liveViewing: true, discoverBrowsing: true });
        expect((await addKid(parent, { nickname: 'Ada', ageBand: '10-12', avatar: 'cat' })).status).toBe(201);
        expect((await addKid(parent, { nickname: 'Lu', ageBand: '10-12', avatar: 'cat' })).status).toBe(201);
        const fifth = await addKid(parent, { nickname: 'Max', ageBand: '10-12', avatar: 'cat' });
        expect(fifth.status).toBe(409);
        expect((await addKid(parent, { nickname: 'Eve', ageBand: '10-12', avatar: 'cat', email: 'eve@example.com' })).status).toBe(400);

        const patched = await patchKidRoute(req('PATCH', `/api/family/kids/${first.id}`, parent, { spendingLimitCents: 4000, liveViewing: true, allowedTemplates: ['bookmark', 'bookmark'] }), params({ kidId: first.id }));
        expect(await patched.json()).toMatchObject({ spendingLimitCents: 4000, liveViewing: true, allowedTemplates: ['bookmark'] });

        const view = (await (await familyRoute(req('GET', '/api/family', parent), params({}))).json()) as FamilyView;
        expect(view.kids).toHaveLength(4);
        expect(view.pinSet).toBe(false);
        expect(view.activity.map((a) => a.kind)).toContain('kid_added');
        // Another grown-up cannot change this family's kid.
        const stranger = await signedInUser();
        expect((await patchKidRoute(req('PATCH', `/api/family/kids/${first.id}`, stranger, { liveViewing: false }), params({ kidId: first.id }))).status).toBe(404);
        expect((await familyRoute(req('GET', '/api/family', null), params({}))).status).toBe(401);
    });

    it('needs a PIN before Kids mode can start', async () => {
        const parent = await signedInUser();
        const kid = (await (await addKid(parent, { nickname: 'Mia', ageBand: '10-12', avatar: 'fox' })).json()) as KidProfileView;
        expect((await handOffRoute(req('POST', `/api/family/kids/${kid.id}/hand-off`, parent), params({ kidId: kid.id }))).status).toBe(409);
        expect((await pinRoute(req('PUT', '/api/family/pin', parent, { pin: '12' }), params({}))).status).toBe(400);
    });
});

describe('kids mode guard', () => {
    it('the handed-off session is no grown-up session, and every kid-forbidden route refuses it', async () => {
        const f = await family();
        expect(await getViewer(kidReq(f, 'GET', '/api/me'))).toBeNull();
        const k = (method: string, url: string, body?: unknown) => kidReq(f, method, url, body);
        const refused: [string, Promise<Response>][] = [
            ['checkout', checkoutRoute(k('POST', '/api/checkout', checkoutBody('qte_x')), params({}))],
            ['cart', cartRoute(k('GET', '/api/me/cart'), params({}))],
            ['account settings', meRoute(k('PATCH', '/api/me', { displayName: 'Hacker' }), params({}))],
            ['family', familyRoute(k('GET', '/api/family'), params({}))],
            ['pin', pinRoute(k('PUT', '/api/family/pin', { pin: '0000' }), params({}))],
            ['make ai', makeAiIntakeRoute(k('POST', '/api/make-ai/intake', { prompt: 'a knife' }), params({}))],
            ['uploads', partsRoute(k('POST', '/api/parts', { filename: 'a.dxf', sizeBytes: 10 }), params({}))],
            ['live chat', liveChatRoute(k('POST', '/api/live/shows/shw_x/chat', { text: 'hi' }), params({ showId: 'shw_x' }))],
            ['reconstruct photo', reconstructRoute(k('POST', '/api/reconstruct', { partType: 'knob' }), params({}))],
            ['publishing', publishRoute(k('POST', '/api/media/builds/bld_x/publish', { visibility: 'public' }), params({ buildId: 'bld_x' }))],
        ];
        for (const [name, p] of refused) {
            const res = await p;
            expect(res.status, name).toBe(403);
        }
        // Without the cookie (deleted by hand), the server-side lock still holds.
        const lockedOnly = req('POST', '/api/checkout', f.parent, checkoutBody('qte_x'));
        expect((await checkoutRoute(lockedOnly, params({}))).status).toBe(403);
        expect(await getViewer(req('GET', '/api/me', f.parent))).toBeNull();
        expect((await familyRoute(req('GET', '/api/family', f.parent), params({}))).status).toBe(403);

        // A tampered cookie is no kid session (and still not a grown-up one).
        const tampered = req('GET', '/api/kids/me', null, undefined, withKid(f.parent, `${f.kidCookie}x`));
        expect((await kidMeRoute(tampered, params({}))).status).toBe(401);
        expect((await kidMeRoute(kidReq(f, 'GET', '/api/kids/me'), params({}))).status).toBe(200);
    });
});

describe('kid design, price and ask a grown-up', () => {
    it('workshop offline: an honest offline state and no price', async () => {
        const f = await family();
        delete process.env.CAD_WORKER_URL;
        resetEnvCache();
        try {
            const res = await kidDesignRoute(kidReq(f, 'POST', '/api/kids/designs', { template: 'name_keychain', params: { label: 'MIA', color: 'blue' } }), params({}));
            expect(res.status).toBe(201);
            const d = (await res.json()) as KidDesignView;
            expect(d).toMatchObject({ status: 'offline', priceCents: null, withinLimit: false });
            expect(d.message).toMatch(/workshop is offline/);
            const ask = await kidAskRoute(kidReq(f, 'POST', '/api/kids/requests', { designId: d.id }), params({}));
            expect(ask.status).toBe(409);
        } finally {
            process.env.CAD_WORKER_URL = 'http://cad-worker.test';
            resetEnvCache();
        }
    });

    it('validates the template and label for this kid (no free text beyond the bounded label)', async () => {
        const f = await family('Tia', '6-9');
        const bad = await kidDesignRoute(kidReq(f, 'POST', '/api/kids/designs', { template: 'name_keychain', params: { label: 'tia@home.com', color: 'blue' } }), params({}));
        expect(bad.status).toBe(400);
        const notAllowed = await kidDesignRoute(kidReq(f, 'POST', '/api/kids/designs', { template: 'bike_hook', params: { color: 'red' } }), params({}));
        expect(notAllowed.status).toBe(403);
    });

    it('golden workshop output -> BINDING print quote; ask within the limit emails the grown-up only', async () => {
        const f = await family();
        const worker = goldenKidWorker();
        const d = await createKidDesign(await kidSession(f), { template: 'name_keychain', params: { label: 'MIA', color: 'blue', size: 'small' } }, { fetchImpl: worker });
        expect(worker.calls[0]).toMatchObject({ url: 'http://cad-worker.test/v1/kid-templates/name_keychain/build', auth: 'Bearer worker-token', body: { template: 'name_keychain', params: { label: 'MIA', color: 'blue', size: 'small' } } });
        expect(d).toMatchObject({ status: 'priced', withinLimit: true, limitCents: 2500, templateTitle: 'Name keychain', options: { label: 'MIA', color: 'blue', size: 'small' } });
        expect(d.priceCents).toBeGreaterThan(0);
        const [row] = await ctx.db.select().from(kidDesigns).where(eq(kidDesigns.id, d.id));
        const [quote] = await ctx.db.select().from(quotes).where(eq(quotes.id, row!.quoteId!));
        expect(quote).toMatchObject({ trustLevel: 'BINDING', status: 'READY', subtotalCents: d.priceCents });
        const [build] = await ctx.db.select().from(builds).where(eq(builds.id, row!.buildId!));
        expect(build).toMatchObject({ origin: 'kids', ownerUserId: f.parent.userId, name: 'Name keychain (Kids project)' });
        expect(build!.name).not.toContain('MIA');

        // Pricing again reuses the still-valid quote (no second workshop call).
        const again = await priceKidDesign(await kidSession(f), d.id, { fetchImpl: worker });
        expect(again.priceCents).toBe(d.priceCents);
        expect(worker.calls).toHaveLength(1);

        const asked = await kidAskRoute(kidReq(f, 'POST', '/api/kids/requests', { designId: d.id }), params({}));
        expect(asked.status).toBe(201);
        expect(await asked.json()).toMatchObject({ stage: 'waiting', stageText: 'Waiting for a grown-up' });
        expect(notifySpy).toHaveBeenCalledTimes(1);
        const [kind, payload] = notifySpy.mock.calls[0]!;
        expect(kind).toBe('family.kid_request');
        expect(payload).toMatchObject({ to: f.parent.email, kidNickname: 'Mia', templateTitle: 'Name keychain', priceCents: d.priceCents });
        expect(JSON.stringify(payload)).not.toContain('MIA'); // the kid's words stay in the family inbox
        // Asking twice for the same design does not duplicate the request or the email.
        expect((await kidAskRoute(kidReq(f, 'POST', '/api/kids/requests', { designId: d.id }), params({}))).status).toBe(201);
        expect(await ctx.db.select().from(kidRequests).where(eq(kidRequests.designId, d.id))).toHaveLength(1);
        expect(notifySpy).toHaveBeenCalledTimes(1);
    });

    it('over the spending limit: a friendly refusal and no request', async () => {
        const f = await family();
        expect((await patchKidRoute(req('PATCH', `/api/family/kids/${f.kid.id}`, f.parent, { spendingLimitCents: 500 }), params({ kidId: f.kid.id }))).status).toBe(403); // locked to Kids mode
        await ctx.db.update(kidProfiles).set({ spendingLimitCents: 500 }).where(eq(kidProfiles.id, f.kid.id));
        const d = await pricedDesign(f);
        expect(d.priceCents!).toBeGreaterThan(500);
        expect(d).toMatchObject({ status: 'priced', withinLimit: false });
        expect(d.message).toMatch(/Pick a smaller option/);
        const res = await kidAskRoute(kidReq(f, 'POST', '/api/kids/requests', { designId: d.id }), params({}));
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.error.details).toMatchObject({ reason: 'OVER_LIMIT', limitCents: 500 });
        expect(body.error.message).toMatch(/Your grown-up said up to \$5\.00/);
        expect(await ctx.db.select().from(kidRequests).where(eq(kidRequests.kidId, f.kid.id))).toHaveLength(0);
        expect(notifySpy).not.toHaveBeenCalled();
    });
});

async function exitWith(f: Family, pin: string): Promise<Response> {
    return kidExitRoute(kidReq(f, 'POST', '/api/kids/exit', { pin }), params({}));
}

describe('grown-up decisions', () => {
    it('approve -> the grown-up’s own checkout with Prime benefits -> the kid sees it being made', async () => {
        const f = await family();
        const d = await pricedDesign(f);
        const thing = await askGrownUp(await kidSession(f), d.id);

        // The kid cannot approve or pay.
        expect((await approveRoute(kidReq(f, 'POST', `/api/family/requests/${thing.id}/approve`), params({ requestId: thing.id }))).status).toBe(403);

        // Exit with the PIN, then the grown-up (a Prime member) approves and pays.
        const exit = await exitWith(f, '2468');
        expect(exit.status).toBe(200);
        expect(setCookieValue(exit, KID_COOKIE)).toBe('');
        expect(await ctx.db.select().from(kidModeLocks).where(eq(kidModeLocks.kidId, f.kid.id))).toHaveLength(0);
        expect(await getViewer(req('GET', '/api/me', f.parent))).not.toBeNull();
        await startMembership({ id: f.parent.userId!, email: f.parent.email! }, 'monthly');

        const approved = await approveRoute(req('POST', `/api/family/requests/${thing.id}/approve`, f.parent), params({ requestId: thing.id }));
        expect(approved.status).toBe(200);
        const { checkoutUrl, quoteId } = await approved.json();
        expect(checkoutUrl).toBe(`/checkout/${quoteId}`);
        const checkout = await checkoutRoute(req('POST', '/api/checkout', f.parent, checkoutBody(quoteId, { buyer: { email: f.parent.email!, name: 'Grown Up' } })), params({}));
        expect(checkout.status).toBe(201);
        const co = await checkout.json();
        const [order] = await ctx.db.select().from(orders).where(eq(orders.id, co.orderId));
        expect(order).toMatchObject({ buyerUserId: f.parent.userId, quoteId });
        const [benefits] = await ctx.db.select().from(orderBenefits).where(eq(orderBenefits.orderId, co.orderId));
        expect(benefits).toMatchObject({ userId: f.parent.userId, priority: true, guaranteedDates: true });
        expect(benefits!.membershipId).toMatch(/^mem_/);

        await handlePaymentSucceeded({ provider: 'dev', providerRef: co.payment.providerRef, providerPaymentId: null, amountCents: co.payment.amountCents ?? co.totals.totalCents, currency: 'usd', eventId: `evt_${co.orderId}` });
        const view = (await (await familyRoute(req('GET', '/api/family', f.parent), params({}))).json()) as FamilyView;
        expect(view.primeMember).toBe(true);
        expect(view.requests[0]).toMatchObject({ status: 'approved', stage: 'making', order: { orderId: co.orderId } });
        expect(view.activity.map((a) => a.kind)).toEqual(expect.arrayContaining(['request_approved', 'kids_mode_ended', 'kids_mode_started', 'request_created']));
        // Paid: it cannot be declined or approved again.
        expect((await declineRoute(req('POST', `/api/family/requests/${thing.id}/decline`, f.parent, {}), params({ requestId: thing.id }))).status).toBe(409);
        // Back in Kids mode, My things shows the real order status.
        const things = await listKidThings(await kidSessionAfterExit(f));
        expect(things[0]).toMatchObject({ id: thing.id, stage: 'making', stageText: 'Yes! It’s being made' });
    });

    it('decline with a kind note flows back to the kid', async () => {
        const f = await family();
        const d = await pricedDesign(f);
        const thing = await askGrownUp(await kidSession(f), d.id);
        expect((await exitWith(f, '2468')).status).toBe(200);
        const res = await declineRoute(req('POST', `/api/family/requests/${thing.id}/decline`, f.parent, { note: 'Let’s make one together this weekend!' }), params({ requestId: thing.id }));
        expect(res.status).toBe(200);
        const back = await family2(f);
        const things = (await (await kidThingsRoute(kidReq(back, 'GET', '/api/kids/things'), params({}))).json()).items as KidThingView[];
        expect(things[0]).toMatchObject({ stage: 'not_this_time', stageText: 'Not this time', note: 'Let’s make one together this weekend!' });
        expect((await approveRoute(req('POST', `/api/family/requests/${thing.id}/approve`, f.parent), params({ requestId: thing.id }))).status).toBe(403); // back in Kids mode
    });

    it('exit needs the right PIN and is rate limited per grown-up', async () => {
        const f = await family();
        for (let i = 0; i < 4; i++) expect((await exitWith(f, '0000')).status).toBe(403);
        expect((await exitWith(f, '2468')).status).toBe(200); // 5th attempt, right PIN
        const g = await family2(f);
        for (let i = 0; i < 5; i++) await exitWith(g, '0000');
        expect((await exitWith(g, '2468')).status).toBe(429);
        expect(await getViewer(req('GET', '/api/me', f.parent))).toBeNull();
    });
});

/** Hand the same family's kid off again (after an exit). */
async function family2(f: Family): Promise<Family> {
    const handed = await handOffRoute(req('POST', `/api/family/kids/${f.kid.id}/hand-off`, f.parent), params({ kidId: f.kid.id }));
    expect(handed.status).toBe(200);
    return { ...f, kidCookie: setCookieValue(handed, KID_COOKIE)! };
}

async function kidSessionAfterExit(f: Family) {
    return kidSession(await family2(f));
}

describe('isolation and deletion', () => {
    it('a kid session cannot read or act on another family’s data', async () => {
        const a = await family('Mia');
        const b = await family('Zed');
        const designA = await pricedDesign(a);
        const thingA = await askGrownUp(await kidSession(a), designA.id);
        await expect(priceKidDesign(await kidSession(b), designA.id)).rejects.toMatchObject({ status: 404 });
        await expect(askGrownUp(await kidSession(b), designA.id)).rejects.toMatchObject({ status: 404 });
        expect(await listKidThings(await kidSession(b))).toEqual([]);
        expect((await kidAskRoute(kidReq(b, 'POST', '/api/kids/requests', { designId: designA.id }), params({}))).status).toBe(404);
        // A kid cookie from family A with family B's grown-up session is no kid session.
        const mixed = req('GET', '/api/kids/me', null, undefined, withKid(b.parent, a.kidCookie));
        expect((await kidMeRoute(mixed, params({}))).status).toBe(401);
        // Family B's grown-up cannot approve family A's request.
        expect((await exitWith(b, '2468')).status).toBe(200);
        await expect(approveKidRequest(b.parent.userId!, thingA.id)).rejects.toMatchObject({ status: 404 });
        const viewB = (await (await familyRoute(req('GET', '/api/family', b.parent), params({}))).json()) as FamilyView;
        expect(viewB.requests).toEqual([]);
        expect(viewB.kids.map((k) => k.nickname)).toEqual(['Zed']);
    });

    it('deleting a profile removes its designs, requests, activity and unordered builds in one call', async () => {
        const f = await family();
        const d1 = await pricedDesign(f, 'ONE');
        const d2 = await pricedDesign(f, 'TWO');
        await askGrownUp(await kidSession(f), d1.id);
        const [r1] = await ctx.db.select().from(kidDesigns).where(eq(kidDesigns.id, d1.id));
        const [r2] = await ctx.db.select().from(kidDesigns).where(eq(kidDesigns.id, d2.id));
        expect((await exitWith(f, '2468')).status).toBe(200);
        const res = await deleteKidRoute(req('DELETE', `/api/family/kids/${f.kid.id}`, f.parent), params({ kidId: f.kid.id }));
        expect(res.status).toBe(200);
        expect(await ctx.db.select().from(kidProfiles).where(eq(kidProfiles.id, f.kid.id))).toHaveLength(0);
        expect(await ctx.db.select().from(kidDesigns).where(eq(kidDesigns.kidId, f.kid.id))).toHaveLength(0);
        expect(await ctx.db.select().from(kidRequests).where(eq(kidRequests.kidId, f.kid.id))).toHaveLength(0);
        expect(await ctx.db.select().from(familyActivity).where(and(eq(familyActivity.kidId, f.kid.id)))).toHaveLength(0);
        expect(await ctx.db.select().from(builds).where(eq(builds.id, r1!.buildId!))).toHaveLength(0);
        expect(await ctx.db.select().from(builds).where(eq(builds.id, r2!.buildId!))).toHaveLength(0);
        const log = await ctx.db.select().from(familyActivity).where(eq(familyActivity.ownerUserId, f.parent.userId!));
        expect(log.map((a) => a.kind).sort()).toEqual(['kid_removed', 'pin_set']);
        for (const a of log) expect(a.summary).not.toContain('Mia');
        // The old kid cookie is dead.
        expect((await kidMeRoute(kidReq(f, 'GET', '/api/kids/me'), params({}))).status).toBe(401);
    });
});
