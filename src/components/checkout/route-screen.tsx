'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import type { QuoteView } from '@/contracts';
import { BuildSourcingPanel, SupplierRouteOptions } from '@/components/sourcing/build-sourcing-panel';
import { ButtonLink } from '@/components/ui/button';
import { ErrorState, Notice } from '@/components/ui/state';
import { PageSkeleton } from '@/components/ui/skeleton';
import { api, errorMessage } from '@/lib/api';
import { money, shortDate } from '@/lib/format';
import { RouteCard } from './route-card';
import { RouteComparison } from '@/components/prime/route-comparison';

const NOT_ORDERABLE_COPY: Record<QuoteView['status'], { title: string; body: string }> = {
    REVIEW: { title: 'This configuration needs a shop review', body: 'A partner shop confirms the price before it can be ordered. Meanwhile we can ask manufacturing partners to quote it.' },
    NEEDS_INPUT: { title: 'This design needs changes before it can be ordered', body: 'Fix the flagged issues in the configuration, or ask manufacturing partners what they can do.' },
    EXPIRED: { title: 'This quote expired', body: 'Open the configuration again for a fresh binding price, or ask manufacturing partners to quote it.' },
    ORDERED: { title: 'This quote was already ordered', body: 'Open the configuration to start a new quote.' },
    READY: { title: 'This price is not binding yet', body: 'Only a binding quote goes to checkout. Meanwhile we can ask manufacturing partners to quote it.' },
};

/**
 * Screen 03 · Manufacturing Route. The shop route the quote was priced on, plus partner
 * offers from sourcing labelled by trust level. Only a binding, orderable shop quote keeps
 * the checkout CTA; otherwise the buyer can ask partners to quote the build.
 */
export function RouteScreen({ quoteId }: { quoteId: string }) {
    const { data: quote, error, isLoading } = useQuery({ queryKey: ['quote', quoteId], queryFn: () => api.getQuote(quoteId) });
    if (isLoading) return <PageSkeleton label="Loading route" />;
    if (error || !quote) return <ErrorState title="Quote not found" message={errorMessage(error)} action={<ButtonLink href="/make">Upload a part</ButtonLink>} />;
    const orderable = quote.trustLevel === 'BINDING' && quote.orderable;
    const blocked = NOT_ORDERABLE_COPY[quote.status];
    return (
        <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
            <p className="eyebrow">Step 3 of 4 · Manufacturing route</p>
            <h1 className="mt-2 font-display font-wide text-3xl font-extrabold">Who makes your part</h1>
            <p className="mt-2 text-fg-muted">
                We matched your configuration to the partner shop with the right machine, material in stock and the earliest ship date.
            </p>
            <div className="mt-6">
                <RouteCard route={quote.route} trustLevel={quote.trustLevel} />
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-3 rounded-2xl bg-graphite-900 p-4 text-sm ring-1 ring-graphite-700">
                <div>
                    <dt className="text-fg-subtle">{orderable ? 'Unit price' : 'Est. unit price'}</dt>
                    <dd className="font-mono font-semibold tabular">{money(quote.unitPriceCents, quote.currency)}</dd>
                </div>
                <div>
                    <dt className="text-fg-subtle">Quantity</dt>
                    <dd className="font-mono font-semibold tabular">{quote.config.quantity}</dd>
                </div>
                <div>
                    <dt className="text-fg-subtle">Ships by</dt>
                    <dd className="font-semibold">{shortDate(quote.shipDate)}</dd>
                </div>
            </dl>
            {!orderable && (
                <Notice tone="warning" title={blocked.title} className="mt-4" testId="route-not-orderable">
                    {blocked.body}
                </Notice>
            )}
            <div className="mt-6 flex flex-wrap gap-3">
                {orderable && (
                    <ButtonLink href={`/checkout/${quote.id}`} size="lg" data-testid="route-continue">
                        Continue to checkout <ArrowRight className="h-4 w-4" aria-hidden />
                    </ButtonLink>
                )}
                <ButtonLink href={`/parts/${quote.partId}?from=${quote.id}`} variant="secondary" size="lg">
                    Change configuration
                </ButtonLink>
            </div>
            <div className="mt-10">
                <RouteComparison buildId={quote.buildId} quoteId={quote.id} />
            </div>
            <div className="mt-10">
                {orderable ? (
                    <SupplierRouteOptions buildId={quote.buildId} />
                ) : (
                    <BuildSourcingPanel buildId={quote.buildId} partId={quote.partId} defaultQuantity={quote.config.quantity} />
                )}
            </div>
        </div>
    );
}
