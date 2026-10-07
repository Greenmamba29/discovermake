/**
 * Route-handler helpers for the Shop Console API.
 *
 *   const shop = await requireShop(request);   // 401 unless a valid dm_shop_session cookie is present
 *
 * The cookie value is a random 256-bit session secret (only its sha256 is stored in
 * shop_sessions), so it is unforgeable without a signature: knowing a hash does not
 * yield the secret. Cookie flags: HttpOnly; SameSite=Lax; Path=/; Secure on https / production.
 */
import { SHOP_SESSION_COOKIE, type ShopPrincipal } from '../../contracts/shop';
import { env, isProduction } from '../env';
import { ApiError } from '../http';
import { resolveShopSession } from './auth';

/** Read a cookie from a raw Request (route handlers receive a plain Request). */
export function readCookie(request: Request, name: string): string | null {
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

export function readShopSessionSecret(request: Request): string | null {
    return readCookie(request, SHOP_SESSION_COOKIE);
}

/** Resolve the calling shop or throw 401. */
export async function requireShop(request: Request): Promise<ShopPrincipal> {
    const session = await resolveShopSession(readShopSessionSecret(request));
    if (!session) throw new ApiError('UNAUTHORIZED', 'Shop Console session required', 401);
    return session.shop;
}

/** Like requireShop but also returns the session expiry (GET /api/shop/session). */
export async function requireShopSession(request: Request): Promise<{ shop: ShopPrincipal; expiresAt: Date }> {
    const session = await resolveShopSession(readShopSessionSecret(request));
    if (!session) throw new ApiError('UNAUTHORIZED', 'Shop Console session required', 401);
    return { shop: session.shop, expiresAt: session.expiresAt };
}

/**
 * CSRF defence in depth for cookie-authenticated mutations (SameSite=Lax is the primary):
 * when the browser sends an Origin header it must be this app (request origin or APP_URL).
 */
export function assertSameOrigin(request: Request): void {
    const origin = request.headers.get('origin');
    if (!origin) return;
    const allowed = new Set<string>([new URL(request.url).origin]);
    try {
        allowed.add(new URL(env().APP_URL).origin);
    } catch {
        // ignore malformed APP_URL; request origin still applies
    }
    if (!allowed.has(origin)) throw new ApiError('FORBIDDEN', 'Cross-origin request rejected', 403);
}

export function sessionCookieOptions(expiresAt: Date) {
    let secure = isProduction();
    try {
        secure = secure || new URL(env().APP_URL).protocol === 'https:';
    } catch {
        // keep production default
    }
    return { httpOnly: true, secure, sameSite: 'lax' as const, path: '/', expires: expiresAt };
}
