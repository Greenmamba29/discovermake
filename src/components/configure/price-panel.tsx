'use client';

import { useState } from 'react';
import { CalendarClock, ChevronDown, Truck } from 'lucide-react';
import type { QuoteView } from '@/contracts';
import { InfoTip } from '@/components/ui/info-tip';
import { MakeabilityRing } from '@/components/ui/makeability-ring';
import { TrustChip } from '@/components/trust/trust-chip';
import { money, shortDate, dateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

const TIER_LABEL: Record<QuoteView['tier'], string> = { PROTOTYPE: 'Prototype', SMALL_BATCH: 'Small batch', PRODUCTION_RUN: 'Production run' };

/** Live price, makeability ring, ship date, quantity ladder and ⓘ line items for one immutable quote. */
export function PricePanel({ quote, updating, onPickQuantity }: { quote: QuoteView; updating: boolean; onPickQuantity: (q: number) => void }) {
    const [showBreakdown, setShowBreakdown] = useState(false);
    const qty = quote.config.quantity;
    const cheapestShip = [...quote.shippingOptions].sort((a, b) => a.priceCents - b.priceCents)[0];
    return (
        <section aria-labelledby="price-heading" aria-busy={updating} className={cn('rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700 transition-opacity sm:p-5', updating && 'opacity-70')}>
            <h2 id="price-heading" className="sr-only">
                Instant quote
            </h2>
            <div className="flex items-start gap-4">
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <TrustChip level={quote.trustLevel} />
                        <span className="rounded-full bg-graphite-750 px-2 py-0.5 text-[11px] font-medium text-fg-muted">{TIER_LABEL[quote.tier]}</span>
                    </div>
                    <p className="mt-3 font-display text-4xl font-extrabold tabular tracking-tight text-fg" aria-live="polite" data-testid="quote-subtotal" key={quote.id}>
                        <span className="inline-block animate-price-tick">{money(quote.subtotalCents, quote.currency)}</span>
                    </p>
                    <p className="mt-0.5 text-sm text-fg-muted tabular">
                        {money(quote.unitPriceCents, quote.currency)} each × {qty}
                    </p>
                </div>
                <div className="flex flex-col items-center gap-1">
                    <MakeabilityRing score={quote.dfm.makeabilityScore} blocking={quote.dfm.blocking} />
                    <span className="text-[11px] text-fg-subtle">Makeability</span>
                </div>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-graphite-700 pt-4 text-sm">
                <div className="flex gap-2">
                    <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-signal" aria-hidden />
                    <div>
                        <dt className="text-fg-subtle">Ships by</dt>
                        <dd className="font-semibold text-fg" data-testid="quote-ship-date">{shortDate(quote.shipDate)}</dd>
                    </div>
                </div>
                <div className="flex gap-2">
                    <Truck className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
                    <div>
                        <dt className="text-fg-subtle">Shipping from</dt>
                        <dd className="font-semibold text-fg">{cheapestShip ? money(cheapestShip.priceCents, quote.currency) : '—'}</dd>
                    </div>
                </div>
            </dl>

            <div className="mt-4">
                <p className="eyebrow mb-2">Price by quantity</p>
                <div className="overflow-hidden rounded-xl ring-1 ring-graphite-700">
                    <table className="w-full text-sm" data-testid="quantity-ladder">
                        <caption className="sr-only">Unit and total price at each quantity, same configuration</caption>
                        <thead className="bg-graphite-850 text-left text-[11px] uppercase tracking-wider text-fg-subtle">
                            <tr>
                                <th scope="col" className="px-3 py-2 font-medium">Qty</th>
                                <th scope="col" className="px-3 py-2 text-right font-medium">Each</th>
                                <th scope="col" className="px-3 py-2 text-right font-medium">Total</th>
                                <th scope="col" className="hidden px-3 py-2 text-right font-medium sm:table-cell">Ships</th>
                            </tr>
                        </thead>
                        <tbody className="font-mono tabular">
                            {quote.ladder.map((r) => {
                                const active = r.quantity === qty;
                                return (
                                    <tr key={r.quantity} className={cn('border-t border-graphite-700', active && 'bg-signal/10')}>
                                        <td className="px-3 py-2">
                                            <button type="button" onClick={() => onPickQuantity(r.quantity)} className="rounded font-semibold text-fg underline-offset-4 hover:underline" aria-label={`Set quantity to ${r.quantity}`} aria-pressed={active}>
                                                {r.quantity}
                                            </button>
                                        </td>
                                        <td className="px-3 py-2 text-right text-fg">
                                            {money(r.unitPriceCents, quote.currency)}
                                            {r.savingsPct > 0 && <span className="ml-1.5 text-[11px] text-signal">−{r.savingsPct}%</span>}
                                        </td>
                                        <td className="px-3 py-2 text-right text-fg-muted">{money(r.totalCents, quote.currency)}</td>
                                        <td className="hidden px-3 py-2 text-right text-fg-muted sm:table-cell">{shortDate(r.shipDate)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            <button
                type="button"
                className="mt-4 flex w-full items-center justify-between rounded-lg py-1 text-sm font-semibold text-fg"
                aria-expanded={showBreakdown}
                aria-controls="price-breakdown"
                onClick={() => setShowBreakdown((v) => !v)}
            >
                Price breakdown
                <ChevronDown className={cn('h-4 w-4 transition-transform', showBreakdown && 'rotate-180')} aria-hidden />
            </button>
            {showBreakdown && (
                <ul id="price-breakdown" className="mt-2 space-y-1.5 text-sm" data-testid="line-items">
                    {quote.lineItems.map((li) => (
                        <li key={li.code + li.label} className="flex items-center justify-between gap-2">
                            <span className="flex items-center text-fg-muted">
                                {li.label}
                                <InfoTip label={li.label} text={li.explainer} />
                            </span>
                            <span className="font-mono tabular text-fg">{money(li.totalCents, quote.currency)}</span>
                        </li>
                    ))}
                    <li className="flex items-center justify-between border-t border-graphite-700 pt-1.5 font-semibold">
                        <span>Subtotal</span>
                        <span className="font-mono tabular">{money(quote.subtotalCents, quote.currency)}</span>
                    </li>
                </ul>
            )}
            <p className="mt-3 text-[11px] text-fg-subtle">
                Quote {quote.id.slice(0, 12)}… · valid until {dateTime(quote.validUntil)} · rules {quote.rulesetVersion}
            </p>
        </section>
    );
}
