/**
 * Buyer access to an order (ADR-0008): guest checkout with a signed order link.
 *
 * At checkout the server generates a random token (shown once: in the checkout
 * response and the confirmation email) and stores
 * `orders.access_token_hash = HMAC-SHA256(ORDER_LINK_SECRET, "<orderId>.<token>")`.
 * A DB leak alone cannot forge links, and rotating ORDER_LINK_SECRET revokes all links.
 */
import { ORDER_TOKEN_HEADER, ORDER_TOKEN_QUERY } from '../../contracts/orders';
import { env, requireSecret } from '../env';
import { generateToken, hmacHex, safeEqual } from './tokens';

export function createOrderAccessToken(): string {
    return generateToken('dmo', 24);
}

export function hashOrderAccessToken(orderId: string, token: string): string {
    return hmacHex(requireSecret('ORDER_LINK_SECRET'), `${orderId}.${token}`);
}

/** Constant-time check of a presented token against the stored hash. */
export function verifyOrderAccessToken(orderId: string, token: string | null | undefined, storedHash: string): boolean {
    if (!token) return false;
    return safeEqual(hashOrderAccessToken(orderId, token), storedHash);
}

/** Absolute buyer tracker URL: `${APP_URL}/orders/:orderId?t=<token>`. */
export function buildOrderUrl(orderId: string, token: string, appUrl: string = env().APP_URL): string {
    const u = new URL(`/orders/${encodeURIComponent(orderId)}`, appUrl);
    u.searchParams.set(ORDER_TOKEN_QUERY, token);
    return u.toString();
}

/** Read the presented order token from `x-order-token` header or `?t=` query. */
export function readOrderToken(request: Request): string | null {
    const header = request.headers.get(ORDER_TOKEN_HEADER);
    if (header) return header.trim();
    const q = new URL(request.url).searchParams.get(ORDER_TOKEN_QUERY);
    return q ? q.trim() : null;
}
