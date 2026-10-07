/**
 * Shop Console auth (ADR-0008): hashed console tokens -> server-side sessions.
 * Only sha256 of the console token and of the session secret are stored.
 */
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import type { ShopPrincipal } from '../../contracts/shop';
import { generateToken, sha256Hex } from '../auth/tokens';
import { getDb } from '../db';
import { shopAccessTokens, shopSessions, shops } from '../db/schema';

/** Session lifetime for the Shop Console cookie. */
export const SHOP_SESSION_TTL_SECONDS = 12 * 60 * 60;
export const SHOP_SESSION_SECRET_PREFIX = 'dmss';

type ShopRow = typeof shops.$inferSelect;

export function toPrincipal(shop: Pick<ShopRow, 'id' | 'name' | 'city' | 'region'>): ShopPrincipal {
    return { shopId: shop.id, name: shop.name, city: shop.city, region: shop.region };
}

/**
 * Validate a Shop Console token (sha256 lookup in shop_access_tokens, not revoked/expired,
 * shop ACTIVE). Updates last_used_at. Returns null when invalid.
 */
export async function authenticateShop(token: string): Promise<(ShopPrincipal & { tokenId: string }) | null> {
    if (!token || token.length < 20 || token.length > 200) return null;
    const db = getDb();
    const now = new Date();
    const [row] = await db
        .select({ token: shopAccessTokens, shop: shops })
        .from(shopAccessTokens)
        .innerJoin(shops, eq(shops.id, shopAccessTokens.shopId))
        .where(
            and(
                eq(shopAccessTokens.tokenHash, sha256Hex(token.trim())),
                isNull(shopAccessTokens.revokedAt),
                or(isNull(shopAccessTokens.expiresAt), gt(shopAccessTokens.expiresAt, now)),
                eq(shops.status, 'ACTIVE'),
            ),
        )
        .limit(1);
    if (!row) return null;
    await db.update(shopAccessTokens).set({ lastUsedAt: now }).where(eq(shopAccessTokens.id, row.token.id));
    return { ...toPrincipal(row.shop), tokenId: row.token.id };
}

/**
 * Exchange a valid console token for a session. Returns the random session secret
 * for the httpOnly `dm_shop_session` cookie (only its sha256 is stored).
 */
export async function createShopSession(token: string): Promise<{ sessionSecret: string; shop: ShopPrincipal; expiresAt: Date } | null> {
    const auth = await authenticateShop(token);
    if (!auth) return null;
    const sessionSecret = generateToken(SHOP_SESSION_SECRET_PREFIX);
    const expiresAt = new Date(Date.now() + SHOP_SESSION_TTL_SECONDS * 1000);
    await getDb().insert(shopSessions).values({ shopId: auth.shopId, tokenId: auth.tokenId, sessionHash: sha256Hex(sessionSecret), expiresAt });
    const { tokenId: _t, ...shop } = auth;
    void _t;
    return { sessionSecret, shop, expiresAt };
}

/** Resolve a session secret to its shop + expiry, or null (expired / revoked / unknown / token revoked / shop inactive). */
export async function resolveShopSession(sessionSecret: string | null | undefined): Promise<{ shop: ShopPrincipal; expiresAt: Date; sessionId: string } | null> {
    if (!sessionSecret || sessionSecret.length > 200) return null;
    const db = getDb();
    const now = new Date();
    const [row] = await db
        .select({ session: shopSessions, shop: shops })
        .from(shopSessions)
        .innerJoin(shops, eq(shops.id, shopSessions.shopId))
        .innerJoin(shopAccessTokens, eq(shopAccessTokens.id, shopSessions.tokenId))
        .where(
            and(
                eq(shopSessions.sessionHash, sha256Hex(sessionSecret)),
                isNull(shopSessions.revokedAt),
                gt(shopSessions.expiresAt, now),
                isNull(shopAccessTokens.revokedAt),
                or(isNull(shopAccessTokens.expiresAt), gt(shopAccessTokens.expiresAt, now)),
                eq(shops.status, 'ACTIVE'),
            ),
        )
        .limit(1);
    if (!row) return null;
    // Touch at most once a minute to avoid a write per request.
    if (!row.session.lastSeenAt || now.getTime() - row.session.lastSeenAt.getTime() > 60_000) {
        await db.update(shopSessions).set({ lastSeenAt: now }).where(eq(shopSessions.id, row.session.id));
    }
    return { shop: toPrincipal(row.shop), expiresAt: row.session.expiresAt, sessionId: row.session.id };
}

/** Resolve the cookie's session secret to a shop, or null (expired / revoked / unknown). */
export async function getShopSession(sessionSecret: string | null | undefined): Promise<ShopPrincipal | null> {
    return (await resolveShopSession(sessionSecret))?.shop ?? null;
}

export async function revokeShopSession(sessionSecret: string): Promise<void> {
    if (!sessionSecret) return;
    await getDb()
        .update(shopSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(shopSessions.sessionHash, sha256Hex(sessionSecret)), isNull(shopSessions.revokedAt)));
}
