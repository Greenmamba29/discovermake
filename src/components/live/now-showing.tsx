'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Package, Sparkles, Wand2 } from 'lucide-react';
import type { DropView, FeaturedProduct } from '@/contracts/live';
import { Button, buttonClass } from '@/components/ui/button';
import { money } from '@/lib/format';
import { cn } from '@/lib/utils';

/** NOW SHOWING (Whatnot product card): driven only by `product.focus` events. */
export function NowShowingCard({ featured, onMakeMine, onRemix, compact }: { featured: FeaturedProduct | null; onMakeMine: () => void; onRemix: () => void; compact?: boolean }) {
    if (!featured) {
        return (
            <section aria-label="Now showing" className="rounded-2xl bg-graphite-900/90 p-3 ring-1 ring-graphite-700 backdrop-blur" data-testid="now-showing-empty">
                <p className="eyebrow">Now showing</p>
                <p className="mt-1 text-sm text-fg-muted">Nothing is featured yet. The host pins a product here when they show it.</p>
            </section>
        );
    }
    const facts = [
        featured.priceCents !== null ? money(featured.priceCents) : null,
        featured.specLine,
        featured.makeability !== null ? `Makeability ${featured.makeability}` : null,
        featured.leadTimeDays !== null ? `ships in ${featured.leadTimeDays} days` : null,
    ].filter(Boolean);
    return (
        <section aria-label="Now showing" className="rounded-2xl bg-graphite-900/90 p-3 ring-1 ring-graphite-700 backdrop-blur sm:p-4" data-testid="now-showing" data-build-id={featured.buildId}>
            <div className="flex items-baseline justify-between gap-2">
                <p className="eyebrow text-signal">Now showing</p>
                <p className="font-mono text-[11px] text-fg-subtle">{featured.displayId}</p>
            </div>
            <p className={cn('mt-1 truncate font-display font-bold', compact ? 'text-base' : 'text-lg')} data-testid="now-showing-name">
                {featured.name}
            </p>
            <p className="mt-0.5 text-sm text-fg-muted" data-testid="now-showing-facts">
                {facts.length ? facts.join(' · ') : 'No binding price yet: Make Mine to configure your own.'}
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2">
                <Button size="sm" className="whitespace-nowrap px-2" onClick={onMakeMine} disabled={!featured.canMakeThis} data-testid="make-mine">
                    <Sparkles className="h-4 w-4" aria-hidden /> Make Mine
                </Button>
                <Button size="sm" variant="secondary" className="whitespace-nowrap px-2" onClick={onRemix} disabled={!featured.canRemix} data-testid="remix" title={featured.canRemix ? undefined : 'Remix needs an approved design version'}>
                    <Wand2 className="h-4 w-4" aria-hidden /> Remix
                </Button>
                {featured.canBuy && featured.quoteId ? (
                    <Link href={`/checkout/${featured.quoteId}`} className={buttonClass('secondary', 'sm', 'whitespace-nowrap px-2')} data-testid="buy">
                        <Package className="h-4 w-4" aria-hidden /> Buy
                    </Link>
                ) : (
                    <Button size="sm" variant="secondary" disabled data-testid="buy" title="No orderable binding quote yet">
                        <Package className="h-4 w-4" aria-hidden /> Buy
                    </Button>
                )}
            </div>
        </section>
    );
}

function useCountdown(until: string | null): string | null {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!until) return;
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, [until]);
    if (!until) return null;
    const left = Math.max(0, new Date(until).getTime() - now);
    const m = Math.floor(left / 60_000);
    const s = Math.floor((left % 60_000) / 1000);
    return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m}:${String(s).padStart(2, '0')}`;
}

/** Build Slot counter: "68 / 250 slots left", progress to the production threshold, Claim. */
export function SlotCounter({ drop, ending, onClaim, canClaim, claimHint }: { drop: DropView; ending: boolean; onClaim: () => void; canClaim: boolean; claimHint?: string | null }) {
    const left = Math.max(0, drop.totalSlots - drop.claimedSlots);
    const pct = Math.min(100, Math.round((drop.claimedSlots / drop.totalSlots) * 100));
    const thresholdPct = Math.min(100, Math.round((drop.thresholdSlots / drop.totalSlots) * 100));
    const countdown = useCountdown(drop.status === 'OPEN' ? drop.closesAt : null);
    const closed = drop.status !== 'OPEN';
    const statusLine =
        drop.status === 'CONFIRMED'
            ? `Drop confirmed · ${drop.claimedSlots} slots go to production`
            : drop.status === 'FAILED'
              ? `Drop closed at ${drop.claimedSlots} of ${drop.thresholdSlots} · every hold was released`
              : drop.claimedSlots >= drop.thresholdSlots
                ? `Production confirmed at ${drop.thresholdSlots} · ${drop.claimedSlots} claimed`
                : `Production starts at ${drop.thresholdSlots} · ${drop.claimedSlots} claimed`;
    return (
        <section aria-label="Build Slots" className="rounded-2xl bg-graphite-900/90 p-3 ring-1 ring-graphite-700 backdrop-blur sm:p-4" data-testid="slot-counter" data-status={drop.status}>
            <div className="flex items-baseline justify-between gap-2">
                <p className="eyebrow">Live drop · {money(drop.priceCents)}</p>
                {countdown && (
                    <p className={cn('font-mono text-xs tabular', ending ? 'text-amber' : 'text-fg-subtle')} aria-label={`Ends in ${countdown}`}>
                        {ending ? 'Ending · ' : ''}
                        {countdown}
                    </p>
                )}
            </div>
            <p className="mt-1 font-display text-lg font-bold tabular" data-testid="slots-left" aria-live="polite">
                {left} / {drop.totalSlots} slots left
            </p>
            <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-graphite-700" role="progressbar" aria-label="Slots claimed" aria-valuemin={0} aria-valuemax={drop.totalSlots} aria-valuenow={drop.claimedSlots}>
                <div className="h-full rounded-full bg-signal transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${pct}%` }} />
                <div className="absolute inset-y-0 w-0.5 bg-fg" style={{ left: `${thresholdPct}%` }} aria-hidden />
            </div>
            <p className="mt-1.5 text-xs text-fg-muted" data-testid="slot-status">
                {statusLine}
            </p>
            {!closed && (
                <Button className="mt-3 w-full" onClick={onClaim} disabled={!canClaim || left === 0} data-testid="claim-slot">
                    {left === 0 ? 'Sold out' : 'Claim Build Slot'}
                </Button>
            )}
            {claimHint && <p className="mt-1.5 text-center text-xs text-fg-subtle">{claimHint}</p>}
        </section>
    );
}
