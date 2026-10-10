// @vitest-environment jsdom
/**
 * App shell bottom nav (workflow 10 IA): Discover · Make · Builds · Me, one current item with
 * aria-current, hidden on focused flows (checkout, configure, onboarding) and admin.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname, useRouter: () => ({ push: vi.fn() }) }));

import { BottomNav } from './bottom-nav';
import { BOTTOM_NAV, TOP_NAV, activeKey, bottomNavVisible } from './nav-items';

afterEach(cleanup);

function renderAt(pathname: string) {
    nav.pathname = pathname;
    return render(<BottomNav />);
}

describe('BottomNav', () => {
    it('renders the five tabs in order with 44px+ targets', () => {
        renderAt('/discover');
        const bar = screen.getByRole('navigation', { name: 'Primary' });
        const links = within(bar).getAllByRole('link');
        expect(links.map((l) => l.textContent)).toEqual(['Discover', 'Make', 'Live', 'Builds', 'Me']);
        expect(links.map((l) => l.getAttribute('href'))).toEqual(['/discover', '/make', '/live', '/builds', '/me']);
        for (const l of links) expect(l.className).toContain('min-h-[44px]');
        expect(bar.className).toContain('md:hidden');
        expect(bar.className).toContain('safe-area-inset-bottom');
    });

    it.each([
        ['/discover', 'Discover'],
        ['/make', 'Make'],
        ['/make/ai', 'Make'],
        ['/', 'Make'],
        ['/build/bld_1/workspace', 'Make'],
        ['/builds', 'Builds'],
        ['/orders/ord_1', 'Builds'],
        ['/me', 'Me'],
        ['/signin', 'Me'],
    ])('marks exactly one current tab on %s', (path, label) => {
        renderAt(path);
        const current = screen.getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page');
        expect(current.map((l) => l.textContent)).toEqual([label]);
    });

    it('marks nothing current on unrelated pages', () => {
        renderAt('/passport/pps_1');
        expect(screen.getAllByRole('link').filter((l) => l.getAttribute('aria-current'))).toHaveLength(0);
    });

    it.each(['/checkout/qte_1', '/parts/prt_1', '/onboarding', '/admin', '/admin/sourcing', '/shop/jobs'])('is not rendered on %s', (path) => {
        renderAt(path);
        expect(screen.queryByTestId('bottom-nav')).toBeNull();
        expect(screen.queryByTestId('bottom-nav-spacer')).toBeNull();
    });

    it('reserves space so content is never hidden behind the bar', () => {
        renderAt('/discover');
        expect(screen.getByTestId('bottom-nav-spacer').className).toMatch(/h-\[calc\(4rem\+env\(safe-area-inset-bottom\)\)\]/);
    });
});

describe('nav items', () => {
    it('adding Live is one entry: tab count follows the array', () => {
        expect(BOTTOM_NAV).toHaveLength(5);
        expect(new Set(BOTTOM_NAV.map((i) => i.key)).size).toBe(BOTTOM_NAV.length);
    });

    it('desktop nav: Track order owns /orders, My Builds owns /builds', () => {
        expect(activeKey(TOP_NAV, '/orders')).toBe('track');
        expect(activeKey(TOP_NAV, '/builds')).toBe('builds');
        expect(activeKey(TOP_NAV, '/parts/prt_1')).toBe('make');
        expect(activeKey(TOP_NAV, '/')).toBeNull();
    });

    it('prefix matching does not leak across siblings', () => {
        expect(bottomNavVisible('/partsx')).toBe(true);
        expect(activeKey(BOTTOM_NAV, '/makers')).toBeNull();
        expect(activeKey(BOTTOM_NAV, '/live')).toBe('live');
        expect(activeKey(BOTTOM_NAV, '/studio/shows/shw_x')).toBe('live');
        expect(bottomNavVisible('/live')).toBe(true);
        expect(bottomNavVisible('/live/shw_abc')).toBe(false);
    });
});
