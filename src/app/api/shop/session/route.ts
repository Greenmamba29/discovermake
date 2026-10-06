/**
 * Shop Console session (ADR-0008).
 *   POST   /api/shop/session  ShopLoginRequest -> ShopSessionResponse + Set-Cookie dm_shop_session (HttpOnly, SameSite=Lax)
 *   GET    /api/shop/session                   -> ShopSessionResponse (401 without a valid session)
 *   DELETE /api/shop/session                   -> OkResponse (revokes the session, clears the cookie)
 */
import { SHOP_SESSION_COOKIE, ShopLoginRequest, type ShopSessionResponse } from '@/contracts/shop';
import type { OkResponse } from '@/contracts/common';
import { ApiError, json, parseJson, route } from '@/server/http';
import { assertSameOrigin, createShopSession, readShopSessionSecret, requireShopSession, revokeShopSession, sessionCookieOptions } from '@/server/shops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request) => {
    assertSameOrigin(request);
    const { token } = await parseJson(request, ShopLoginRequest);
    const session = await createShopSession(token);
    if (!session) throw new ApiError('UNAUTHORIZED', 'Invalid or revoked Shop Console token', 401);
    const body: ShopSessionResponse = { shop: session.shop, expiresAt: session.expiresAt.toISOString() };
    const res = json(body);
    res.cookies.set(SHOP_SESSION_COOKIE, session.sessionSecret, sessionCookieOptions(session.expiresAt));
    return res;
});

export const GET = route(async (request) => {
    const { shop, expiresAt } = await requireShopSession(request);
    const body: ShopSessionResponse = { shop, expiresAt: expiresAt.toISOString() };
    return json(body);
});

export const DELETE = route(async (request) => {
    assertSameOrigin(request);
    const secret = readShopSessionSecret(request);
    if (secret) await revokeShopSession(secret);
    const res = json<OkResponse>({ ok: true });
    res.cookies.set(SHOP_SESSION_COOKIE, '', { ...sessionCookieOptions(new Date(0)), maxAge: 0 });
    return res;
});
