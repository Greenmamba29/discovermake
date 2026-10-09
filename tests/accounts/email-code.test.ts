/** Email sign-in codes: HMAC storage, devCode, wrong-code attempts, expiry, one use, rate limits, verify route. */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { EmailStartResponse, SESSION_COOKIE, SignInResponse } from '@/contracts/account';
import { authChallenges } from '@/server/db/schema';
import { emailStartIpLimiter, emailVerifyIpLimiter, hashEmailCode, startEmailSignIn, verifyEmailCode, EMAIL_CODE_IP_LIMIT } from '@/server/auth/email-code';
import { POST as startRoute } from '@/app/api/auth/email/start/route';
import { POST as verifyRoute } from '@/app/api/auth/email/verify/route';
import { useTestDb } from '../support/db';
import { newDevice, params, req, setCookieValue } from './helpers';

const fresh = () => `e${Math.random().toString(36).slice(2)}@Example.com`;

describe('email sign-in codes', () => {
    const ctx = useTestDb();
    beforeEach(async () => {
        await emailStartIpLimiter.reset();
        await emailVerifyIpLimiter.reset();
    });

    it('stores an HMAC of the code (never the code) and returns devCode without an email provider', async () => {
        const res = await startEmailSignIn(fresh());
        expect(res.devCode).toMatch(/^\d{6}$/);
        const [row] = await ctx.db.select().from(authChallenges).where(eq(authChallenges.id, res.challengeId));
        expect(row.email).toBe(row.email!.toLowerCase());
        expect(row.codeHash).toBe(hashEmailCode(res.challengeId, res.devCode!));
        expect(row.codeHash).not.toContain(res.devCode!);
        expect(new Date(res.expiresAt).getTime() - row.createdAt.getTime()).toBe(10 * 60_000);
    });

    it('counts wrong codes and locks the challenge after 5 attempts', async () => {
        const { challengeId, devCode } = await startEmailSignIn(fresh());
        const wrong = devCode === '000000' ? '111111' : '000000';
        for (let left = 4; left >= 1; left--) {
            await expect(verifyEmailCode(challengeId, wrong)).rejects.toMatchObject({ status: 400, details: { reason: 'wrong_code', attemptsLeft: left } });
        }
        await expect(verifyEmailCode(challengeId, wrong)).rejects.toMatchObject({ status: 429 });
        // Even the right code is refused once the challenge is locked.
        await expect(verifyEmailCode(challengeId, devCode!)).rejects.toMatchObject({ status: 429 });
    });

    it('expires after 10 minutes and works only once', async () => {
        const t0 = new Date();
        const a = await startEmailSignIn(fresh(), { now: t0 });
        await expect(verifyEmailCode(a.challengeId, a.devCode!, { now: new Date(t0.getTime() + 10 * 60_000 + 1) })).rejects.toMatchObject({ status: 400, details: { reason: 'expired' } });

        const b = await startEmailSignIn(fresh());
        expect((await verifyEmailCode(b.challengeId, b.devCode!)).email).toMatch(/@example\.com$/);
        await expect(verifyEmailCode(b.challengeId, b.devCode!)).rejects.toMatchObject({ status: 400, details: { reason: 'used' } });
        await expect(verifyEmailCode('ach_unknown', '123456')).rejects.toMatchObject({ status: 400 });
    });

    it('rate limits per email (5 an hour) and per IP', async () => {
        const email = fresh();
        for (let i = 0; i < 5; i++) await startEmailSignIn(email);
        await expect(startEmailSignIn(email)).rejects.toMatchObject({ status: 429 });
        await expect(startEmailSignIn(email.toUpperCase())).rejects.toMatchObject({ status: 429 });

        for (let i = 0; i < EMAIL_CODE_IP_LIMIT.limit; i++) await startEmailSignIn(fresh(), { ip: '203.0.113.9' });
        await expect(startEmailSignIn(fresh(), { ip: '203.0.113.9' })).rejects.toMatchObject({ status: 429 });
        await expect(startEmailSignIn(fresh(), { ip: '203.0.113.10' })).resolves.toBeTruthy();
    });

    it('routes: start -> verify creates the account, sets dm_session, and a second sign-in is not "created"', async () => {
        const email = fresh();
        const device = newDevice();
        const started = await startRoute(req('POST', '/api/auth/email/start', device, { email }), params({}));
        expect(started.status).toBe(201);
        const s = EmailStartResponse.parse(await started.json());

        const bad = await verifyRoute(req('POST', '/api/auth/email/verify', device, { challengeId: s.challengeId, code: '12345' }), params({}));
        expect(bad.status).toBe(400);

        const ok = await verifyRoute(req('POST', '/api/auth/email/verify', device, { challengeId: s.challengeId, code: s.devCode }), params({}));
        expect(ok.status).toBe(200);
        const body = SignInResponse.parse(await ok.json());
        expect(body).toMatchObject({ created: true, claimed: { builds: 0, orders: 0 }, viewer: { email: email.toLowerCase(), emailVerified: true } });
        const cookie = ok.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`))!;
        expect(cookie).toMatch(/HttpOnly/i);
        expect(cookie).toMatch(/SameSite=Lax/i);
        expect(setCookieValue(ok, SESSION_COOKIE)).toMatch(/^dms_/);

        const again = await startEmailSignIn(email);
        const second = await verifyRoute(req('POST', '/api/auth/email/verify', device, { challengeId: again.challengeId, code: again.devCode }), params({}));
        expect(SignInResponse.parse(await second.json()).created).toBe(false);

        const cross = await startRoute(req('POST', '/api/auth/email/start', device, { email }, { origin: 'https://evil.example' }), params({}));
        expect(cross.status).toBe(403);
    });
});
