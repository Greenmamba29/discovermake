'use client';

import { AlertTriangle, BadgeCheck, CalendarClock, Clock, Globe2, ShieldCheck } from 'lucide-react';
import type { RouteOfferView } from '@/contracts';
import { TrustChip } from '@/components/trust/trust-chip';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmAction } from '@/components/ui/confirm-action';
import { errorMessage } from '@/lib/api';
import { money, plural } from '@/lib/format';
import { cn } from '@/lib/utils';
import { regionName } from './regions';

const OFFER_STATUS_COPY: Partial<Record<RouteOfferView['status'], string>> = {
    STALE: 'Out of date: your design changed after this quote',
    WITHDRAWN: 'Withdrawn by the partner',
    REJECTED: 'No longer available',
    SELECTED: 'Selected route',
};

function BindingQuoteButton({ offerId, onBindingQuote }: { offerId: string; onBindingQuote: (offerId: string) => Promise<void> }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    return (
        <div>
            <Button
                size="sm"
                loading={busy}
                onClick={async () => {
                    setBusy(true);
                    setError(null);
                    try {
                        await onBindingQuote(offerId);
                    } catch (err) {
                        setError(errorMessage(err));
                        setBusy(false);
                    }
                }}
                data-testid={`supplier-quote-${offerId}`}
            >
                Get your binding price
            </Button>
            {error && (
                <p className="mt-2 text-xs text-ember" role="alert">
                    {error}
                </p>
            )}
        </div>
    );
}

export const SELECT_PROMPT = "We'll confirm this route with you before anything is ordered. Nothing is charged now.";

/**
 * A supplier offer as an extra Manufacturing Route option. Buyer-safe: the label, region and
 * verification only, never the supplier's name or platform.
 */
export function RouteOfferCard({
    offer,
    onSelect,
    onBindingQuote,
    selectBlockedReason,
}: {
    offer: RouteOfferView;
    onSelect?: (offerId: string) => Promise<void>;
    /** R3: turn a confirmed route into a BINDING quote and go to checkout. */
    onBindingQuote?: (offerId: string) => Promise<void>;
    /** Why selecting is not possible right now (e.g. another route is awaiting confirmation). */
    selectBlockedReason?: string | null;
}) {
    const sel = offer.selection;
    const inactive = offer.status !== 'ACTIVE' && offer.status !== 'SELECTED';
    // Only supplier-confirmed offers can be chosen (workflow 03): estimates are not orderable,
    // and the server refuses to open a selection for them.
    const confirmed = offer.trustLevel === 'SUPPLIER_CONFIRMED';
    const selectable = Boolean(onSelect) && confirmed && offer.status === 'ACTIVE' && (!sel || sel.status === 'REJECTED' || sel.status === 'EXPIRED' || sel.status === 'CANCELLED');
    const unitLine = `${money(offer.unitPriceCents)} each × ${offer.quantity.toLocaleString('en-US')}`;
    const titleId = `offer-${offer.id}-title`;
    return (
        <article
            aria-labelledby={titleId}
            className={cn('rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700', inactive && 'opacity-60', sel?.status === 'APPROVED' && 'ring-signal/50')}
            data-testid={`route-offer-${offer.id}`}
            data-trust={offer.trustLevel}
        >
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <p id={titleId} className="flex flex-wrap items-center gap-2 font-semibold text-fg">
                        {offer.label}
                        {offer.verified && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-graphite-750 px-2 py-0.5 text-[11px] font-medium text-fg-muted">
                                <BadgeCheck className="h-3 w-3" aria-hidden /> Verified
                            </span>
                        )}
                    </p>
                    <p className="mt-0.5 inline-flex items-center gap-1 text-sm text-fg-muted">
                        <Globe2 className="h-3.5 w-3.5" aria-hidden /> Made in {regionName(offer.country)}
                    </p>
                </div>
                <TrustChip level={offer.trustLevel} showOrderable testId="offer-trust-chip" />
            </div>

            <div className="mt-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
                <div>
                    <p className="font-display text-2xl font-extrabold tabular tracking-tight" data-testid="offer-total">
                        {money(offer.totalCents)}
                    </p>
                    <p className="text-xs text-fg-muted tabular">
                        {unitLine}
                        {offer.toolingCents > 0 && ` + ${money(offer.toolingCents)} tooling`}
                        {offer.shippingIncluded ? ' · shipping included' : ' · shipping not included yet'}
                    </p>
                </div>
                <p className="inline-flex items-center gap-1.5 text-sm text-fg" data-testid="offer-lead">
                    <CalendarClock className="h-4 w-4 text-fg-muted" aria-hidden />
                    {plural(offer.totalLeadDays, 'day')} {offer.shippingIncluded ? 'to your door' : 'to ship'}
                </p>
            </div>

            {offer.exceptions.length > 0 && (
                <div className="mt-3 rounded-xl bg-amber/10 p-3 ring-1 ring-inset ring-amber/30" data-testid="offer-exceptions">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-amber">
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Differs from your request
                    </p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-fg-muted">
                        {offer.exceptions.map((x) => (
                            <li key={x}>{x}</li>
                        ))}
                    </ul>
                </div>
            )}

            <div className="mt-3">
                {inactive ? (
                    <p className="text-xs font-medium text-fg-subtle">{OFFER_STATUS_COPY[offer.status]}</p>
                ) : sel?.status === 'PENDING' ? (
                    <p className="flex items-start gap-1.5 text-sm text-amber" data-testid="offer-selection-pending">
                        <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                        <span>
                            Waiting for DiscoverMake to confirm this route. <span className="text-fg-muted">We&apos;ll confirm it with you before anything is ordered.</span>
                        </span>
                    </p>
                ) : sel?.status === 'APPROVED' || offer.status === 'SELECTED' ? (
                    <div className="space-y-3">
                        <p className="flex items-start gap-1.5 text-sm text-signal" data-testid="offer-selection-approved">
                            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                            <span>
                                Route confirmed. <span className="text-fg-muted">Get your binding price to order it; nothing has been ordered or charged yet.</span>
                            </span>
                        </p>
                        {onBindingQuote && <BindingQuoteButton offerId={offer.id} onBindingQuote={onBindingQuote} />}
                    </div>
                ) : (
                    <>
                        {sel?.status === 'REJECTED' && <p className="mb-2 text-xs text-fg-muted">We couldn&apos;t confirm this route last time. You can ask again or pick another.</p>}
                        {selectable && !selectBlockedReason ? (
                            <ConfirmAction label="Choose this route" confirmLabel="Ask to confirm" prompt={SELECT_PROMPT} variant="secondary" size="sm" onConfirm={() => onSelect!(offer.id)} testId={`select-offer-${offer.id}`} />
                        ) : selectBlockedReason ? (
                            <p className="text-xs text-fg-subtle">{selectBlockedReason}</p>
                        ) : (
                            !confirmed &&
                            offer.status === 'ACTIVE' && (
                                <p className="text-xs text-fg-subtle" data-testid={`offer-estimate-note-${offer.id}`}>
                                    Estimate only. You can choose this route once the partner confirms it against your exact design.
                                </p>
                            )
                        )}
                    </>
                )}
            </div>
        </article>
    );
}
