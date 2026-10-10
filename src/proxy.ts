/**
 * 1. Mints the guest device cookie (`dm_device`, ADR-0009) on the first page load, before any
 * client code runs. Every API call the page then makes carries the same device, so builds
 * created by a guest stay editable by that browser. Without this, the parallel first-load
 * requests (header, Home, an upload) could each mint a device and the last Set-Cookie would
 * win. Write routes still mint one as a fallback for API-only clients.
 *
 * Same format and attributes as `src/server/auth/device.ts`: 192 random bits, base64url,
 * HttpOnly, SameSite=Lax, Secure on HTTPS, one year.
 *
 * 2. Kids mode (docs/architecture/kids-family.md): while a `dm_kid` cookie is present, pages
 * outside Kids mode redirect to /kids and API routes outside it answer 403 (src/lib/kids/policy.ts).
 * Presence is enough here (fail closed); the route handlers verify the signed cookie and the
 * server-side session lock.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { DEVICE_COOKIE } from './contracts/account'
import { KID_COOKIE } from './contracts/kids'
import { KIDS_HOME, KIDS_MODE_FORBIDDEN_MESSAGE, kidModeAllows } from './lib/kids/policy'

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60

function newDeviceSecret(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(24))
    let bin = ''
    for (const b of bytes) bin += String.fromCharCode(b)
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function kidGate(request: NextRequest): NextResponse | null {
    if (!request.cookies.get(KID_COOKIE)?.value) return null
    const { pathname } = request.nextUrl
    if (kidModeAllows(pathname, request.method)) return null
    if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: { code: 'FORBIDDEN', message: KIDS_MODE_FORBIDDEN_MESSAGE } }, { status: 403, headers: { 'cache-control': 'no-store' } })
    }
    const to = new URL(KIDS_HOME, request.url)
    to.search = ''
    return NextResponse.redirect(to, 307)
}

export function proxy(request: NextRequest) {
    const gated = kidGate(request)
    if (gated) return gated
    // API routes: the Kids mode gate only (they mint their own device cookie when needed).
    if (request.nextUrl.pathname.startsWith('/api/')) return NextResponse.next()
    if (request.cookies.get(DEVICE_COOKIE)?.value) return NextResponse.next()
    const secret = newDeviceSecret()
    // Make the cookie visible to this same request's server rendering too.
    const headers = new Headers(request.headers)
    headers.set('cookie', [request.headers.get('cookie'), `${DEVICE_COOKIE}=${secret}`].filter(Boolean).join('; '))
    const response = NextResponse.next({ request: { headers } })
    response.cookies.set(DEVICE_COOKIE, secret, {
        httpOnly: true,
        sameSite: 'lax',
        secure: request.nextUrl.protocol === 'https:' || process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: ONE_YEAR_SECONDS,
    })
    return response
}

export const config = {
    // Pages: not API routes, Next internals, or static files (anything with an extension).
    // API routes: the Kids mode gate (no device minting there).
    matcher: ['/((?!api/|_next/|.*\\.[A-Za-z0-9]+$).*)', '/api/:path*'],
}
