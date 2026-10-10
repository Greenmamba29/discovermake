/**
 * The Kids mode cookie (`dm_kid`): `v1.<payload base64url>.<HMAC-SHA256 base64url>`, signed with a
 * key derived from AUTH_SECRET. HttpOnly, SameSite=Lax, Secure on HTTPS, one year (it must never
 * expire before the grown-up's session: the server-side lock is the real boundary anyway).
 *
 * Payload: { k: kid profile id, o: grown-up user id, s: the grown-up's session id, iat }.
 * A cookie is only a kid session when its signature checks AND the session lock row matches it.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextResponse } from 'next/server';
import { z } from 'zod';
import { KID_COOKIE } from '@/contracts/kids';
import { baseCookieOptions, clearCookie, readRequestCookie, setCookie } from '../auth/cookies';
import { requireSecret } from '../env';

export const KID_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
const VERSION = 'v1';

const Claims = z.object({ k: z.string().min(1).max(64), o: z.string().min(1).max(64), s: z.string().min(1).max(64), iat: z.number().int().positive() });
export type KidCookieClaims = z.infer<typeof Claims>;

function key(): Buffer {
    return createHmac('sha256', requireSecret('AUTH_SECRET')).update('dm_kid.cookie.v1').digest();
}

function mac(body: string): string {
    return createHmac('sha256', key()).update(body).digest('base64url');
}

export function signKidCookie(claims: Omit<KidCookieClaims, 'iat'> & { iat?: number }): string {
    const payload = Buffer.from(JSON.stringify({ ...claims, iat: claims.iat ?? Math.floor(Date.now() / 1000) })).toString('base64url');
    const body = `${VERSION}.${payload}`;
    return `${body}.${mac(body)}`;
}

/** The claims of a well-formed, correctly signed cookie value; null for anything else. */
export function verifyKidCookie(value: string | null | undefined): KidCookieClaims | null {
    if (!value || value.length > 1024) return null;
    const parts = value.split('.');
    if (parts.length !== 3 || parts[0] !== VERSION) return null;
    const body = `${parts[0]}.${parts[1]}`;
    const expected = Buffer.from(mac(body));
    const actual = Buffer.from(parts[2]!);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    try {
        const parsed = Claims.safeParse(JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')));
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}

export function readKidCookie(request: Request): string | null {
    return readRequestCookie(request, KID_COOKIE);
}

export function setKidCookie(response: NextResponse, value: string): void {
    setCookie(response, KID_COOKIE, value, baseCookieOptions({ maxAge: KID_COOKIE_MAX_AGE_SECONDS }));
}

export function clearKidCookie(response: NextResponse): void {
    clearCookie(response, KID_COOKIE);
}
