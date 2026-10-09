/**
 * Mints the guest device cookie (`dm_device`, ADR-0009) on the first page load, before any
 * client code runs. Every API call the page then makes carries the same device, so builds
 * created by a guest stay editable by that browser. Without this, the parallel first-load
 * requests (header, Home, an upload) could each mint a device and the last Set-Cookie would
 * win. Write routes still mint one as a fallback for API-only clients.
 *
 * Same format and attributes as `src/server/auth/device.ts`: 192 random bits, base64url,
 * HttpOnly, SameSite=Lax, Secure on HTTPS, one year.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { DEVICE_COOKIE } from './contracts/account'

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60

function newDeviceSecret(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(24))
    let bin = ''
    for (const b of bytes) bin += String.fromCharCode(b)
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function proxy(request: NextRequest) {
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
    // Pages only: not API routes, Next internals, or static files (anything with an extension).
    matcher: ['/((?!api/|_next/|.*\\.[A-Za-z0-9]+$).*)'],
}
