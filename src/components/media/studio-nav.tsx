'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, Radio, Send, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';

const LINKS = [
    { href: '/studio', label: 'Shows', icon: Radio, testId: 'studio-nav-shows' },
    { href: '/studio/insights', label: 'Insights', icon: BarChart3, testId: 'studio-nav-insights' },
    { href: '/studio/publish', label: 'Publishing', icon: Send, testId: 'studio-nav-publish' },
    { href: '/studio/payouts', label: 'Payouts', icon: Wallet, testId: 'studio-nav-payouts' },
] as const;

/** Creator Studio sections (workflow 08 routes): Shows · Insights · Publishing · Payouts. */
export function StudioNav() {
    const pathname = usePathname();
    return (
        <nav aria-label="Creator Studio" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" data-testid="studio-nav">
            <ul className="flex w-max gap-2 sm:w-auto">
                {LINKS.map((l) => {
                    const current = l.href === '/studio' ? pathname === '/studio' : pathname.startsWith(l.href);
                    return (
                        <li key={l.href}>
                            <Link
                                href={l.href}
                                aria-current={current ? 'page' : undefined}
                                className={cn('inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-4 text-sm font-semibold ring-1 ring-inset', current ? 'bg-fg text-graphite-950 ring-fg' : 'bg-graphite-850 text-fg-muted ring-graphite-600 hover:text-fg')}
                                data-testid={l.testId}
                            >
                                <l.icon className="h-4 w-4" aria-hidden /> {l.label}
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </nav>
    );
}
