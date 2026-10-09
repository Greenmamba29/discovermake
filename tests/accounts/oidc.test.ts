/**
 * Google / Apple sign-in: provider gating, the redirect (state + PKCE / nonce cookies),
 * callback rejection on state mismatch, claim validation (aud, verified email, nonce),
 * account linking by provider subject, and safe `next` redirects. The arctic token
 * exchange is replaced with a stub that returns a crafted ID token.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MeResponse, SESSION_COOKIE } from '@/contracts/account';
import { oauthAccounts, users } from '@/server/db/schema';
import { resetEnvCache } from '@/server/env';
import { OAUTH_COOKIE, setOidcClients } from '@/server/auth/oidc';
import { GET as startRoute } from '@/app/api/auth/oauth/[provider]/route';
import { GET as callbackGet, POST as callbackPost } from '@/app/api/auth/oauth/[provider]/callback/route';
import { GET as meRoute } from '@/app/api/me/route';
import { useTestDb } from '../support/db';
import { BASE, newDevice, params, req, setCookieValue } from './helpers';

const jwt = (claims: Record<string, unknown>) => `${Buffer.from('{"alg":"RS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
const exp = () => Math.floor(Date.now() / 1000) + 600;
const googleClaims = (over: Record<string, unknown> = {}) => ({ iss: 'https://accounts.google.com', aud: 'google-client-id', exp: exp(), sub: 'g-sub-1', email: 'Grace@Gmail.com', email_verified: true, name: 'Grace H', ...over });

let nextIdToken = '';
const exchanged: unknown[][] = [];

function callbackReq(provider: string, query: Record<string, string>, cookies: Record<string, string>, device = newDevice()) {
    const cookie = [`dm_device=${device.device}`, ...Object.entries(cookies).map(([k, v]) => `${k}=${encodeURIComponent(v)}`)].join('; ');
    return new Request(`${BASE}/api/auth/oauth/${provider}/callback?${new URLSearchParams(query)}`, { headers: { cookie } });
}

describe('OIDC sign-in', () => {
    const ctx = useTestDb();
    beforeAll(() => {
        process.env.GOOGLE_CLIENT_ID = 'google-client-id';
        process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
        resetEnvCache();
        setOidcClients({
            google: () => ({
                createAuthorizationURL: (state: string, verifier: string, scopes: string[]) => {
                    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
                    u.searchParams.set('state', state);
                    u.searchParams.set('code_challenge', `S256:${verifier.length}`);
                    u.searchParams.set('scope', scopes.join(' '));
                    return u;
                },
                validateAuthorizationCode: async (...args: unknown[]) => {
                    exchanged.push(args);
                    return { idToken: () => nextIdToken } as never;
                },
            }),
            apple: () => ({
                createAuthorizationURL: (state: string) => new URL(`https://appleid.apple.com/auth/authorize?state=${state}`),
                validateAuthorizationCode: async () => ({ idToken: () => nextIdToken }) as never,
            }),
        });
    });
    afterAll(() => {
        setOidcClients(null);
        for (const k of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'APPLE_CLIENT_ID', 'APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY']) delete process.env[k];
        resetEnvCache();
    });

    it('offers only configured providers; unconfigured ones are 404', async () => {
        const me = MeResponse.parse(await (await meRoute(req('GET', '/api/me', null), params({}))).json());
        expect(me.providers).toEqual(['email', 'passkey', 'google']);
        expect((await startRoute(req('GET', '/api/auth/oauth/apple', null), params({ provider: 'apple' }))).status).toBe(404);
        expect((await startRoute(req('GET', '/api/auth/oauth/github', null), params({ provider: 'github' }))).status).toBe(404);
    });

    it('redirects to Google with state + PKCE and remembers a safe `next`', async () => {
        const res = await startRoute(req('GET', '/api/auth/oauth/google?next=/builds?tab=ordered', null), params({ provider: 'google' }));
        expect(res.status).toBe(302);
        const location = new URL(res.headers.get('location')!);
        expect(location.host).toBe('accounts.google.com');
        const state = setCookieValue(res, OAUTH_COOKIE.state);
        expect(location.searchParams.get('state')).toBe(state);
        expect(setCookieValue(res, OAUTH_COOKIE.verifier)).toMatch(/^[A-Za-z0-9_-]{40,}$/);
        expect(setCookieValue(res, OAUTH_COOKIE.next)).toBe('/builds?tab=ordered');
        const stateCookie = res.headers.getSetCookie().find((c) => c.startsWith(`${OAUTH_COOKIE.state}=`))!;
        expect(stateCookie).toMatch(/HttpOnly/i);
        expect(stateCookie).toMatch(/Path=\/api\/auth\/oauth/);

        const evil = await startRoute(req('GET', '/api/auth/oauth/google?next=//evil.example/x', null), params({ provider: 'google' }));
        expect(setCookieValue(evil, OAUTH_COOKIE.next)).toBe('/builds');
    });

    it('rejects a callback whose state does not match (or has no state cookie): no session, no token exchange', async () => {
        exchanged.length = 0;
        nextIdToken = jwt(googleClaims());
        const mismatch = await callbackGet(callbackReq('google', { code: 'c', state: 'attacker-state' }, { [OAUTH_COOKIE.state]: 'real-state', [OAUTH_COOKIE.verifier]: 'v'.repeat(43) }), params({ provider: 'google' }));
        expect(mismatch.status).toBe(303);
        expect(mismatch.headers.get('location')).toBe(`${BASE}/signin?error=state`);
        expect(setCookieValue(mismatch, SESSION_COOKIE)).toBeNull();

        const noCookie = await callbackGet(callbackReq('google', { code: 'c', state: 'real-state' }, {}), params({ provider: 'google' }));
        expect(noCookie.headers.get('location')).toBe(`${BASE}/signin?error=state`);
        expect(exchanged).toHaveLength(0);
        expect(await ctx.db.select().from(users)).toHaveLength(0);
    });

    it('signs in with a verified Google email, links the account, and keeps the link when the email changes', async () => {
        nextIdToken = jwt(googleClaims());
        const cookies = { [OAUTH_COOKIE.state]: 's1', [OAUTH_COOKIE.verifier]: 'v'.repeat(43), [OAUTH_COOKIE.next]: '/me' };
        const res = await callbackGet(callbackReq('google', { code: 'good', state: 's1' }, cookies), params({ provider: 'google' }));
        expect(res.status).toBe(303);
        expect(res.headers.get('location')).toBe(`${BASE}/me`);
        expect(setCookieValue(res, SESSION_COOKIE)).toMatch(/^dms_/);
        expect(setCookieValue(res, OAUTH_COOKIE.state)).toBe('');
        expect(exchanged.at(-1)).toEqual(['good', 'v'.repeat(43)]);
        const [u] = await ctx.db.select().from(users).where(eq(users.email, 'grace@gmail.com'));
        expect(u).toMatchObject({ displayName: 'Grace H' });
        expect(u.emailVerifiedAt).not.toBeNull();
        expect(await ctx.db.select().from(oauthAccounts).where(eq(oauthAccounts.userId, u.id))).toMatchObject([{ provider: 'google', providerUserId: 'g-sub-1' }]);

        nextIdToken = jwt(googleClaims({ email: 'grace@newmail.com' }));
        await callbackGet(callbackReq('google', { code: 'good', state: 's2' }, { ...cookies, [OAUTH_COOKIE.state]: 's2' }), params({ provider: 'google' }));
        expect(await ctx.db.select().from(users).where(eq(users.email, 'grace@newmail.com'))).toHaveLength(0);
    });

    it('refuses unverified emails, wrong audiences and denied consent', async () => {
        const cookies = { [OAUTH_COOKIE.state]: 's', [OAUTH_COOKIE.verifier]: 'v'.repeat(43) };
        const run = async (claims: Record<string, unknown>, query: Record<string, string> = { code: 'c', state: 's' }) => {
            nextIdToken = jwt(claims);
            const res = await callbackGet(callbackReq('google', query, cookies), params({ provider: 'google' }));
            expect(setCookieValue(res, SESSION_COOKIE)).toBeNull();
            return res.headers.get('location');
        };
        expect(await run(googleClaims({ sub: 'g-2', email: 'u@x.com', email_verified: false }))).toBe(`${BASE}/signin?error=unverified_email`);
        expect(await run(googleClaims({ sub: 'g-3', aud: 'someone-else' }))).toBe(`${BASE}/signin?error=claims`);
        expect(await run(googleClaims({ sub: 'g-4', exp: 1000 }))).toBe(`${BASE}/signin?error=claims`);
        expect(await run(googleClaims(), { state: 's', error: 'access_denied' })).toBe(`${BASE}/signin?error=denied`);
    });

    it('Apple: form_post callback with a nonce-bound ID token', async () => {
        Object.assign(process.env, { APPLE_CLIENT_ID: 'com.discovermake.web', APPLE_TEAM_ID: 'TEAM', APPLE_KEY_ID: 'KEY', APPLE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nAAAA\\n-----END PRIVATE KEY-----' });
        resetEnvCache();
        const start = await startRoute(req('GET', '/api/auth/oauth/apple', null), params({ provider: 'apple' }));
        const location = new URL(start.headers.get('location')!);
        expect(location.searchParams.get('response_mode')).toBe('form_post');
        const nonce = setCookieValue(start, OAUTH_COOKIE.nonce)!;
        expect(location.searchParams.get('nonce')).toBe(nonce);
        expect(start.headers.getSetCookie().find((c) => c.startsWith(`${OAUTH_COOKIE.state}=`))).toMatch(/SameSite=None/i);

        const post = (claims: Record<string, unknown>) => {
            nextIdToken = jwt({ iss: 'https://appleid.apple.com', aud: 'com.discovermake.web', exp: exp(), sub: 'apple-sub', email: 'relay@privaterelay.appleid.com', email_verified: 'true', ...claims });
            return callbackPost(
                new Request(`${BASE}/api/auth/oauth/apple/callback`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `${OAUTH_COOKIE.state}=st; ${OAUTH_COOKIE.nonce}=${nonce}`, origin: 'https://appleid.apple.com' },
                    body: new URLSearchParams({ code: 'apple-code', state: 'st' }).toString(),
                }),
                params({ provider: 'apple' }),
            );
        };
        const bad = await post({ nonce: 'other' });
        expect(bad.headers.get('location')).toBe(`${BASE}/signin?error=claims`);
        const ok = await post({ nonce });
        expect(ok.headers.get('location')).toBe(`${BASE}/builds`);
        expect(setCookieValue(ok, SESSION_COOKIE)).toMatch(/^dms_/);
    });
});
