/**
 * Google and Apple sign-in (OIDC via arctic v3), ADR-0009. Each provider is enabled only
 * when its env is complete.
 *
 * Flow: GET /api/auth/oauth/:provider?next= sets short-lived HttpOnly cookies (state,
 * PKCE verifier for Google, nonce for Apple, next) and redirects; the callback checks
 * the state in constant time, exchanges the code over TLS, validates the ID token claims
 * (iss, aud, exp, nonce) and accepts only a verified email. The ID token comes straight
 * from the token endpoint over TLS with client authentication, so its signature check
 * is optional (OIDC Core 3.1.3.7); the claims are still validated.
 *
 * Apple posts the callback (response_mode=form_post) cross-site, so its cookies are
 * SameSite=None; Secure (browsers accept Secure cookies on http://localhost too).
 */
import { Apple, decodeIdToken, generateCodeVerifier, generateState, Google } from 'arctic';
import type { NextResponse } from 'next/server';
import type { AuthProvider } from '../../contracts/account';
import { env } from '../env';
import { baseCookieOptions, clearCookie, readRequestCookie, safeNextPath, setCookie } from './cookies';
import { safeEqual } from './tokens';

export const OIDC_PROVIDERS = ['google', 'apple'] as const;
export type OidcProvider = (typeof OIDC_PROVIDERS)[number];

export const OAUTH_COOKIE = { state: 'dm_oauth_state', verifier: 'dm_oauth_verifier', nonce: 'dm_oauth_nonce', next: 'dm_oauth_next' } as const;
const OAUTH_COOKIE_MAX_AGE = 10 * 60;
const OAUTH_COOKIE_PATH = '/api/auth/oauth';

export function isOidcProvider(value: string): value is OidcProvider {
    return (OIDC_PROVIDERS as readonly string[]).includes(value);
}

export function isProviderEnabled(provider: OidcProvider): boolean {
    const e = env();
    if (provider === 'google') return !!(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET);
    return !!(e.APPLE_CLIENT_ID && e.APPLE_TEAM_ID && e.APPLE_KEY_ID && e.APPLE_PRIVATE_KEY);
}

/** Providers this deployment offers (email + passkey always; google/apple when configured). */
export function enabledProviders(): AuthProvider[] {
    return ['email', 'passkey', ...OIDC_PROVIDERS.filter(isProviderEnabled)];
}

export function callbackUrl(provider: OidcProvider): string {
    return new URL(`/api/auth/oauth/${provider}/callback`, env().APP_URL).toString();
}

function applePrivateKey(pem: string): Uint8Array {
    const body = pem
        .replace(/\\n/g, '\n')
        .replace(/-----BEGIN [A-Z ]+-----|-----END [A-Z ]+-----/g, '')
        .replace(/\s+/g, '');
    return new Uint8Array(Buffer.from(body, 'base64'));
}

export type OidcClients = {
    google: () => Pick<Google, 'createAuthorizationURL' | 'validateAuthorizationCode'>;
    apple: () => Pick<Apple, 'createAuthorizationURL' | 'validateAuthorizationCode'>;
};

const defaultClients: OidcClients = {
    google: () => new Google(env().GOOGLE_CLIENT_ID!, env().GOOGLE_CLIENT_SECRET!, callbackUrl('google')),
    apple: () => new Apple(env().APPLE_CLIENT_ID!, env().APPLE_TEAM_ID!, env().APPLE_KEY_ID!, applePrivateKey(env().APPLE_PRIVATE_KEY!), callbackUrl('apple')),
};
let clients: OidcClients = defaultClients;

/** Test hook: swap the arctic clients (pass null to restore). */
export function setOidcClients(next: Partial<OidcClients> | null): void {
    clients = next ? { ...defaultClients, ...next } : defaultClients;
}

function cookieOpts(provider: OidcProvider) {
    return provider === 'apple'
        ? baseCookieOptions({ sameSite: 'none', secure: true, path: OAUTH_COOKIE_PATH, maxAge: OAUTH_COOKIE_MAX_AGE })
        : baseCookieOptions({ path: OAUTH_COOKIE_PATH, maxAge: OAUTH_COOKIE_MAX_AGE });
}

