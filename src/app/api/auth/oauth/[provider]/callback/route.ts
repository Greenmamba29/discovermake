/**
 * GET|POST /api/auth/oauth/:provider/callback -> 302 to `next` with dm_session set.
 * Google returns to GET (query); Apple posts a form (response_mode=form_post).
 * Failures (state mismatch, denied consent, unverified email) redirect to
 * /signin?error=<reason> without a session.
 */
import { NextResponse } from 'next/server';
import { env } from '@/server/env';
import { clearOidcCookies, finishOidc, isOidcProvider, isProviderEnabled, OidcError, type OidcProvider } from '@/server/auth/oidc';
import { signInDevice, signInWithOidc } from '@/server/auth/sign-in';
import { setSessionCookie } from '@/server/auth/sessions';
import { ApiError, readBodyText, route } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function redirectTo(path: string): NextResponse {
    const res = NextResponse.redirect(new URL(path, env().APP_URL), 303);
    res.headers.set('cache-control', 'no-store');
    return res;
}

async function handle(request: Request, provider: string, params: URLSearchParams): Promise<Response> {
    if (!isOidcProvider(provider) || !isProviderEnabled(provider)) throw new ApiError('NOT_FOUND', 'Sign-in provider not available', 404);
    const p: OidcProvider = provider;
    try {
        const identity = await finishOidc(p, request, { code: params.get('code'), state: params.get('state'), error: params.get('error') });
        const device = signInDevice(request);
        const result = await signInWithOidc(identity, { deviceHash: device.hash, userAgent: request.headers.get('user-agent') });
        const res = redirectTo(identity.next);
        setSessionCookie(res, result.session.secret, result.session.expiresAt);
        device.apply(res);
        clearOidcCookies(res, p);
        return res;
    } catch (err) {
        if (!(err instanceof OidcError)) throw err;
        const res = redirectTo(`/signin?error=${err.reason}`);
        clearOidcCookies(res, p);
        return res;
    }
}

export const GET = route<{ provider: string }>(async (request, { params }) => handle(request, (await params).provider, new URL(request.url).searchParams));

export const POST = route<{ provider: string }>(async (request, { params }) => {
    const form = new URLSearchParams(await readBodyText(request, 64 * 1024));
    return handle(request, (await params).provider, form);
});
