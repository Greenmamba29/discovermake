'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ChevronRight, FileText, PackageCheck } from 'lucide-react';
import type { InvoiceView } from '@/contracts/prime';
import { ButtonLink } from '@/components/ui/button';
import { ErrorState, Notice } from '@/components/ui/state';
import { PageSkeleton } from '@/components/ui/skeleton';
import { apiFetch, errorMessage } from '@/lib/api';
import { humanize, money, shortDate } from '@/lib/format';

type GroupView = {
    checkoutId: string;
    status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
    mode: 'card' | 'invoice';
    totalCents: number;
    currency: string;
    orders: { orderId: string; orderNumber: string; status: string; totalCents: number; currency: string; orderUrl: string | null }[];
    invoice: InvoiceView | null;
};

/** Signed confirmation for one cart checkout (/cart/done/:id?t=...): every order with its tracker link. */
export function CartDone({ checkoutId, token }: { checkoutId: string; token: string | null }) {
    const q = useQuery({
        queryKey: ['cart-checkout', checkoutId, token],
        queryFn: () => apiFetch<GroupView>(`/api/me/cart/checkouts/${encodeURIComponent(checkoutId)}?t=${encodeURIComponent(token ?? '')}`),
        enabled: Boolean(token),
        refetchInterval: (s) => (s.state.data?.status === 'PENDING' && s.state.data.mode === 'card' ? 3000 : false),
    });
    if (!token) return <ErrorState title="This link is incomplete" message="Open the confirmation link from your email." action={<ButtonLink href="/orders">Track an order</ButtonLink>} />;
    if (q.isLoading) return <PageSkeleton label="Loading your orders" />;
    if (q.error || !q.data) return <ErrorState title="We could not open this checkout" message={errorMessage(q.error)} action={<ButtonLink href="/orders">Track an order</ButtonLink>} />;
    const g = q.data;
    const inv = g.invoice;
    return (
        <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6 sm:px-6">
            <p className="eyebrow">Build cart · {g.orders.length} orders</p>
            <h1 className="mt-1 font-display font-wide text-3xl font-extrabold" data-testid="cart-done-title">
                {g.mode === 'invoice' ? 'Invoice sent · orders reserved' : g.status === 'SUCCEEDED' ? 'Paid · production authorized' : g.status === 'FAILED' ? 'Payment did not go through' : 'Waiting for payment'}
            </h1>
            <p className="mt-1 text-lg text-signal">{money(g.totalCents, g.currency)} for every part, in one payment</p>
            {inv && (
                <Notice tone={inv.status === 'paid' ? 'success' : inv.status === 'overdue' ? 'warning' : 'info'} className="mt-4" title={`Invoice ${humanize(inv.status)} · net ${inv.netDays}, due ${shortDate(inv.dueDate)}`} testId="cart-done-invoice">
                    <span className="flex items-center gap-1.5">
                        <FileText className="h-4 w-4" aria-hidden /> Pay by ACH or wire to {inv.company}&apos;s invoice. Production starts as soon as it is paid.
                    </span>
                    {inv.hostedUrl && (
                        <a href={inv.hostedUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block font-semibold text-signal underline">
                            View invoice and bank details<span className="sr-only"> (opens in a new tab)</span>
                        </a>
                    )}
                </Notice>
            )}
            <ul className="mt-6 divide-y divide-graphite-700 overflow-hidden rounded-2xl bg-graphite-900 ring-1 ring-graphite-700">
                {g.orders.map((o) => (
                    <li key={o.orderId}>
                        {o.orderUrl ? (
                            <Link href={new URL(o.orderUrl).pathname + new URL(o.orderUrl).search} className="flex items-center gap-3 px-4 py-4 hover:bg-graphite-850" data-testid={`cart-done-order-${o.orderNumber}`}>
                                <PackageCheck className="h-5 w-5 shrink-0 text-signal" aria-hidden />
                                <span className="min-w-0 flex-1">
                                    <span className="block font-mono text-sm font-semibold">{o.orderNumber}</span>
                                    <span className="block text-xs text-fg-muted">{humanize(o.status)}</span>
                                </span>
                                <span className="font-mono text-sm tabular">{money(o.totalCents, o.currency)}</span>
                                <ChevronRight className="h-4 w-4 text-fg-subtle" aria-hidden />
                            </Link>
                        ) : (
                            <div className="px-4 py-4 font-mono text-sm">{o.orderNumber}</div>
                        )}
                    </li>
                ))}
            </ul>
            <p className="mt-4 text-xs text-fg-subtle">Each part has its own private tracking link. We also emailed them to you.</p>
        </div>
    );
}
