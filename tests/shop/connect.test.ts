import { and, eq } from 'drizzle-orm';
import Stripe from 'stripe';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AdminShopConnectLinkResponse, ShopConnectLinkResponse, ShopPayoutStatusResponse } from '@/contracts/connect';
import { POST as adminConnect } from '@/app/api/admin/shops/[shopId]/connect/route';
import { POST as shopConnect } from '@/app/api/shop/payouts/connect/route';
import { GET as shopStatus } from '@/app/api/shop/payouts/status/route';
import { POST as login } from '@/app/api/shop/session/route';
import { POST as connectWebhook } from '@/app/api/webhooks/stripe-connect/route';
import { DEV_SHOP_ID } from '@/server/db/seed';
import { domainEvents, shops, webhookEvents } from '@/server/db/schema';
import { resetEnvCache } from '@/server/env';
import { setStripeClientForTests } from '@/server/payments/stripe';
import { issueShopToken } from '@/server/shops/admin';
import { useTestDb } from '../support/db';
import { createShopFixture, quietConsole } from './fixtures';

const BASE = 'http://localhost:3100';
const ADMIN = { authorization: 'Bearer test-admin-token' };
const SHOP_TOKEN = 'dmshop_test_token_for_connect_0123456789';
const WHSEC = 'whsec_test_connect_suite';
const params = <P>(p: P) => ({ params: Promise.resolve(p) });
const noParams = params({});

function req(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
    return new Request(`${BASE}${path}`, {
        method: init.method ?? 'GET',
        headers: { ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
}

async function sessionFor(token: string): Promise<{ cookie: string }> {
    const res = await login(req('/api/shop/session', { method: 'POST', body: { token } }), noParams);
    expect(res.status).toBe(200);
    const m = /dm_shop_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '');
    if (!m) throw new Error('no session cookie');
    return { cookie: `dm_shop_session=${m[1]}` };
}

type Call = { method: string; path: string; body: URLSearchParams; headers: Headers };

/** Stripe SDK with a stubbed fetch client: no network. Accounts are kept in memory. */
function stubStripe(opts: { flags?: Partial<Record<'charges_enabled' | 'payouts_enabled' | 'details_submitted', boolean>> } = {}) {
    process.env.STRIPE_SECRET_KEY = 'sk_test_connect_suite';
    resetEnvCache();
    const calls: Call[] = [];
    let seq = 0;
    const fetchFn = vi.fn(async (url: string | URL, init?: RequestInit) => {
        const u = new URL(String(url));
        const method = (init?.method ?? 'GET').toUpperCase();
        const call: Call = { method, path: u.pathname, body: new URLSearchParams(String(init?.body ?? '')), headers: new Headers(init?.headers as HeadersInit) };
        calls.push(call);
        let body: unknown;
        if (method === 'POST' && u.pathname === '/v1/accounts') {
            seq += 1;
            body = { id: `acct_test${seq}${call.body.get('metadata[shop_id]')?.slice(-6) ?? ''}`, object: 'account', type: 'express', charges_enabled: false, payouts_enabled: false, details_submitted: false };
        } else if (method === 'POST' && u.pathname === '/v1/account_links') {
            body = { object: 'account_link', url: `https://connect.stripe.com/setup/e/${call.body.get('account')}/link${calls.length}`, created: 1, expires_at: 2 };
        } else if (method === 'GET' && u.pathname.startsWith('/v1/accounts/')) {
            body = {
                id: u.pathname.split('/').pop(),
                object: 'account',
                charges_enabled: false,
                payouts_enabled: false,
                details_submitted: false,
                ...opts.flags,
            };
        } else {
            return new Response(JSON.stringify({ error: { type: 'invalid_request_error', message: `unexpected ${method} ${u.pathname}` } }), { status: 400, headers: { 'content-type': 'application/json' } });
        }
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } });
    });
    setStripeClientForTests(new Stripe('sk_test_connect_suite', { httpClient: Stripe.createFetchHttpClient(fetchFn as unknown as typeof fetch), maxNetworkRetries: 0 }));
    return calls;
}

