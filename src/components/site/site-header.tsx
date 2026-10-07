'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Logo } from './logo';

const NAV = [
    { href: '/make', label: 'Make' },
    { href: '/#how-it-works', label: 'How it works' },
    { href: '/orders', label: 'Track order' },
    { href: '/shop', label: 'Shop login' },
] as const;

export function SiteHeader({ surface = 'graphite' }: { surface?: 'graphite' | 'paper' }) {
    const pathname = usePathname();
    const [open, setOpen] = useState(false);
    useEffect(() => setOpen(false), [pathname]);
    const paper = surface === 'paper';

    const linkClass = (href: string) => {
        const active = href !== '/#how-it-works' && (pathname === href || pathname.startsWith(`${href}/`));
        return cn(
            'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            paper ? 'text-ink-muted hover:bg-black/5 hover:text-ink' : 'text-fg-muted hover:bg-graphite-800 hover:text-fg',
            active && (paper ? 'text-ink' : 'text-fg'),
        );
    };

    return (
        <header className={cn('sticky top-0 z-40 border-b backdrop-blur', paper ? 'border-paper-line bg-paper/90' : 'border-graphite-700 bg-graphite-950/90')}>
            <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-signal focus:px-3 focus:py-2 focus:text-signal-ink">
                Skip to content
            </a>
            <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
                <Logo surface={surface} />
                <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
                    {NAV.map((n) => (
                        <Link key={n.href} href={n.href} className={linkClass(n.href)} aria-current={pathname === n.href ? 'page' : undefined}>
                            {n.label}
                        </Link>
                    ))}
                    <Link
                        href="/make"
                        className={cn(
                            'ml-2 inline-flex h-10 items-center rounded-xl px-4 text-sm font-semibold transition-colors',
                            paper ? 'bg-ink text-paper hover:bg-black' : 'bg-signal text-signal-ink hover:bg-signal-strong',
                        )}
                    >
                        Upload a part
                    </Link>
                </nav>
                <button
                    type="button"
                    className={cn('inline-flex h-10 w-10 items-center justify-center rounded-lg md:hidden', paper ? 'text-ink hover:bg-black/5' : 'text-fg hover:bg-graphite-800')}
                    aria-expanded={open}
                    aria-controls="mobile-nav"
                    aria-label={open ? 'Close menu' : 'Open menu'}
                    onClick={() => setOpen((v) => !v)}
                >
                    {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
                </button>
            </div>
            {open && (
                <nav id="mobile-nav" aria-label="Primary" className={cn('border-t px-4 pb-4 pt-2 md:hidden', paper ? 'border-paper-line' : 'border-graphite-700')}>
                    <ul className="flex flex-col">
                        {NAV.map((n) => (
                            <li key={n.href}>
                                <Link href={n.href} className={cn(linkClass(n.href), 'block py-3 text-base')}>
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
