/**
 * Kids mode route policy: an allowlist. While a `dm_kid` cookie is present (valid or not: fail
 * closed) only these paths work; every other page redirects to /kids and every other API route
 * answers 403. Enforced in src/proxy.ts for pages and API routes, and again in the route
 * handlers of kid-forbidden features through `assertNotKidMode` (src/server/kids/guard.ts).
 *
 * Pure (no server imports): shared by the proxy, the guard and the tests.
 */

/** Pages a kid may open. */
const KID_PAGE_PREFIXES = ['/kids', '/legal'] as const;

/** API routes a kid session may call: [prefix, allowed methods]. */
const KID_API_RULES: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['/api/kids', ['GET', 'POST', 'HEAD']],
    ['/api/health', ['GET', 'HEAD']],
    // Signed, expiring links to the kid's own preview files (the GLB for the 3D view).
    ['/api/storage/local', ['GET', 'HEAD']],
];

function under(pathname: string, prefix: string): boolean {
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isKidAllowedPage(pathname: string): boolean {
    return KID_PAGE_PREFIXES.some((p) => under(pathname, p));
}

export function isKidAllowedApi(pathname: string, method: string): boolean {
    const m = method.toUpperCase();
    return KID_API_RULES.some(([prefix, methods]) => under(pathname, prefix) && methods.includes(m));
}

/** Can a kid session use this request? */
export function kidModeAllows(pathname: string, method = 'GET'): boolean {
    // Normalise: no trailing slash, collapse duplicate slashes, no dot segments.
    const clean = `/${pathname.split('/').filter((s) => s && s !== '.' && s !== '..').join('/')}`;
    if (clean !== pathname.replace(/\/+$/, '') && pathname !== '/') return false;
    return clean.startsWith('/api/') || clean === '/api' ? isKidAllowedApi(clean, method) : isKidAllowedPage(clean);
}

/** Kid-friendly message for a refused API call. */
export const KIDS_MODE_FORBIDDEN_MESSAGE = 'This part is for grown-ups. Ask a grown-up to help.';

/** Where a refused page sends the kid. */
export const KIDS_HOME = '/kids';