function accountUpdated(eventId: string, accountId: string, flags: { payouts_enabled: boolean; charges_enabled?: boolean; details_submitted?: boolean }, metadata: Record<string, string> = {}) {
    return {
        id: eventId,
        object: 'event',
        type: 'account.updated',
        account: accountId,
        api_version: '2025-12-15.clover',
        created: Math.floor(Date.now() / 1000),
        livemode: false,
        pending_webhooks: 1,
        request: { id: null, idempotency_key: null },
        data: { object: { id: accountId, object: 'account', charges_enabled: false, details_submitted: true, metadata, ...flags } },
    };
}

function webhookPost(payload: string, signature: string | null) {
    return connectWebhook(
        new Request(`${BASE}/api/webhooks/stripe-connect`, { method: 'POST', headers: signature ? { 'stripe-signature': signature } : {}, body: payload }),
        noParams,
    );
}

function signed(event: unknown) {
    const payload = JSON.stringify(event);
    return { payload, header: Stripe.webhooks.generateTestHeaderString({ payload, secret: WHSEC }) };
}

async function shopEvents(db: ReturnType<typeof useTestDb>['db'], type: 'shop.connect_account_created' | 'shop.connect_account_updated') {
    return db.select().from(domainEvents).where(eq(domainEvents.eventType, type));
}

