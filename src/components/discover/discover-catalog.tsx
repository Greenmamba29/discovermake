'use client';

import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import type { InterestSlug } from '@/contracts/account';
import { useMe } from '@/components/site/use-account';
import { EmptyState } from '@/components/ui/state';
import { DISCOVER_CATALOG, filterCatalog, type DiscoverItem } from '@/lib/discover-catalog';
import { INTEREST_OPTIONS } from '@/lib/interests';
import { cn } from '@/lib/utils';
import { DiscoverCard } from './discover-card';

/**
 * Discover grid (workflow 10: Pinterest home feed / Behance creative fields). Interest chips
 * filter the starters; the visitor's onboarding picks (GET /api/me preferences) are applied
 * once on load when they have any.
 */
export function DiscoverCatalog({ makeAiEnabled, items = DISCOVER_CATALOG }: { makeAiEnabled: boolean; items?: readonly DiscoverItem[] }) {
    const { data: me } = useMe();
    const [selected, setSelected] = useState<InterestSlug[]>([]);
    const [fromPrefs, setFromPrefs] = useState(false);
    const touched = useRef(false);

    useEffect(() => {
        const picks = me?.preferences.interests ?? [];
        if (touched.current || picks.length === 0) return;
        setSelected(picks);
        setFromPrefs(true);
    }, [me]);

    const toggle = (slug: InterestSlug) => {
        touched.current = true;
        setFromPrefs(false);
        setSelected((s) => (s.includes(slug) ? s.filter((x) => x !== slug) : [...s, slug]));
    };
    const clear = () => {
        touched.current = true;
        setFromPrefs(false);
        setSelected([]);
    };

    const visible = filterCatalog(items, selected);

    return (
        <div>
            <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0" data-testid="interest-filters">
                <ul className="flex w-max gap-2 sm:w-auto sm:flex-wrap" aria-label="Filter by interest">
                    <li>
                        <button
                            type="button"
                            onClick={clear}
                            aria-pressed={selected.length === 0}
                            className={cn(
                                'inline-flex min-h-[44px] items-center rounded-full px-4 text-sm font-semibold ring-1 ring-inset transition-colors',
                                selected.length === 0 ? 'bg-fg text-graphite-950 ring-fg' : 'bg-graphite-850 text-fg-muted ring-graphite-600 hover:text-fg',
                            )}
                            data-testid="interest-filter-all"
                        >
                            All
                        </button>
                    </li>
                    {INTEREST_OPTIONS.map((o) => {
                        const on = selected.includes(o.slug);
                        return (
                            <li key={o.slug}>
                                <button
                                    type="button"
                                    onClick={() => toggle(o.slug)}
                                    aria-pressed={on}
                                    className={cn(
                                        'inline-flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-sm font-medium ring-1 ring-inset transition-colors',
                                        on ? 'bg-signal/15 text-signal ring-signal/60' : 'bg-graphite-850 text-fg-muted ring-graphite-600 hover:text-fg',
                                    )}
                                    data-testid={`interest-filter-${o.slug}`}
                                >
                                    {on ? <Check className="h-4 w-4" aria-hidden /> : <o.icon className="h-4 w-4" aria-hidden />}
                                    {o.label}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            </div>
            <p className="mt-3 text-sm text-fg-muted" aria-live="polite" data-testid="discover-count">
                {visible.length} {visible.length === 1 ? 'starter' : 'starters'}
                {fromPrefs && ' picked from your interests'}
                {selected.length > 0 && (
                    <>
                        {' · '}
                        <button type="button" onClick={clear} className="min-h-[24px] font-semibold text-fg underline-offset-4 hover:underline">
                            Show everything
                        </button>
                    </>
                )}
            </p>
            {visible.length === 0 ? (
                <div className="mt-6">
                    <EmptyState title="No starters for that mix yet">Clear a filter, or describe your own part from the Make tab.</EmptyState>
                </div>
            ) : (
                <div className="mt-5 gap-4 sm:columns-2 lg:columns-3" data-testid="discover-grid">
                    {visible.map((item) => (
                        <DiscoverCard key={item.slug} item={item} makeAiEnabled={makeAiEnabled} />
                    ))}
                </div>
            )}
        </div>
    );
}
