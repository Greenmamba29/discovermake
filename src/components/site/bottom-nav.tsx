'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { BOTTOM_NAV, activeKey, bottomNavVisible } from './nav-items';

/**
 * Mobile bottom nav (below md): Discover · Make · Builds · Me. Fixed to the bottom with the
 * safe-area inset; renders an in-flow spacer of the same height so page content and the
 * footer are never hidden behind it. Hidden on desktop and on focused flows / admin.
 */
export function BottomNav({ surface = 'graphite' }: { surface?: 'graphite' | 'paper' }) {
    const pathname = usePathname() ?? '/';
    if (!bottomNavVisible(pathname)) return null;
    const current = activeKey(BOTTOM_NAV, pathname);
    const paper = surface === 'paper';
    return (
        <>
            <div aria-hidden className="h-[calc(4rem+env(safe-area-inset-bottom))] shrink-0 md:hidden" data-testid="bottom-nav-spacer" />
            <nav
                aria-label="Primary"
                data-testid="bottom-nav"
                className={cn(
                    'fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden',
                    paper ? 'border-paper-line bg-paper-raised/95' : 'border-graphite-700 bg-graphite-950/95',
                )}
            >
                <ul className="mx-auto grid h-16 max-w-md" style={{ gridTemplateColumns: `repeat(${BOTTOM_NAV.length}, minmax(0, 1fr))` }}>
                    {BOTTOM_NAV.map((item) => {
                        const active = item.key === current;
                        const Icon = item.icon;
                        return (
                            <li key={item.key} className="flex">
                                <Link
                                    href={item.href}
                                    aria-current={active ? 'page' : undefined}
                                    data-testid={`bottom-nav-${item.key}`}
                                    className={cn(
                                        'flex min-h-[44px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors',
                                        paper
                                            ? active
                                                ? 'text-ink'
                                                : 'text-ink-muted hover:text-ink'
                                            : active
                                              ? 'text-signal'
                                              : 'text-fg-muted hover:text-fg',
                                    )}
                                >
                                    <span
                                        className={cn(
                                            'flex h-7 w-12 items-center justify-center rounded-full transition-colors',
                                            active && (paper ? 'bg-ink/10' : 'bg-signal/15'),
                                        )}
                                    >
                                        <Icon className="h-5 w-5" aria-hidden strokeWidth={active ? 2.4 : 2} />
                                    </span>
                                    {item.label}
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            </nav>
        </>
    );
}
