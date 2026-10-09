/**
 * Helpers for the R2 accounts suites: principals (users with sessions, guest devices) and
 * requests that carry their cookies, the way a browser would.
 */
import { randomBytes } from 'node:crypto';
import { DEVICE_COOKIE, SESSION_COOKIE } from '@/contracts/account';
import { hashDeviceSecret } from '@/server/auth/device';
import { completeSignIn } from '@/server/auth/users';

export const BASE = 'http://localhost:3100';

export type Principal = { device: string; deviceHash: string; session?: string; userId?: string; email?: string };

let ip = 0;
export const nextIp = () => `198.51.100.${(++ip % 250) + 1}`;

export function newDevice(): Principal {
    const device = randomBytes(24).toString('base64url');
    return { device, deviceHash: hashDeviceSecret(device) };
}

/** A user signed in (by verified email) on a fresh device. */
export async function signedInUser(email = `u${randomBytes(4).toString('hex')}@example.com`): Promise<Principal> {
    const p = newDevice();
    const r = await completeSignIn({ method: 'email', email, deviceHash: p.deviceHash });
    return { ...p, session: r.session.secret, userId: r.viewer.id, email };
}

export function cookieHeader(p: Principal | null): Record<string, string> {
    if (!p) return {};
    const parts = [`${DEVICE_COOKIE}=${p.device}`];
    if (p.session) parts.push(`${SESSION_COOKIE}=${p.session}`);
    return { cookie: parts.join('; ') };
}

export function req(method: string, path: string, p: Principal | null, body?: unknown, extra: Record<string, string> = {}): Request {
    const headers: Record<string, string> = { 'x-forwarded-for': nextIp(), ...cookieHeader(p), ...extra };
    if (body !== undefined && typeof body !== 'string') headers['content-type'] = 'application/json';
    return new Request(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
}

export const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

/** Value of a Set-Cookie header for `name` from a response ('' when cleared, null when absent). */
export function setCookieValue(res: Response, name: string): string | null {
    const all = res.headers.getSetCookie?.() ?? [];
    for (const c of all) {
        const [pair] = c.split(';');
        const i = pair.indexOf('=');
        if (pair.slice(0, i).trim() === name) return decodeURIComponent(pair.slice(i + 1));
    }
    return null;
}
