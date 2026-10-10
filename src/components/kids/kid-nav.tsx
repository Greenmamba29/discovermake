'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { DoorOpen, Hammer, Package } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Kids mode nav (every width): Make · My things · Exit. Replaces the adult 5-tab nav in Kids mode. */
export const KID_NAV = [
    { key: 'make', href: '/kids', label: 'Make', icon: Hammer, match: (p: string) => p === '/kids' || p.startsWith('/kids/make') || p.startsWith('/kids/discover') || p.startsWith('/kids/live') },
    { key: 'things', href: '/kids/things', label: 'My things', icon: Package, match: (p: string) => p.startsWith('/kids/things') },
    { key: 'exit', href: '/kids/exit', label: 'Exit', icon: DoorOpen, match: (p: string) => p.startsWith('/kids/exit') },
] as const;

export function KidNav() {
    const pathname = usePathname() ?? '/kids';
    return (
        <>
            <div aria-hidden className="h-[calc(5rem+env(safe-area-inset-bottom))] shrink-0" />
            <nav aria-label="Kids mode" data-testid="kid-bottom-nav" className="fixed inset-x-0 bottom-0 z-40 border-t border-paper-line bg-paper-raised/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
                <ul className="mx-auto grid h-20 max-w-md grid-cols-3">
                    {KID_NAV.map((item) => {
                        const active = item.match(pathname);
                        const Icon = item.icon;
                        return (
                            <li key={item.key} className="flex">
                                <Link
                                    href={item.href}
                                    aria-current={active ? 'page' : undefined}
                                    data-testid={`kid-nav-${item.key}`}
                                    className={cn('flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 text-sm font-bold', active ? 'text-ink' : 'text-ink-muted hover:text-ink')}
                                >
                                    <span className={cn('flex h-9 w-14 items-center justify-center rounded-full', active && 'bg-ink/10')}>
                                        <Icon className="h-6 w-6" aria-hidden strokeWidth={active ? 2.6 : 2} />
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
