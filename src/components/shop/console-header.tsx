'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { LogoMark } from '@/components/site/logo';
import { api } from '@/lib/api';
import { useShopSession } from './use-shop-session';

export function ConsoleHeader() {
    const { data } = useShopSession();
    const qc = useQueryClient();
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    return (
        <header className="sticky top-0 z-40 border-b border-graphite-700 bg-graphite-950/95 backdrop-blur">
            <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-signal focus:px-3 focus:py-2 focus:text-signal-ink">
                Skip to content
            </a>
            <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
                <Link href={data ? '/shop/jobs' : '/shop'} className="flex items-center gap-2 rounded-md">
                    <LogoMark className="h-6 w-6 text-fg" />
                    <span className="hidden font-display font-wide text-sm font-bold sm:inline">DiscoverMake</span>
                    <span className="rounded-md bg-graphite-750 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-fg-muted">Shop Console</span>
                </Link>
                {data && (
                    <div className="flex items-center gap-2">
                        <nav aria-label="Shop Console" className="flex items-center gap-1">
                            <Link href="/shop/jobs" className="inline-flex h-9 items-center rounded-lg px-2 text-sm font-medium text-fg-muted hover:bg-graphite-800 hover:text-fg">
                                Jobs
                            </Link>
                            <Link href="/shop/stock" className="inline-flex h-9 items-center rounded-lg px-2 text-sm font-medium text-fg-muted hover:bg-graphite-800 hover:text-fg" data-testid="shop-nav-stock">
                                Stock
                            </Link>
                        </nav>
                        <span className="hidden text-sm text-fg-muted lg:inline">{data.shop.name}</span>
                        <button
                            type="button"
                            disabled={busy}
                            onClick={async () => {
                                setBusy(true);
                                try {
                                    await api.shopLogout();
                                } catch {
                                    /* cookie may already be gone */
                                }
                                qc.removeQueries({ queryKey: ['shop-session'] });
                                qc.removeQueries({ queryKey: ['shop-jobs'] });
                                router.replace('/shop');
                            }}
                            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-fg-muted hover:bg-graphite-800 hover:text-fg"
                            data-testid="shop-logout"
                        >
                            <LogOut className="h-4 w-4" aria-hidden /> <span className="sr-only sm:not-sr-only">Sign out</span>
                        </button>
                    </div>
                )}
            </div>
        </header>
    );
}
