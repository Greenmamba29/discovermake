'use client';

import { useState } from 'react';
import { CheckCircle2, Circle, CircleDot, CreditCard, XCircle } from 'lucide-react';
import type { OrderView } from '@/contracts';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/state';
import { errorMessage } from '@/lib/api';
import { dateTime, money } from '@/lib/format';
import { primeApi } from '@/lib/prime-api';
import { cn } from '@/lib/utils';

type Route = NonNullable<OrderView['supplierRoute']>;

const ICON = {
    done: <CheckCircle2 className="h-5 w-5 shrink-0 text-signal" aria-hidden />,
    current: <CircleDot className="h-5 w-5 shrink-0 text-amber" aria-hidden />,
    upcoming: <Circle className="h-5 w-5 shrink-0 text-graphite-500" aria-hidden />,
    failed: <XCircle className="h-5 w-5 shrink-0 text-ember" aria-hidden />,
} as const;

/** Supplier-route steps (one plain sentence per step) and the deposit / balance. Never the supplier's name. */
export function SupplierRouteTracker({ orderId, token, route, currency }: { orderId: string; token: string; route: Route; currency: string }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const p = route.payment;
    const balanceDue = p.depositPaid && !p.balancePaid && p.balanceCents > 0;
    const payBalance = async () => {
        setBusy(true);
        setError(null);
        try {
            const session = p.balancePayUrl ? { redirectUrl: p.balancePayUrl } : await primeApi.requestBalance(orderId, token);
            window.location.assign(session.redirectUrl);
        } catch (err) {
            setError(errorMessage(err));
            setBusy(false);
        }
    };
    return (
        <section aria-labelledby="supplier-route-heading" className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700 sm:p-5" data-testid="supplier-route">
            <h2 id="supplier-route-heading" className="font-display text-lg font-bold">
                Your manufacturing route
            </h2>
            <p className="mt-1 text-sm text-fg-muted">{route.label}</p>
            <ol className="mt-4 space-y-3">
                {route.steps.map((s) => (
                    <li key={s.key} className="flex items-start gap-3" data-testid={`supplier-step-${s.key}`} data-state={s.state}>
                        {ICON[s.state]}
                        <div className="min-w-0">
                            <p className={cn('text-sm', s.state === 'upcoming' ? 'text-fg-muted' : 'text-fg', s.state === 'current' && 'font-semibold')}>{s.sentence}</p>
                            {s.at && s.state !== 'upcoming' && <p className="font-mono text-[11px] text-fg-subtle">{dateTime(s.at)}</p>}
                        </div>
                    </li>
                ))}
            </ol>
            <dl className="mt-4 space-y-1.5 border-t border-graphite-700 pt-3 text-sm">
                <div className="flex justify-between">
                    <dt className="text-fg-muted">Deposit {p.depositPaid ? 'paid' : 'due'}</dt>
                    <dd className="font-mono tabular">{money(p.depositCents - p.creditCents, currency)}</dd>
                </div>
                {p.creditCents > 0 && (
                    <div className="flex justify-between">
                        <dt className="text-fg-muted">Promise credit applied</dt>
                        <dd className="font-mono tabular">{money(p.creditCents, currency)}</dd>
                    </div>
                )}
                <div className="flex justify-between">
                    <dt className="text-fg-muted">Balance {p.balancePaid ? 'paid' : 'due before shipping'}</dt>
                    <dd className="font-mono tabular" data-testid="supplier-balance">
                        {money(p.balanceCents, currency)}
                    </dd>
                </div>
            </dl>
            {balanceDue && (
                <div className="mt-4 space-y-2">
                    {p.balancePayUrl ? (
                        <Notice tone="info" title="Your parts passed inspection">
                            Pay the balance and we ship them right away.
                        </Notice>
                    ) : null}
                    <Button onClick={payBalance} loading={busy} disabled={!p.balancePayUrl} className="w-full sm:w-auto" data-testid="pay-balance">
                        <CreditCard className="h-4 w-4" aria-hidden />
                        {p.balancePayUrl ? `Pay balance · ${money(p.balanceCents, currency)}` : 'Balance due once your parts pass inspection'}
                    </Button>
                    {error && (
                        <p className="text-xs text-ember" role="alert">
                            {error}
                        </p>
                    )}
                </div>
            )}
        </section>
    );
}
