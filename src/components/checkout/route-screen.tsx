'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { ButtonLink } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/state';
import { PageSkeleton } from '@/components/ui/skeleton';
import { api, errorMessage } from '@/lib/api';
import { money, shortDate } from '@/lib/format';
import { RouteCard } from './route-card';

/** Screen 03 · Manufacturing Route. R1 has one recommended route per quote. */
export function RouteScreen({ quoteId }: { quoteId: string }) {
    const { data: quote, error, isLoading } = useQuery({ queryKey: ['quote', quoteId], queryFn: () => api.getQuote(quoteId) });
    if (isLoading) return <PageSkeleton label="Loading route" />;
    if (error || !quote) return <ErrorState title="Quote not found" message={errorMessage(error)} action={<ButtonLink href="/make">Upload a part</ButtonLink>} />;
    return (
        <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
            <p className="eyebrow">Step 3 of 4 · Manufacturing route</p>
            <h1 className="mt-2 font-display font-wide text-3xl font-extrabold">Who makes your part</h1>
            <p className="mt-2 text-fg-muted">
                We matched your configuration to the partner shop with the right machine, material in stock and the earliest ship date.
            </p>
            <div className="mt-6">
                <RouteCard route={quote.route} />
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-3 rounded-2xl bg-graphite-900 p-4 text-sm ring-1 ring-graphite-700">
                <div>
                    <dt className="text-fg-subtle">Unit price</dt>
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
            <div className="mt-6 flex flex-wrap gap-3">
                <ButtonLink href={`/checkout/${quote.id}`} size="lg" data-testid="route-continue">
                    Continue to checkout <ArrowRight className="h-4 w-4" aria-hidden />
                </ButtonLink>
                <ButtonLink href={`/parts/${quote.partId}?from=${quote.id}`} variant="secondary" size="lg">
                    Change configuration
                </ButtonLink>
            </div>
        </div>
    );
}
