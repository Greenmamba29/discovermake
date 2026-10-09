import { Boxes, Compass, Hammer, Radio, Truck, UserRound, type LucideIcon } from 'lucide-react';

/**
 * App navigation (workflow 10 · Information architecture).
 * Mobile bottom nav: Discover · Make · Live · Builds · Me.
 */
export type NavItem = {
    key: string;
    href: string;
    label: string;
    icon: LucideIcon;
    /** Path prefixes that make this item current. '/' matches the home page only. */
    match: readonly string[];
};

export const BOTTOM_NAV: readonly NavItem[] = [
    { key: 'discover', href: '/discover', label: 'Discover', icon: Compass, match: ['/discover', '/b', '/c', '/clips'] },
    // Home is the "What do you want to make?" intake, so Make is current there too.
    { key: 'make', href: '/make', label: 'Make', icon: Hammer, match: ['/', '/make', '/build'] },
    { key: 'live', href: '/live', label: 'Live', icon: Radio, match: ['/live', '/studio'] },
    { key: 'builds', href: '/builds', label: 'Builds', icon: Boxes, match: ['/builds', '/orders'] },
    { key: 'me', href: '/me', label: 'Me', icon: UserRound, match: ['/me', '/signin'] },
];

/** Desktop top nav (workflow 10): Discover · Make · My Builds · Track order (+ Me / Sign in and the CTA). */
export const TOP_NAV: readonly NavItem[] = [
    { key: 'discover', href: '/discover', label: 'Discover', icon: Compass, match: ['/discover', '/b', '/c', '/clips'] },
    { key: 'make', href: '/make', label: 'Make', icon: Hammer, match: ['/make', '/build', '/parts'] },
    { key: 'live', href: '/live', label: 'Live', icon: Radio, match: ['/live', '/studio'] },
    { key: 'builds', href: '/builds', label: 'My Builds', icon: Boxes, match: ['/builds'] },
    { key: 'track', href: '/orders', label: 'Track order', icon: Truck, match: ['/orders'] },
];

/**
 * Focused flows that own the bottom edge of the phone screen (sticky checkout CTAs, the
 * onboarding stepper) and surfaces with their own navigation (ops/admin). No bottom nav there.
 */
export const BOTTOM_NAV_HIDDEN: readonly string[] = ['/admin', '/parts', '/checkout', '/onboarding', '/shop'];

function under(pathname: string, prefix: string): boolean {
    if (prefix === '/') return pathname === '/';
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isActive(item: NavItem, pathname: string): boolean {
    return item.match.some((p) => under(pathname, p));
}

/** The one current item for a path (first match wins), or null. */
export function activeKey(items: readonly NavItem[], pathname: string): string | null {
    return items.find((i) => isActive(i, pathname))?.key ?? null;
}

/** The full-screen live viewer (`/live/<showId>`) owns the bottom edge: chat composer and slot CTA. */
const LIVE_VIEWER = /^\/live\/[^/]+\/?$/;

export function bottomNavVisible(pathname: string): boolean {
    if (LIVE_VIEWER.test(pathname)) return false;
    return !BOTTOM_NAV_HIDDEN.some((p) => under(pathname, p));
}
