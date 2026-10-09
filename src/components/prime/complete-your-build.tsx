'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Check, Package, Paintbrush, Plus, ShoppingBag, Wrench } from 'lucide-react';
import type { UpsellKind, UpsellOffer } from '@/contracts/prime';
import type { QuoteView } from '@/contracts';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api';
import { money } from '@/lib/format';
import { cn } from '@/lib/utils';
import { primeApi } from './api';

const ICON: Record<UpsellKind, typeof Wrench> = { hardware_kit: Wrench, spare_part: Package, finish_upgrade: Paintbrush };

/** One "Complete your build" row: title, what it is, the server-priced delta, and an action. */
export function UpsellRow({ offer, currency, onAdd, busy, added, actionLabel = 'Add' }: { offer: UpsellOffer; currency: string; onAdd: () => void; busy: boolean; added: boolean; actionLabel?: string }) {
    const Icon = ICON[offer.kind];
    return (
        <li className="flex items-center gap-3 py-3" data-testid={`upsell-${offer.kind}`}>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-graphite-800 ring-1 ring-graphite-700" aria-hidden>
                <Icon className="h-5 w-5 text-signal" />
            </span>
            <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-fg">{offer.title}</p>
                <p className="text-xs text-fg-muted">{offer.description}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="font-mono text-sm tabular text-fg" data-testid={`upsell-${offer.kind}-delta`}>
                    +{money(Math.max(0, offer.deltaCents), currency)}
                </span>
                <Button size="sm" variant={added ? 'ghost' : 'secondary'} onClick={onAdd} loading={busy} disabled={added || busy} aria-label={`${actionLabel}: ${offer.title}`} data-testid={`upsell-${offer.kind}-add`}>
                    {added ? <Check className="h-4 w-4" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
                    {added ? 'Added' : actionLabel}
                </Button>
            </div>
        </li>
    );
}

/**
 * Configure / quote step: add this binding quote to the build cart, optionally with one
 * engine-priced upsell (DoorDash "Complete your order": after the main choice, never before).
 */
export function CompleteYourBuild({ quote }: { quote: QuoteView }) {
    const offers = useQuery({ queryKey: ['upsells', quote.id], queryFn: () => primeApi.upsells(quote.id), enabled: quote.orderable, staleTime: 60_000 });
    const [busy, setBusy] = useState<string | null>(null);
    const [added, setAdded] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    if (!quote.orderable) return null;

    const add = async (key: string, upsell?: UpsellKind) => {
        setBusy(key);
        setError(null);
        try {
            await primeApi.addToCart(quote.id, upsell);
            setAdded(key);
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(null);
        }
    };

    return (
        <section aria-labelledby="cyb-heading" className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700 sm:p-5" data-testid="complete-your-build">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="cyb-heading" className="font-display text-lg font-bold">
                    Complete your build
                </h2>
                <Button size="sm" variant={added === 'base' ? 'ghost' : 'secondary'} onClick={() => add('base')} loading={busy === 'base'} disabled={busy !== null || added !== null} data-testid="add-to-cart">
                    {added ? <Check className="h-4 w-4" aria-hidden /> : <ShoppingBag className="h-4 w-4" aria-hidden />}
                    {added ? 'In your build cart' : 'Add to build cart'}
                </Button>
            </div>
            <p className="mt-1 text-xs text-fg-subtle">Order several parts together in one checkout. Add-ons are priced by the same instant-quote engine.</p>
            {offers.data && offers.data.offers.length > 0 && (
                <ul className="mt-2 divide-y divide-graphite-700">
                    {offers.data.offers.map((o) => (
                        <UpsellRow key={o.kind} offer={o} currency={quote.currency} onAdd={() => add(o.kind, o.kind)} busy={busy === o.kind} added={added === o.kind} actionLabel="Add with part" />
                    ))}
                </ul>
            )}
            {offers.isLoading && <p className="mt-3 text-xs text-fg-subtle">Pricing add-ons…</p>}
            {error && (
                <p className={cn('mt-2 text-xs font-medium text-ember')} role="alert">
                    {error}
                </p>
            )}
        </section>
    );
}
