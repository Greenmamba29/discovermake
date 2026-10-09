/**
 * Cookie primitives for R2 accounts (ADR-0009). Route handlers receive a plain `Request`,
 * so cookies are read from the `cookie` header and written on the returned NextResponse.
 */
import type { NextResponse } from 'next/server';
import { env, isProduction } from '../env';
import { ApiError } from '../http';

/** Read one cookie from a raw Request (null when absent). */
export function readRequestCookie(request: Request, name: string): string | null {
    const header = request.headers.get('cookie');
    if (!header) return null;
    for (const part of header.split(';')) {
        const i = part.indexOf('=');
        if (i < 0) continue;
        if (part.slice(0, i).trim() === name) {
            const raw = part.slice(i + 1).trim();
            try {
                return decodeURIComponent(raw);
            } catch {
                return raw;
            }
        }
    }
    return null;
}

/** Secure on production or whenever APP_URL is https. */
export function secureCookies(): boolean {
    if (isProduction()) return true;
    try {
        return new URL(env().APP_URL).protocol === 'https:';
    } catch {
        return false;
    }
}

export type CookieOptions = {
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'lax' | 'strict' | 'none';
    path: string;
    expires?: Date;
    maxAge?: number;
};

export function baseCookieOptions(overrides: Partial<CookieOptions> = {}): CookieOptions {
    return { httpOnly: true, secure: secureCookies(), sameSite: 'lax', path: '/', ...overrides };
}

export function setCookie(response: NextResponse, name: string, value: string, options: CookieOptions): void {
    response.cookies.set(name, value, options);
}

export function clearCookie(response: NextResponse, name: string, overrides: Partial<CookieOptions> = {}): void {
    response.cookies.set(name, '', { ...baseCookieOptions(overrides), expires: new Date(0), maxAge: 0 });
}

/**
 * CSRF defence in depth for cookie-authenticated mutations (SameSite=Lax is the primary):
 * when the browser sends an Origin header it must be this app (request origin or APP_URL).
 * Same rule as the Shop Console (src/server/shops/request.ts).
 */
export function assertSameOrigin(request: Request): void {
    const origin = request.headers.get('origin');
    if (!origin) return;
    const allowed = new Set<string>([new URL(request.url).origin]);
    try {
        allowed.add(new URL(env().APP_URL).origin);
    } catch {
        // malformed APP_URL: the request origin still applies
    }
    if (!allowed.has(origin)) throw new ApiError('FORBIDDEN', 'Cross-origin request rejected', 403);
}

/**
 * `?next=` handling: only same-site relative paths ("/builds?tab=ordered"). Anything else
 * (absolute URLs, protocol-relative "//evil", backslash tricks, control chars) falls back.
 */
export function safeNextPath(next: string | null | undefined, fallback = '/builds'): string {
    if (!next || typeof next !== 'string' || next.length > 512) return fallback;
    if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\\]/.test(next)) return fallback;
    try {
        const base = 'http://dm.invalid';
        const u = new URL(next, base);
        if (u.origin !== base) return fallback;
        return `${u.pathname}${u.search}${u.hash}`;
    } catch {
        return fallback;
    }
}
