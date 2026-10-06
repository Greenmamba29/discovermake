'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, TextInput } from '@/components/ui/field';
import { parseOrderLink, readRecentOrders, type RecentOrder } from '@/lib/recent-orders';
import { dateTime } from '@/lib/format';

/** Track order: paste the private order link, or reopen an order placed in this browser. */
export function TrackOrder() {
    const router = useRouter();
    const [link, setLink] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [recent, setRecent] = useState<RecentOrder[]>([]);
    useEffect(() => setRecent(readRecentOrders()), []);

    const onSubmit = (e: FormEvent) => {
        e.preventDefault();
        const path = parseOrderLink(link);
        if (!path) {
            setError('Paste the full order link from your confirmation email. It looks like …/orders/ord_…?t=…');
            return;
        }
        router.push(path);
    };

    return (
        <div className="mx-auto w-full max-w-xl px-4 py-12 sm:px-6">
            <p className="eyebrow">Orders</p>
            <h1 className="mt-2 font-display font-wide text-3xl font-extrabold">Track an order</h1>
            <p className="mt-2 text-fg-muted">Every order has a private tracking link. We email it when you check out.</p>
            <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-3" noValidate>
                <Field label="Order link" error={error}>
                    {({ id, describedBy, invalid }) => (
                        <TextInput
                            id={id}
                            value={link}
                            onChange={(e) => {
                                setLink(e.target.value);
                                setError(null);
                            }}
                            placeholder="https://…/orders/ord_…?t=…"
                            aria-describedby={describedBy}
                            aria-invalid={invalid}
                            data-testid="track-order-link"
                        />
                    )}
                </Field>
                <Button type="submit">Open order</Button>
            </form>
            {recent.length > 0 && (
                <section aria-labelledby="recent-heading" className="mt-10">
                    <h2 id="recent-heading" className="eyebrow mb-3">
                        Placed in this browser
                    </h2>
                    <ul className="divide-y divide-graphite-700 overflow-hidden rounded-2xl bg-graphite-900 ring-1 ring-graphite-700">
                        {recent.map((o) => {
                            const path = parseOrderLink(o.url);
                            if (!path) return null;
                            return (
                                <li key={o.orderId}>
                                    <Link href={path} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-graphite-850">
                                        <span>
                                            <span className="block font-mono text-sm font-semibold text-fg">{o.orderNumber}</span>
                                            <span className="block text-xs text-fg-subtle">{dateTime(o.createdAt)}</span>
                                        </span>
                                        <ChevronRight className="h-4 w-4 text-fg-subtle" aria-hidden />
                                    </Link>
                                </li>
                            );
                        })}
                    </ul>
                </section>
            )}
        </div>
    );
}
