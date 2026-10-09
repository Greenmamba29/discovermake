'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Menu, UserRound, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Logo } from './logo';
import { TOP_NAV, activeKey } from './nav-items';
import { useMe } from './use-account';

/** Secondary links: in the desktop overflow they sit in the footer; on phones in the menu. */
const MORE = [
    { href: '/orders', label: 'Track an order' },
    { href: '/#how-it-works', label: 'How it works' },
    { href: '/shop', label: 'Partner shop login' },
] as const;

/** "Me" when GET /api/me returns a viewer, else "Sign in". */
function useAccountEntry() {
    const { data } = useMe();
    return data?.viewer ? { href: '/me', label: 'Me', signedIn: true } : { href: '/signin', label: 'Sign in', signedIn: false };
}

/**
 * Site header. Desktop (md+): Discover · Make · My Builds · Track order, then Me / Sign in and the
 * primary "Upload a part" CTA (workflow 10). Phones get the bottom nav for the primary items and a
 * small menu here for the secondary ones.
 */
export function SiteHeader({ surface = 'graphite' }: { surface?: 'graphite' | 'paper' }) {
    const pathname = usePathname() ?? '/';
    const [open, setOpen] = useState(false);
    useEffect(() => setOpen(false), [pathname]);
    const paper = surface === 'paper';
    const current = activeKey(TOP_NAV, pathname);
    const account = useAccountEntry();

    const linkClass = (active: boolean) =>
        cn(
            'inline-flex min-h-[40px] items-center rounded-lg px-2.5 text-sm font-medium transition-colors lg:px-3',
            paper ? 'text-ink-muted hover:bg-black/5 hover:text-ink' : 'text-fg-muted hover:bg-graphite-800 hover:text-fg',
            active && (paper ? 'bg-black/5 text-ink' : 'bg-graphite-800 text-fg'),
        );

    return (
        <header className={cn('sticky top-0 z-40 border-b backdrop-blur', paper ? 'border-paper-line bg-paper/90' : 'border-graphite-700 bg-graphite-950/90')}>
            <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-signal focus:px-3 focus:py-2 focus:text-signal-ink">
                Skip to content
            </a>
            <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
                <Logo surface={surface} />
                <nav aria-label="Primary" className="hidden items-center gap-0.5 md:flex" data-testid="top-nav">
                    {TOP_NAV.map((n) => (
                        <Link key={n.key} href={n.href} className={linkClass(n.key === current)} aria-current={n.key === current ? 'page' : undefined} data-testid={`top-nav-${n.key}`}>
                            {n.label}
                        </Link>
                    ))}
                    <Link
                        href={account.href}
                        className={cn(linkClass(pathname === account.href), 'ml-1 gap-1.5')}
                        aria-current={pathname === account.href ? 'page' : undefined}
                        data-testid="top-nav-account"
                    >
                        <UserRound className="h-4 w-4" aria-hidden />
                        {account.label}
                    </Link>
                    <Link
                        href="/make"
                        className={cn(
                            'ml-2 inline-flex h-10 items-center whitespace-nowrap rounded-xl px-4 text-sm font-semibold transition-colors',
                            paper ? 'bg-ink text-paper hover:bg-black' : 'bg-signal text-signal-ink hover:bg-signal-strong',
                        )}
                        data-testid="top-nav-cta"
                    >
                        Upload a part
                    </Link>
                </nav>
                <div className="flex items-center gap-1 md:hidden">
                    {!account.signedIn && (
                        <Link href={account.href} className={cn(linkClass(pathname === account.href), 'min-h-[44px]')} data-testid="header-signin">
                            {account.label}
                        </Link>
                    )}
                    <button
                        type="button"
                        className={cn('inline-flex h-11 w-11 items-center justify-center rounded-lg', paper ? 'text-ink hover:bg-black/5' : 'text-fg hover:bg-graphite-800')}
                        aria-expanded={open}
                        aria-controls="mobile-more"
                        aria-label={open ? 'Close menu' : 'Open menu'}
                        onClick={() => setOpen((v) => !v)}
                    >
                        {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
                    </button>
                </div>
            </div>
            {open && (
                <nav id="mobile-more" aria-label="More" className={cn('border-t px-4 pb-4 pt-2 md:hidden', paper ? 'border-paper-line' : 'border-graphite-700')}>
                    <ul className="flex flex-col">
                        {MORE.map((n) => (
                            <li key={n.href}>
                                <Link href={n.href} className={cn(linkClass(false), 'flex min-h-[44px] text-base')}>
                                    {n.label}
                                </Link>
                            </li>
                        ))}
                    </ul>
                </nav>
            )}
        </header>
    );
}