/** Build the provider redirect and set the flow cookies on `response`. */
export function startOidc(provider: OidcProvider, next: string | null): { url: URL; apply: (response: NextResponse) => void } {
    const state = generateState();
    const nextPath = safeNextPath(next);
    let url: URL;
    let verifier: string | null = null;
    let nonce: string | null = null;
    if (provider === 'google') {
        verifier = generateCodeVerifier();
        url = clients.google().createAuthorizationURL(state, verifier, ['openid', 'email', 'profile']);
        url.searchParams.set('prompt', 'select_account');
    } else {
        nonce = generateState();
        url = clients.apple().createAuthorizationURL(state, ['name', 'email']);
        url.searchParams.set('response_mode', 'form_post');
        url.searchParams.set('nonce', nonce);
    }
    return {
        url,
        apply: (response) => {
            const o = cookieOpts(provider);
            setCookie(response, OAUTH_COOKIE.state, state, o);
            setCookie(response, OAUTH_COOKIE.next, nextPath, o);
            if (verifier) setCookie(response, OAUTH_COOKIE.verifier, verifier, o);
            if (nonce) setCookie(response, OAUTH_COOKIE.nonce, nonce, o);
        },
    };
}

export function clearOidcCookies(response: NextResponse, provider: OidcProvider): void {
    const o = cookieOpts(provider);
    for (const name of Object.values(OAUTH_COOKIE)) clearCookie(response, name, { path: o.path, sameSite: o.sameSite, secure: o.secure });
}

export class OidcError extends Error {
    constructor(public readonly reason: 'state' | 'exchange' | 'claims' | 'unverified_email' | 'denied') {
        super(`OIDC sign-in failed: ${reason}`);
        this.name = 'OidcError';
    }
}

export type OidcIdentity = { provider: OidcProvider; subject: string; email: string; name: string | null; next: string };

type IdClaims = { iss?: unknown; aud?: unknown; exp?: unknown; sub?: unknown; email?: unknown; email_verified?: unknown; nonce?: unknown; name?: unknown };

/** Validate the ID token claims for `provider` (throws OidcError). */
export function validateIdClaims(provider: OidcProvider, claims: IdClaims, expectedNonce: string | null, now = Date.now()): { subject: string; email: string; name: string | null } {
    const e = env();
    const issuers = provider === 'google' ? ['https://accounts.google.com', 'accounts.google.com'] : ['https://appleid.apple.com'];
    const audience = provider === 'google' ? e.GOOGLE_CLIENT_ID : e.APPLE_CLIENT_ID;
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (typeof claims.iss !== 'string' || !issuers.includes(claims.iss)) throw new OidcError('claims');
    if (!audience || !aud.includes(audience)) throw new OidcError('claims');
    if (typeof claims.exp !== 'number' || claims.exp * 1000 < now - 60_000) throw new OidcError('claims');
    if (typeof claims.sub !== 'string' || !claims.sub) throw new OidcError('claims');
    if (provider === 'apple' && (!expectedNonce || typeof claims.nonce !== 'string' || !safeEqual(claims.nonce, expectedNonce))) throw new OidcError('claims');
    const verified = claims.email_verified === true || claims.email_verified === 'true';
    if (typeof claims.email !== 'string' || !claims.email.includes('@') || !verified) throw new OidcError('unverified_email');
    return { subject: claims.sub, email: claims.email.toLowerCase(), name: typeof claims.name === 'string' ? claims.name.slice(0, 80) : null };
}

/** Handle the provider callback parameters (query for Google, form body for Apple). */
export async function finishOidc(provider: OidcProvider, request: Request, params: { code: string | null; state: string | null; error: string | null }): Promise<OidcIdentity> {
    const storedState = readRequestCookie(request, OAUTH_COOKIE.state);
    if (!params.state || !storedState || !safeEqual(params.state, storedState)) throw new OidcError('state');
    if (params.error || !params.code) throw new OidcError('denied');
    const next = safeNextPath(readRequestCookie(request, OAUTH_COOKIE.next));

    let idToken: string;
    try {
        if (provider === 'google') {
            const verifier = readRequestCookie(request, OAUTH_COOKIE.verifier);
            if (!verifier) throw new OidcError('state');
            idToken = (await clients.google().validateAuthorizationCode(params.code, verifier)).idToken();
        } else {
            idToken = (await clients.apple().validateAuthorizationCode(params.code)).idToken();
        }
    } catch (err) {
        if (err instanceof OidcError) throw err;
        console.error(`[oidc] ${provider} code exchange failed`, err);
        throw new OidcError('exchange');
    }
    let claims: IdClaims;
    try {
        claims = decodeIdToken(idToken) as IdClaims;
    } catch {
        throw new OidcError('claims');
    }
    const id = validateIdClaims(provider, claims, readRequestCookie(request, OAUTH_COOKIE.nonce));
    return { provider, ...id, next };
}
