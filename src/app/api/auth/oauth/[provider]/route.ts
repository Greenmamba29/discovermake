/**
 * GET /api/auth/oauth/:provider?next=/path -> 302 to Google / Apple (404 when the provider
 * is not configured). Sets short-lived state / PKCE / nonce cookies for the callback.
 */
import { NextResponse } from 'next/server';
import { isOidcProvider, isProviderEnabled, startOidc } from '@/server/auth/oidc';
import { ApiError, route } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route<{ provider: string }>(async (request, { params }) => {
    const { provider } = await params;
    if (!isOidcProvider(provider) || !isProviderEnabled(provider)) throw new ApiError('NOT_FOUND', 'Sign-in provider not available', 404);
    const { url, apply } = startOidc(provider, new URL(request.url).searchParams.get('next'));
    const res = NextResponse.redirect(url, 302);
    res.headers.set('cache-control', 'no-store');
    apply(res);
    return res;
});
