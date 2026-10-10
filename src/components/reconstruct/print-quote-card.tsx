'use client';

/**
 * The print quote card on the review step: material, quantity, the trust chip, the 1/10/25/50/100
 * ladder and the line items, then the existing checkout (`/checkout/:quoteId`) when BINDING.
 * Prices come only from the server's print quote engine.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer, Truck } from 'lucide-react';
import type { ReconstructView } from '@/contracts/reconstruct';
import { TrustChip } from '@/components/trust';
import { Button, ButtonLink } from '@/components/ui/button';
import { InfoTip } from '@/components/ui/info-tip';
import { QtyStepper } from '@/components/ui/qty-stepper';
import { Skeleton } from '@/components/ui/skeleton';
import { Notice } from '@/components/ui/state';
import { errorMessage } from '@/lib/api';
import { money, shortDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { reconstructApi, reconstructQueryKey } from './reconstruct-api';

export function PrintQuoteCard({ view }: { view: ReconstructView }) {
    const qc = useQueryClient();
    const [material, setMaterial] = useState(view.printMaterialSlug ?? view.printMaterials[0]?.slug ?? 'petg');
    const [quantity, setQuantity] = useState(view.quantity);
    const quote = useQuery({ queryKey: ['quote', view.quoteId], queryFn: ({ signal }) => reconstructApi.getQuote(view.quoteId!, signal), enabled: Boolean(view.quoteId) });
    const requote = useMutation({
        mutationFn: () => reconstructApi.quote(view.buildId, material, quantity),
        onSuccess: async (q) => {
            qc.setQueryData(['quote', q.id], q);
            await qc.invalidateQueries({ queryKey: reconstructQueryKey(view.buildId) });
        },
    });
    const q = quote.data ?? null;
    const selectedName = view.printMaterials.find((m) => m.slug === material)?.name;
    const stale = q !== null && (q.summary.materialName !== selectedName || q.config.quantity !== quantity);

    return (
        <section aria-labelledby="print-quote-heading" className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700 sm:p-5" data-testid="print-quote-card">
            <h2 id="print-quote-heading" className="flex items-center gap-2 font-display text-lg font-bold">
                <Printer className="h-5 w-5" aria-hidden /> 3D-printed replacement
            </h2>
            <fieldset className="mt-3" disabled={!view.canEdit || requote.isPending}>
                <legend className="text-sm font-medium">Material</legend>
                <div className="mt-2 grid gap-2">
                    {view.printMaterials.map((m) => (
                        <label key={m.slug} className={cn('flex cursor-pointer items-start gap-2 rounded-lg p-2.5 text-sm ring-1 ring-inset', material === m.slug ? 'bg-signal/10 ring-signal' : 'ring-graphite-700 hover:ring-graphite-500')} data-testid={`print-material-${m.slug}`}>
                            <input type="radio" name="print-material" value={m.slug} checked={material === m.slug} onChange={() => setMaterial(m.slug)} className="mt-1 accent-signal" />
                            <span className="h-4 w-4 shrink-0 rounded-full ring-1 ring-graphite-600" style={{ backgroundColor: m.swatchHex }} aria-hidden />
                            <span className="min-w-0">
                                <span className="font-semibold">{m.name}</span> <span className="text-xs text-fg-subtle">{m.process}{m.heatDeflectionC ? ` · to ${m.heatDeflectionC} °C` : ''}</span>
                                <span className="block text-xs text-fg-muted">{m.description}</span>
                            </span>
                        </label>
                    ))}
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">Quantity</span>
                    <QtyStepper value={quantity} onChange={setQuantity} min={1} max={100} label="Quantity" testId="print-qty" size="sm" />
                </div>
                {(!q || stale) && view.canEdit && (
                    <Button className="mt-3 w-full" onClick={() => requote.mutate()} loading={requote.isPending} data-testid="print-get-quote">
                        {q ? 'Update the quote' : 'Get an instant quote'}
                    </Button>
                )}
            </fieldset>
            {requote.error && <Notice tone="error" className="mt-3">{errorMessage(requote.error)}</Notice>}
            {view.quoteId && quote.isPending && <Skeleton className="mt-4 h-40 w-full" />}
            {q && (
                <div className={cn('mt-4 border-t border-graphite-700 pt-4', stale && 'opacity-60')} data-testid="print-quote">
                    <TrustChip level={q.trustLevel} showOrderable />
                    <p className="mt-3 flex items-baseline justify-between gap-2">
                        <span className="font-display text-3xl font-extrabold" data-testid="print-total">
                            {money(q.subtotalCents, q.currency)}
                        </span>
                        <span className="text-sm text-fg-muted">
                            {q.config.quantity} × {money(q.unitPriceCents, q.currency)}
                        </span>
                    </p>
                    <p className="mt-1 text-xs text-fg-muted">
                        {q.summary.materialName} · {q.summary.thicknessLabel} · {q.route.machineLabel ?? q.route.processName}
                    </p>
                    <p className="mt-2 flex items-center gap-1.5 text-sm">
                        <Truck className="h-4 w-4 text-fg-muted" aria-hidden /> Ships {shortDate(q.shipDate)} · {q.leadTimeDays} business days
                    </p>
                    <ul className="mt-3 space-y-1 text-sm" data-testid="print-line-items">
                        {q.lineItems.map((l) => (
                            <li key={l.code} className="flex items-center justify-between gap-2">
                                <span className="flex min-w-0 items-center gap-1 truncate text-fg-muted">
                                    {l.label} <InfoTip label={l.label} text={l.explainer} />
                                </span>
                                <span className="font-mono">{money(l.totalCents, q.currency)}</span>
                            </li>
                        ))}
                    </ul>
                    <table className="mt-3 w-full text-left text-xs" data-testid="print-ladder">
                        <caption className="sr-only">Price per part by quantity</caption>
                        <thead className="text-fg-muted">
                            <tr>
                                <th scope="col" className="py-1 font-medium">Qty</th>
                                <th scope="col" className="py-1 font-medium">Each</th>
                                <th scope="col" className="py-1 font-medium">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {q.ladder.map((r) => (
                                <tr key={r.quantity} className={cn('border-t border-graphite-800', r.quantity === q.config.quantity && 'font-semibold text-signal')}>
                                    <td className="py-1">{r.quantity}</td>
                                    <td className="py-1 font-mono">{money(r.unitPriceCents, q.currency)}</td>
                                    <td className="py-1 font-mono">{money(r.totalCents, q.currency)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {q.dfm.violations.length > 0 && (
                        <ul className="mt-3 space-y-1 text-xs text-amber" data-testid="print-dfm">
                            {q.dfm.violations.map((v) => (
                                <li key={v.ruleId}>{v.message}</li>
                            ))}
                        </ul>
                    )}
                    {q.orderable && !stale ? (
                        <ButtonLink href={`/checkout/${q.id}`} size="lg" className="mt-4 w-full" data-testid="print-checkout">
                            Checkout
                        </ButtonLink>
                    ) : !stale ? (
                        <p className="mt-4 text-sm text-fg-muted">This price needs a partner to confirm it before it can be ordered.</p>
                    ) : null}
                </div>
            )}
        </section>
    );
}