describe('Stripe Connect shop payout onboarding', () => {
    const ctx = useTestDb({ seed: { shopToken: SHOP_TOKEN } });
    let shopA: { cookie: string };
    let shopBId: string;
    let shopB: { cookie: string };

    beforeAll(async () => {
        quietConsole();
        shopA = await sessionFor(SHOP_TOKEN);
        shopBId = (await createShopFixture(ctx.db, { name: 'Camden Connect Cutters' })).shopId;
        const tokenB = await issueShopToken(shopBId, { label: 'connect-suite' });
        shopB = await sessionFor(tokenB.token);
    });

    afterEach(() => {
        setStripeClientForTests(null);
        delete process.env.STRIPE_SECRET_KEY;
        delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
        resetEnvCache();
    });

    it('answers 503 "Stripe is not configured" without keys (and still requires auth first)', async () => {
        expect((await shopConnect(req('/api/shop/payouts/connect', { method: 'POST' }), noParams)).status).toBe(401);
        expect((await shopStatus(req('/api/shop/payouts/status'), noParams)).status).toBe(401);

        for (const res of [
            await shopConnect(req('/api/shop/payouts/connect', { method: 'POST', headers: shopA }), noParams),
            await shopStatus(req('/api/shop/payouts/status', { headers: shopA }), noParams),
            await adminConnect(req(`/api/admin/shops/${DEV_SHOP_ID}/connect`, { method: 'POST', headers: ADMIN }), params({ shopId: DEV_SHOP_ID })),
        ]) {
            expect(res.status).toBe(503);
            expect(((await res.json()) as { error: { message: string } }).error.message).toBe('Stripe is not configured');
        }
        const { payload, header } = signed(accountUpdated('evt_conn_nokeys', 'acct_nokeys', { payouts_enabled: true }));
        expect((await webhookPost(payload, header)).status).toBe(503);

        const [shop] = await ctx.db.select().from(shops).where(eq(shops.id, DEV_SHOP_ID));
        expect(shop.stripeAccountId).toBeNull();
    });

    it('creates the Express account once, then reuses it for every new onboarding link', async () => {
        const calls = stubStripe();
        const before = await shopStatus(req('/api/shop/payouts/status', { headers: shopA }), noParams);
        expect(ShopPayoutStatusResponse.parse(await before.json())).toEqual({ connected: false });

        const first = await shopConnect(req('/api/shop/payouts/connect', { method: 'POST', headers: shopA }), noParams);
        expect(first.status).toBe(200);
        const link1 = ShopConnectLinkResponse.parse(await first.json());
        expect(Object.keys(link1)).toEqual(['url']);

        const creates = calls.filter((c) => c.method === 'POST' && c.path === '/v1/accounts');
        expect(creates).toHaveLength(1);
        const create = creates[0];
        expect(create.body.get('type')).toBe('express');
        expect(create.body.get('country')).toBe('US');
        expect(create.body.get('capabilities[transfers][requested]')).toBe('true');
        expect(create.body.get('metadata[shop_id]')).toBe(DEV_SHOP_ID);
        expect(create.body.get('business_profile[name]')).toBeTruthy();
        // http://localhost is not a public URL: Stripe would reject it, so it is left out.
        expect(create.body.has('business_profile[url]')).toBe(false);
        expect(create.headers.get('idempotency-key')).toBe(`connect-account:${DEV_SHOP_ID}`);

        const [shop] = await ctx.db.select().from(shops).where(eq(shops.id, DEV_SHOP_ID));
        expect(shop.stripeAccountId).toMatch(/^acct_test1/);
        // Onboarding only started: the ledger must keep paying this shop manually.
        expect(shop.stripePayoutsEnabled).toBe(false);
        const linkCall = calls.find((c) => c.path === '/v1/account_links')!;
        expect(linkCall.body.get('account')).toBe(shop.stripeAccountId);
        expect(linkCall.body.get('type')).toBe('account_onboarding');
        expect(linkCall.body.get('return_url')).toBe(`${BASE}/shop/payouts?status=return`);
        expect(linkCall.body.get('refresh_url')).toBe(`${BASE}/shop/payouts?status=refresh`);

        const created = await shopEvents(ctx.db, 'shop.connect_account_created');
        expect(created).toHaveLength(1);
        expect(created[0].payload).toEqual({ shopId: DEV_SHOP_ID, accountId: shop.stripeAccountId });
        expect(created[0].actorId).toBe(`shop:${DEV_SHOP_ID}`);

        // Second call: no new account, a fresh link for the same account.
        const second = await shopConnect(req('/api/shop/payouts/connect', { method: 'POST', headers: shopA, body: {} }), noParams);
        expect(second.status).toBe(200);
        const link2 = ShopConnectLinkResponse.parse(await second.json());
        expect(link2.url).not.toBe(link1.url);
        expect(calls.filter((c) => c.method === 'POST' && c.path === '/v1/accounts')).toHaveLength(1);
        expect(calls.filter((c) => c.path === '/v1/account_links').map((c) => c.body.get('account'))).toEqual([shop.stripeAccountId, shop.stripeAccountId]);
        expect(await shopEvents(ctx.db, 'shop.connect_account_created')).toHaveLength(1);

        // Input validation and CSRF defence on the cookie-authenticated mutation.
        expect((await shopConnect(req('/api/shop/payouts/connect', { method: 'POST', headers: shopA, body: { shopId: shopBId } }), noParams)).status).toBe(400);
        expect((await shopConnect(req('/api/shop/payouts/connect', { method: 'POST', headers: { ...shopA, origin: 'https://evil.example' } }), noParams)).status).toBe(403);
    });

    it('reads the status live from Stripe on every call', async () => {
        const calls = stubStripe({ flags: { charges_enabled: true, payouts_enabled: false, details_submitted: true } });
        const [shop] = await ctx.db.select().from(shops).where(eq(shops.id, DEV_SHOP_ID));
        const a = ShopPayoutStatusResponse.parse(await (await shopStatus(req('/api/shop/payouts/status', { headers: shopA }), noParams)).json());
        expect(a).toEqual({ connected: true, chargesEnabled: true, payoutsEnabled: false, detailsSubmitted: true });
        await shopStatus(req('/api/shop/payouts/status', { headers: shopA }), noParams);
        const retrieves = calls.filter((c) => c.method === 'GET');
        expect(retrieves.map((c) => c.path)).toEqual([`/v1/accounts/${shop.stripeAccountId}`, `/v1/accounts/${shop.stripeAccountId}`]);
        const [after] = await ctx.db.select().from(shops).where(eq(shops.id, DEV_SHOP_ID));
        expect(after.stripePayoutsEnabled).toBe(false);
    });

    it("keeps shops isolated: a shop only ever sees and links its own account", async () => {
        const calls = stubStripe({ flags: { payouts_enabled: true } });
        const [a] = await ctx.db.select().from(shops).where(eq(shops.id, DEV_SHOP_ID));

        // Shop B has not started: it must not see shop A's connected account.
        expect(ShopPayoutStatusResponse.parse(await (await shopStatus(req('/api/shop/payouts/status', { headers: shopB }), noParams)).json())).toEqual({ connected: false });
        expect(calls).toHaveLength(0);

        expect((await shopConnect(req('/api/shop/payouts/connect', { method: 'POST', headers: shopB }), noParams)).status).toBe(200);
        const [b] = await ctx.db.select().from(shops).where(eq(shops.id, shopBId));
        expect(b.stripeAccountId).toBeTruthy();
        expect(b.stripeAccountId).not.toBe(a.stripeAccountId);
        expect(calls.find((c) => c.path === '/v1/accounts')!.body.get('metadata[shop_id]')).toBe(shopBId);
        expect(calls.find((c) => c.path === '/v1/account_links')!.body.get('account')).toBe(b.stripeAccountId);

        await shopStatus(req('/api/shop/payouts/status', { headers: shopB }), noParams);
        expect(calls.filter((c) => c.method === 'GET').map((c) => c.path)).toEqual([`/v1/accounts/${b.stripeAccountId}`]);
        // The live read synced shop B's payout routing flag; shop A's account is untouched.
        const [bAfter] = await ctx.db.select().from(shops).where(eq(shops.id, shopBId));
        expect(bAfter.stripePayoutsEnabled).toBe(true);
        const [aAfter] = await ctx.db.select().from(shops).where(eq(shops.id, DEV_SHOP_ID));
        expect(aAfter.stripeAccountId).toBe(a.stripeAccountId);
        expect(aAfter.stripePayoutsEnabled).toBe(false);
    });

    it('admin onboarding requires the bearer token and creates or reuses the account', async () => {
        const calls = stubStripe();
        const fresh = (await createShopFixture(ctx.db, { name: 'Ops Onboarded Metal', status: 'PENDING' })).shopId;
        const url = `/api/admin/shops/${fresh}/connect`;

        expect((await adminConnect(req(url, { method: 'POST' }), params({ shopId: fresh }))).status).toBe(401);
        expect((await adminConnect(req(url, { method: 'POST', headers: { authorization: 'Bearer nope' } }), params({ shopId: fresh }))).status).toBe(401);
        // A shop session is not an admin credential.
        expect((await adminConnect(req(url, { method: 'POST', headers: shopA }), params({ shopId: fresh }))).status).toBe(401);
        expect(calls).toHaveLength(0);

        const res = await adminConnect(req(url, { method: 'POST', headers: ADMIN }), params({ shopId: fresh }));
        expect(res.status).toBe(200);
        const body = AdminShopConnectLinkResponse.parse(await res.json());
        expect(body.created).toBe(true);
        const [row] = await ctx.db.select().from(shops).where(eq(shops.id, fresh));
        expect(body.accountId).toBe(row.stripeAccountId);
        const created = await shopEvents(ctx.db, 'shop.connect_account_created');
        expect(created.find((e) => (e.payload as { shopId: string }).shopId === fresh)?.actorId).toBe('admin:ops');

        const again = AdminShopConnectLinkResponse.parse(await (await adminConnect(req(url, { method: 'POST', headers: ADMIN }), params({ shopId: fresh }))).json());
        expect(again).toMatchObject({ created: false, accountId: row.stripeAccountId });
        expect(calls.filter((c) => c.method === 'POST' && c.path === '/v1/accounts')).toHaveLength(1);

        expect((await adminConnect(req('/api/admin/shops/shop_missing0000000000/connect', { method: 'POST', headers: ADMIN }), params({ shopId: 'shop_missing0000000000' }))).status).toBe(404);
        expect((await adminConnect(req('/api/admin/shops/not-a-shop/connect', { method: 'POST', headers: ADMIN }), params({ shopId: 'not-a-shop' }))).status).toBe(404);
    });

    it('verifies the Connect webhook signature, emits shop.connect_account_updated once, and ignores replays', async () => {
        process.env.STRIPE_CONNECT_WEBHOOK_SECRET = WHSEC;
        resetEnvCache();
        const [shop] = await ctx.db.select().from(shops).where(eq(shops.id, DEV_SHOP_ID));
        const accountId = shop.stripeAccountId!;
        const { payload, header } = signed(accountUpdated('evt_conn_1', accountId, { payouts_enabled: true, charges_enabled: true }));

        // Bad signatures: missing header, wrong secret, tampered body.
        expect((await webhookPost(payload, null)).status).toBe(400);
        expect((await webhookPost(payload, Stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_wrong' }))).status).toBe(400);
        expect((await webhookPost(payload.replace('"payouts_enabled":true', '"payouts_enabled":false'), header)).status).toBe(400);
        expect(await shopEvents(ctx.db, 'shop.connect_account_updated')).toHaveLength(0);
        expect(await ctx.db.select().from(webhookEvents).where(eq(webhookEvents.eventId, 'evt_conn_1'))).toHaveLength(0);

        const ok = await webhookPost(payload, header);
        expect(ok.status).toBe(200);
        expect(await ok.json()).toEqual({ received: true });
        let updated = await shopEvents(ctx.db, 'shop.connect_account_updated');
        expect(updated).toHaveLength(1);
        expect(updated[0].payload).toEqual({ shopId: DEV_SHOP_ID, accountId, payoutsEnabled: true, chargesEnabled: true, detailsSubmitted: true });
        expect(updated[0].actorId).toBe('payment_provider:stripe');
        const [enabled] = await ctx.db.select().from(shops).where(eq(shops.id, DEV_SHOP_ID));
        expect(enabled.stripePayoutsEnabled).toBe(true);

        // Replay (same event id, freshly signed): acknowledged, not re-applied.
        const replay = signed(accountUpdated('evt_conn_1', accountId, { payouts_enabled: true, charges_enabled: true }));
        expect((await webhookPost(replay.payload, replay.header)).status).toBe(200);
        updated = await shopEvents(ctx.db, 'shop.connect_account_updated');
        expect(updated).toHaveLength(1);
        const [row] = await ctx.db.select().from(webhookEvents).where(and(eq(webhookEvents.provider, 'stripe_connect'), eq(webhookEvents.eventId, 'evt_conn_1')));
        expect(row.processedAt).not.toBeNull();
        expect(row.eventType).toBe('account.updated');

        // Unknown account and another deployment's account: recorded, no event.
        const unknown = signed(accountUpdated('evt_conn_2', 'acct_someoneelse', { payouts_enabled: true }));
        expect((await webhookPost(unknown.payload, unknown.header)).status).toBe(200);
        const foreign = signed(accountUpdated('evt_conn_3', accountId, { payouts_enabled: false }, { dm_app: 'staging.discovermake.com' }));
        expect((await webhookPost(foreign.payload, foreign.header)).status).toBe(200);
        expect(await shopEvents(ctx.db, 'shop.connect_account_updated')).toHaveLength(1);
        const [stillEnabled] = await ctx.db.select().from(shops).where(eq(shops.id, DEV_SHOP_ID));
        expect(stillEnabled.stripePayoutsEnabled).toBe(true);

        // Other event types are acknowledged and ignored.
        const other = signed({ ...accountUpdated('evt_conn_4', accountId, { payouts_enabled: true }), type: 'capability.updated' });
        expect((await webhookPost(other.payload, other.header)).status).toBe(200);
        expect(await shopEvents(ctx.db, 'shop.connect_account_updated')).toHaveLength(1);
    });

    it('refuses to hand out an onboarding link that is not Stripe-hosted https', async () => {
        stubStripe();
        const bad = new Stripe('sk_test_connect_suite', {
            httpClient: Stripe.createFetchHttpClient((async (url: string | URL) => {
                const u = new URL(String(url));
                const body = u.pathname === '/v1/account_links' ? { object: 'account_link', url: 'https://evil.example/phish', created: 1, expires_at: 2 } : {};
                return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
            }) as unknown as typeof fetch),
            maxNetworkRetries: 0,
        });
        setStripeClientForTests(bad);
        const res = await shopConnect(req('/api/shop/payouts/connect', { method: 'POST', headers: shopA }), noParams);
        expect(res.status).toBe(502);
        expect(JSON.stringify(await res.json())).not.toContain('evil.example');
    });

    it('rejects oversized webhook bodies before verifying them', async () => {
        process.env.STRIPE_CONNECT_WEBHOOK_SECRET = WHSEC;
        resetEnvCache();
        const huge = 'x'.repeat(1024 * 1024 + 1);
        expect((await webhookPost(huge, 't=1,v1=deadbeef')).status).toBe(413);
    });
});
