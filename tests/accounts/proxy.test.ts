import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { config, proxy } from '@/proxy';

const setCookie = (res: Response) => res.headers.get('set-cookie') ?? '';

describe('device proxy', () => {
    it('mints one well-formed dm_device on a page load without one', () => {
        const res = proxy(new NextRequest('http://localhost:3000/builds'));
        const m = /dm_device=([^;]+)/.exec(setCookie(res));
        expect(m?.[1]).toMatch(/^[A-Za-z0-9_-]{32}$/);
        expect(setCookie(res)).toMatch(/HttpOnly/i);
        expect(setCookie(res)).toMatch(/SameSite=lax/i);
    });

    it('leaves an existing device alone', () => {
        const res = proxy(new NextRequest('http://localhost:3000/', { headers: { cookie: 'dm_device=abcdefghijklmnopqrstuvwxyz012345' } }));
        expect(setCookie(res)).not.toMatch(/dm_device=/);
    });

    it('runs on pages only, never on API routes or static files', () => {
        const re = new RegExp(`^${config.matcher[0].replace('/((?!', '/(?!').replace(').*)', ').*')}$`);
        expect(re.test('/builds')).toBe(true);
        expect(re.test('/')).toBe(true);
        expect(re.test('/api/me')).toBe(false);
        expect(re.test('/_next/static/chunk.js')).toBe(false);
        expect(re.test('/favicon.ico')).toBe(false);
    });
});
