'use client';

import Link from 'next/link';
import { BadgeCheck, ChevronRight, Truck } from 'lucide-react';
import type { CheckoutPreviewResponse } from '@/contracts/prime';
import { money } from '@/lib/format';

/**
 * Checkout entry card. Members: the Prime benefits applied to this order. Everyone else:
 * "Prime members ship this free" with the real saving, linking to the trial paywall.
 */
export function PrimeCheckoutCard({ preview, currency }: { preview: CheckoutPreviewResponse | null; currency: string }) {
    if (!preview) return null;
    if (preview.isMember) {
        const saved = preview.benefits.filter((b) => b.savingsCents > 0);
        return (
            <section className="rounded-2xl bg-signal/10 p-4 ring-1 ring-inset ring-signal/30" data-testid="prime-applied" aria-labelledby="prime-applied-heading">
                <h2 id="prime-applied-heading" className="flex items-center gap-2 text-sm font-semibold text-fg">
                    <BadgeCheck className="h-4 w-4 text-signal" aria-hidden /> Prime benefits applied
                </h2>
                <ul className="mt-2 space-y-1 text-sm">
                    {saved.map((b) => (
                        <li key={b.code} className="flex justify-between gap-2" data-testid={`prime-benefit-${b.code}`}>
                            <span className="text-fg-muted">{b.label}</span>
                            <span className="font-mono tabular text-signal">−{money(b.savingsCents, currency)}</span>
                        </li>
                    ))}
                    {preview.benefits.some((b) => b.code === 'PRIORITY_QUEUE') && <li className="text-xs text-fg-subtle">Priority shop slot · guaranteed-date eligible</li>}
                    {saved.length === 0 && <li className="text-xs text-fg-subtle">Free shipping applies to Standard shipping on orders over the Prime threshold.</li>}
                </ul>
            </section>
        );
    }
    const offer = preview.primeOffer;
    if (!offer) return null;
    return (
        <Link href="/prime" className="flex items-center gap-3 rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700 hover:bg-graphite-850" data-testid="prime-offer-card">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-signal/15" aria-hidden>
                <Truck className="h-5 w-5 text-signal" />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-fg">{offer.savingsCents > 0 ? 'Prime members ship this free' : 'Prime: free shipping on bigger orders'}</span>
                <span className="block text-xs text-fg-muted">
                    {offer.savingsCents > 0 ? `Save ${money(offer.savingsCents, currency)} on this order` : `Free standard shipping over ${money(offer.freeShippingThresholdCents, currency)}`}
                    {offer.trialAvailable ? ' · 7-day free trial' : ''}
                </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden />
        </Link>
    );
}
