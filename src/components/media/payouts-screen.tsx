'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Banknote, Landmark } from 'lucide-react';
import type { CreatorEarningView } from '@/contracts/media';
import { Button, buttonClass } from '@/components/ui/button';
import { Notice } from '@/components/ui/state';
import { PageSkeleton } from '@/components/ui/skeleton';
import { ApiClientError, errorMessage } from '@/lib/api';
import { money, shortDate } from '@/lib/format';
import { mediaApi } from './media-api';
import { StudioNav } from './studio-nav';

const EARNING_LABEL: Record<CreatorEarningView['kind'], string> = {
    REMIX_ROYALTY: 'Remix royalty',
    MAKE_THIS_ROYALTY: 'Make This royalty',
    DROP_REVENUE: 'Build Slot revenue',
    AUCTION_REVENUE: 'Auction revenue',
    ROYALTY_REVERSAL: 'Royalty reversed (refund)',
    REVENUE_REVERSAL: 'Revenue reversed (refund)',
};

/** `/studio/payouts`: creator balance, earnings ledger and payouts (Stripe Connect, or manual by ops). */
export function PayoutsScreen() {
    const payouts = useQuery({ queryKey: ['media-payouts'], queryFn: () => mediaApi.payouts(), retry: false });
    const [busy, setBusy] = useState<'payout' | 'connect' | null>(null);
    const [message, setMessage] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);

    if (payouts.error instanceof ApiClientError && payouts.error.status === 401) {
        return (
            <div className="mx-auto w-full max-w-xl px-4 py-16 text-center sm:px-6">
                <h1 className="font-display font-wide text-3xl font-extrabold">Sign in to see your payouts</h1>
                <Link href="/signin?next=/studio/payouts" className={buttonClass('primary', 'md', 'mt-6')}>
                    Sign in
                </Link>
            </div>
        );
    }
    const data = payouts.data;
    const payout = async () => {
        setBusy('payout');
        setMessage(null);
        try {
            const p = await mediaApi.requestPayout();
            setMessage({ tone: 'success', text: p.status === 'PAID' ? `Paid ${money(p.amountCents, p.currency)} to your Stripe account.` : `Payout of ${money(p.amountCents, p.currency)} requested. ${p.method === 'manual' ? 'Our team sends it and marks it paid.' : 'The transfer is on its way.'}` });
            await payouts.refetch();
        } catch (err) {
            setMessage({ tone: 'error', text: errorMessage(err) });
        } finally {
            setBusy(null);
        }
    };
    const connect = async () => {
        setBusy('connect');
        setMessage(null);
        try {
            const { url } = await mediaApi.connect();
            window.location.assign(url);
        } catch (err) {
            setMessage({ tone: 'error', text: errorMessage(err) });
            setBusy(null);
        }
    };

    return (
        <div className="mx-auto w-full max-w-4xl px-4 pb-16 pt-6 sm:px-6" data-testid="payouts-screen">
            <p className="eyebrow">Creator Studio</p>
            <h1 className="mt-1 font-display font-wide text-3xl font-extrabold">Payouts</h1>
            <div className="mt-4">
                <StudioNav />
            </div>
            {payouts.isLoading || !data ? (
                payouts.error ? (
                    <Notice tone="error" className="mt-4">
                        {errorMessage(payouts.error)}
                    </Notice>
                ) : (
                    <PageSkeleton label="Loading your balance" />
                )
            ) : (
                <>
                    <section aria-labelledby="balance-heading" className="mt-6 rounded-2xl bg-graphite-900 p-5 ring-1 ring-graphite-700" data-testid="creator-balance">
                        <h2 id="balance-heading" className="text-sm font-medium text-fg-muted">
                            Available balance
                        </h2>
                        <p className="mt-1 font-display text-4xl font-extrabold tabular" data-testid="balance-available" data-cents={data.balance.availableCents}>
                            {money(data.balance.availableCents, data.balance.currency)}
                        </p>
                        <p className="mt-1 text-sm text-fg-muted">
                            {money(data.balance.lifetimeEarnedCents, data.balance.currency)} earned · {money(data.balance.paidOutCents, data.balance.currency)} paid out · {money(data.balance.inTransitCents, data.balance.currency)} on the way
                        </p>
                        <div className="mt-4 flex flex-wrap gap-2">
                            <Button onClick={payout} loading={busy === 'payout'} disabled={data.balance.availableCents < data.minimumPayoutCents} data-testid="request-payout">
                                <Banknote className="h-4 w-4" aria-hidden /> Pay out {money(Math.max(0, data.balance.availableCents), data.balance.currency)}
                            </Button>
                            {data.connect.stripeConfigured && !data.connect.payoutsEnabled && (
                                <Button variant="secondary" onClick={connect} loading={busy === 'connect'} data-testid="connect-stripe">
                                    <Landmark className="h-4 w-4" aria-hidden /> {data.connect.connected ? 'Finish payout setup' : 'Set up Stripe payouts'}
                                </Button>
                            )}
                        </div>
                        <p className="mt-3 text-xs text-fg-subtle" data-testid="payout-method">
                            {data.connect.payoutsEnabled
                                ? 'Payouts go to your Stripe account by transfer.'
                                : data.connect.stripeConfigured
                                  ? 'Set up Stripe payouts to be paid by transfer. Until then our team pays you by hand.'
                                  : 'Payouts are sent by our team and marked paid here (Stripe payouts are not set up on this site).'}{' '}
                            Minimum payout {money(data.minimumPayoutCents)}.
                        </p>
                        {message && (
                            <Notice tone={message.tone} className="mt-3" testId="payout-message">
                                {message.text}
                            </Notice>
                        )}
                    </section>

                    <section aria-labelledby="payout-list-heading" className="mt-6">
                        <h2 id="payout-list-heading" className="font-display text-lg font-bold">
                            Payouts
                        </h2>
                        {data.payouts.length === 0 ? (
                            <p className="mt-2 text-sm text-fg-muted">No payouts yet.</p>
                        ) : (
                            <ul className="mt-3 divide-y divide-graphite-800 rounded-2xl bg-graphite-900 ring-1 ring-graphite-700">
                                {data.payouts.map((p) => (
                                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm" data-testid="payout-row" data-status={p.status}>
                                        <span>
                                            <span className="font-semibold tabular">{money(p.amountCents, p.currency)}</span>
                                            <span className="text-fg-muted"> · {p.method === 'manual' ? 'manual' : 'Stripe transfer'} · {shortDate(p.createdAt)}</span>
                                        </span>
                                        <span className="text-xs font-semibold">{p.status === 'PAID' ? `Paid ${shortDate(p.paidAt)}` : p.status === 'PENDING' ? 'On the way' : p.status.toLowerCase()}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>

                    <section aria-labelledby="earnings-list-heading" className="mt-6">
                        <h2 id="earnings-list-heading" className="font-display text-lg font-bold">
                            Earnings
                        </h2>
                        {data.earnings.length === 0 ? (
                            <p className="mt-2 text-sm text-fg-muted">Royalties appear here when someone orders a remix or copy of your published builds, and Build Slot revenue when your drops sell.</p>
                        ) : (
                            <ul className="mt-3 divide-y divide-graphite-800 rounded-2xl bg-graphite-900 ring-1 ring-graphite-700">
                                {data.earnings.map((e) => (
                                    <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm" data-testid="earning-row" data-kind={e.kind}>
                                        <span>
                                            <span className="font-semibold">{EARNING_LABEL[e.kind]}</span>
                                            <span className="text-fg-muted">
                                                {' '}
                                                · {e.buildTitle} · {e.orderNumber}
                                            </span>
                                        </span>
                                        <span className={e.amountCents < 0 ? 'font-semibold tabular text-ember' : 'font-semibold tabular text-signal'}>{money(e.amountCents, e.currency)}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                </>
            )}
        </div>
    );
}
