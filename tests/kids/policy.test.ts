/** Kids mode route policy (allowlist) and the proxy gate for pages and API routes. */
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { KID_COOKIE } from '@/contracts/kids';
import { kidModeAllows } from '@/lib/kids/policy';
import { config, proxy } from '@/proxy';

/** Every kid-forbidden surface named in the brief, as pages and as API calls. */
export const FORBIDDEN_PAGES = [
    '/',
    '/checkout/qte_x',
    '/checkout/dev-pay',
    '/cart',
    '/cart/done/cco_x',
    '/me',
    '/me/membership',
    '/family',
    '/builds',
    '/studio',
    '/studio/publish',
    '/admin',
    '/admin/sourcing',
    '/shop',
    '/shop/jobs',
    '/make',
    '/make/ai',
    '/parts/prt_x',
    '/build/bld_x/workspace',
    '/reconstruct',
    '/reconstruct/bld_x',
    '/live',
    '/live/shw_x',
    '/discover',
    '/signin',
    '/onboarding',
    '/orders/ord_x',
    '//kids',
    '/kids/../checkout',
];

export const FORBIDDEN_API: [string, string][] = [
    ['POST', '/api/checkout'],
    ['POST', '/api/checkout/preview'],
    ['POST', '/api/checkout/dev-confirm'],
    ['GET', '/api/me/cart'],
    ['POST', '/api/me/cart/items'],
    ['POST', '/api/me/cart/checkout'],
    ['GET', '/api/me'],
    ['PATCH', '/api/me'],
    ['PUT', '/api/me/preferences'],
    ['POST', '/api/me/membership'],
    ['GET', '/api/family'],
    ['PUT', '/api/family/pin'],
    ['POST', '/api/family/kids/kid_x/hand-off'],
    ['POST', '/api/family/requests/kreq_x/approve'],
    ['GET', '/api/media/studio/insights'],
    ['GET', '/api/live/studio'],
    ['POST', '/api/builds/bld_x/sourcing'],
    ['GET', '/api/admin/orders'],
    ['GET', '/api/shop/jobs'],
    ['POST', '/api/shop/session'],
    ['POST', '/api/parts'],
    ['PUT', '/api/parts/prt_x/upload'],
    ['POST', '/api/builds/bld_x/attachments'],
    ['POST', '/api/make-ai/intake'],
    ['POST', '/api/make-ai/builds'],
    ['POST', '/api/builds/bld_x/assistant'],
    ['POST', '/api/live/shows/shw_x/chat'],
    ['POST', '/api/live/shows/shw_x/questions'],
    ['POST', '/api/live/shows/shw_x/like'],
    ['POST', '/api/reconstruct'],
    ['POST', '/api/reconstruct/bld_x/segment'],
    ['POST', '/api/media/builds/bld_x/publish'],
    ['POST', '/api/auth/signout'],
    ['POST', '/api/auth/email/start'],
    ['DELETE', '/api/kids/anything'],
];

describe('kids mode policy', () => {
    it('allows only Kids mode pages and legal pages', () => {
        for (const p of ['/kids', '/kids/', '/kids/make/name_keychain', '/kids/things', '/kids/exit', '/kids/discover', '/kids/live/shw_x', '/legal/privacy']) expect(kidModeAllows(p), p).toBe(true);
        for (const p of FORBIDDEN_PAGES) expect(kidModeAllows(p), p).toBe(false);
    });

    it('allows only the kid API routes, health and signed storage reads', () => {
        for (const [m, p] of [
            ['GET', '/api/kids/me'],
            ['POST', '/api/kids/designs'],
            ['POST', '/api/kids/requests'],
            ['POST', '/api/kids/exit'],
            ['GET', '/api/health'],
            ['GET', '/api/storage/local/kids/designs/kdz_x/a.glb'],
        ] as const)
            expect(kidModeAllows(p, m), `${m} ${p}`).toBe(true);
        for (const [m, p] of FORBIDDEN_API) expect(kidModeAllows(p, m), `${m} ${p}`).toBe(false);
        expect(kidModeAllows('/api/storage/local/x', 'PUT')).toBe(false);
    });
});

describe('proxy gate', () => {
    const kid = { cookie: 'dm_device=abcdefghijklmnopqrstuvwxyz012345; dm_kid=v1.x.y' };

    it('redirects every forbidden page to /kids while a dm_kid cookie is present (signed or not: fail closed)', () => {
        for (const p of FORBIDDEN_PAGES.filter((x) => !x.includes('..') && !x.startsWith('//'))) {
            const res = proxy(new NextRequest(`http://localhost:3000${p}`, { headers: kid }));
            expect(res.status, p).toBe(307);
            expect(new URL(res.headers.get('location')!).pathname, p).toBe('/kids');
        }
    });

    it('answers 403 for every forbidden API route', async () => {
        for (const [method, p] of FORBIDDEN_API) {
            const res = proxy(new NextRequest(`http://localhost:3000${p}`, { method, headers: kid }));
            expect(res.status, `${method} ${p}`).toBe(403);
            expect((await res.json()).error.code).toBe('FORBIDDEN');
        }
    });

    it('lets Kids mode routes through, and changes nothing without the cookie', () => {
        expect(proxy(new NextRequest('http://localhost:3000/kids/things', { headers: kid })).status).toBe(200);
        expect(proxy(new NextRequest('http://localhost:3000/api/kids/me', { headers: kid })).status).toBe(200);
        const adult = { cookie: 'dm_device=abcdefghijklmnopqrstuvwxyz012345' };
        expect(proxy(new NextRequest('http://localhost:3000/checkout/qte_x', { headers: adult })).status).toBe(200);
        expect(proxy(new NextRequest('http://localhost:3000/api/checkout', { method: 'POST', headers: adult })).status).toBe(200);
        // API routes never mint a device cookie.
        expect(proxy(new NextRequest('http://localhost:3000/api/me')).headers.get('set-cookie') ?? '').not.toMatch(/dm_device=/);
    });

    it('runs on API routes only while a Kids mode cookie is present', () => {
        expect(config.matcher[1]).toEqual({ source: '/api/:path*', has: [{ type: 'cookie', key: KID_COOKIE }] });
    });
});
