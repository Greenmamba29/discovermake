/** Sessions: hashed secrets, 30-day expiry, sliding refresh at most once a day, revoke, signout route, GET /api/me. */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { MeResponse, SESSION_COOKIE } from '@/contracts/account';
import { users, userSessions } from '@/server/db/schema';
import { createSession, resolveSession, revokeSession, SESSION_TTL_MS } from '@/server/auth/sessions';
import { sha256Hex } from '@/server/auth/tokens';
import { getViewer } from '@/server/auth/viewer';
import { GET as getMe } from '@/app/api/me/route';
import { POST as signout } from '@/app/api/auth/signout/route';
import { useTestDb } from '../support/db';
import { req, setCookieValue, signedInUser } from './helpers';

const DAY = 24 * 60 * 60 * 1000;

describe('account sessions', () => {
    const ctx = useTestDb();

    async function user() {
        const [u] = await ctx.db.insert(users).values({ email: `s${Math.random().toString(36).slice(2)}@example.com` }).returning();
        return u;
    }

    it('stores only the sha256 of the secret and resolves the user', async () => {
        const u = await user();
        const s = await createSession(u.id, { deviceHash: 'dev1', userAgent: 'vitest' });
        const [row] = await ctx.db.select().from(userSessions).where(eq(userSessions.id, s.sessionId));
        expect(row.secretHash).toBe(sha256Hex(s.secret));
        expect(row.secretHash).not.toContain(s.secret);
        expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(SESSION_TTL_MS);
        expect((await resolveSession(s.secret))?.user.id).toBe(u.id);
        expect(await resolveSession('dms_not-a-real-session-secret-000000')).toBeNull();
        expect(await resolveSession(null)).toBeNull();
    });

    it('expires after 30 days without use', async () => {
        const u = await user();
        const t0 = new Date('2026-01-01T00:00:00Z');
        const s = await createSession(u.id, { now: t0 });
        expect(await resolveSession(s.secret, { now: new Date(t0.getTime() + 29 * DAY) })).not.toBeNull();
        const u2 = await user();
        const s2 = await createSession(u2.id, { now: t0 });
        expect(await resolveSession(s2.secret, { now: new Date(t0.getTime() + 30 * DAY + 1000) })).toBeNull();
    });

    it('slides the expiry at most once a day', async () => {
        const u = await user();
        const t0 = new Date('2026-02-01T00:00:00Z');
        const s = await createSession(u.id, { now: t0 });
        const sameDay = await resolveSession(s.secret, { now: new Date(t0.getTime() + 3 * 60 * 60 * 1000) });
        expect(sameDay?.refreshed).toBe(false);
        expect(sameDay?.session.expiresAt.getTime()).toBe(t0.getTime() + SESSION_TTL_MS);

        const later = new Date(t0.getTime() + 2 * DAY);
        const slid = await resolveSession(s.secret, { now: later });
        expect(slid?.refreshed).toBe(true);
        expect(slid?.session.expiresAt.getTime()).toBe(later.getTime() + SESSION_TTL_MS);
        const again = await resolveSession(s.secret, { now: new Date(later.getTime() + 60_000) });
        expect(again?.refreshed).toBe(false);
        // Used every few weeks, it never lapses.
        expect(await resolveSession(s.secret, { now: new Date(later.getTime() + 29 * DAY) })).not.toBeNull();
    });

    it('revoked sessions stop working', async () => {
        const u = await user();
        const s = await createSession(u.id);
        await revokeSession(s.secret);
        expect(await resolveSession(s.secret)).toBeNull();
    });

    it('GET /api/me works signed out (never mints dm_device) and signed in; signout revokes and clears the cookie', async () => {
        const anon = await getMe(req('GET', '/api/me', null), { params: Promise.resolve({}) });
        expect(anon.status).toBe(200);
        const anonBody = MeResponse.parse(await anon.json());
        expect(anonBody.viewer).toBeNull();
        expect(anonBody.providers).toEqual(['email', 'passkey']);
        // Read-only: the proxy mints the device on page loads, so parallel API calls never race.
        expect(setCookieValue(anon, 'dm_device')).toBeFalsy();

        const p = await signedInUser();
        const me = MeResponse.parse(await (await getMe(req('GET', '/api/me', p), { params: Promise.resolve({}) })).json());
        expect(me.viewer).toMatchObject({ id: p.userId, email: p.email, emailVerified: true, roles: ['buyer'] });

        const out = await signout(req('POST', '/api/auth/signout', p), { params: Promise.resolve({}) });
        expect(out.status).toBe(200);
        expect(setCookieValue(out, SESSION_COOKIE)).toBe('');
        expect(await getViewer(req('GET', '/api/me', p))).toBeNull();

        const crossSite = await signout(req('POST', '/api/auth/signout', p, undefined, { origin: 'https://evil.example' }), { params: Promise.resolve({}) });
        expect(crossSite.status).toBe(403);
    });
});
