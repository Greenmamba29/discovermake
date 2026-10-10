'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, MessageCircle, PauseCircle, Receipt, Star } from 'lucide-react';
import { RATING_TAG_LABELS } from '@/contracts/prime';
import { Button, ButtonLink } from '@/components/ui/button';
import { Field, TextInput } from '@/components/ui/field';
import { EmptyState, ErrorState, Notice } from '@/components/ui/state';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiClientError, errorMessage } from '@/lib/api';
import { dateTime, humanize, money, shortDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { primeApi } from './api';
import { OrderChat } from './order-chat';

const KEY = 'dm.adminToken';

function readToken(): string | null {
    try {
        return window.sessionStorage.getItem(KEY);
    } catch {
        return null;
    }
}

/** Ops board link with the R3 queue size (ratings to moderate + open holds). */
export function PrimeQueueLink({ token }: { token: string }) {
    const q = useQuery({ queryKey: ['admin-prime', token], queryFn: () => primeApi.adminQueue(token), refetchInterval: 30_000, retry: false });
    const n = (q.data?.ratings.length ?? 0) + (q.data?.holds.length ?? 0);
    return (
        <ButtonLink href="/admin/prime" variant="secondary" size="sm" data-testid="ops-prime-link">
            <Star className="h-4 w-4" aria-hidden /> Moderation &amp; holds
            {n > 0 && (
                <span className="rounded-full bg-amber/20 px-1.5 text-[11px] font-bold text-amber" aria-label={`${n} items waiting`}>
                    {n}
                </span>
            )}
        </ButtonLink>
    );
}

/** /admin/prime — ops queue for R3: rating moderation, hold requests, order chats, B2B invoices. */
export function AdminPrime() {
    const [token, setToken] = useState<string | null>(null);
    const [ready, setReady] = useState(false);
    const [value, setValue] = useState('');
    useEffect(() => {
        setToken(readToken());
        setReady(true);
    }, []);
    if (!ready) return null;
    if (!token) {
        const submit = (e: FormEvent) => {
            e.preventDefault();
            try {
                window.sessionStorage.setItem(KEY, value.trim());
            } catch {
                /* memory only */
            }
            setToken(value.trim());
        };
        return (
            <div className="mx-auto w-full max-w-md px-4 py-16 sm:px-6">
                <p className="eyebrow">Operations</p>
                <h1 className="mt-2 font-display font-wide text-3xl font-extrabold">Moderation queue</h1>
                <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
                    <Field label="Admin token" hint="Kept in this tab only.">
                        {({ id, describedBy }) => <TextInput id={id} type="password" className="font-mono" value={value} onChange={(e) => setValue(e.target.value)} aria-describedby={describedBy} data-testid="prime-admin-token-input" />}
                    </Field>
                    <Button type="submit" className="w-full" disabled={!value.trim()} data-testid="prime-admin-login-submit">
                        Open queue
                    </Button>
                </form>
            </div>
        );
    }
    return <Queue token={token} />;
}

function Queue({ token }: { token: string }) {
    const qc = useQueryClient();
    const q = useQuery({ queryKey: ['admin-prime', token], queryFn: () => primeApi.adminQueue(token), refetchInterval: 10_000 });
    const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
    const [openChat, setOpenChat] = useState<string | null>(null);
    const [wireRefs, setWireRefs] = useState<Record<string, string>>({});
    const act = async (fn: () => Promise<string>) => {
        try {
            setNotice({ tone: 'success', text: await fn() });
            void qc.invalidateQueries({ queryKey: ['admin-prime'] });
        } catch (err) {
            setNotice({ tone: 'error', text: errorMessage(err) });
        }
    };
    if (q.error instanceof ApiClientError && q.error.status === 401) return <ErrorState title="Admin token rejected" message="Sign in again from the ops board." action={<ButtonLink href="/admin">Ops board</ButtonLink>} />;
    const d = q.data;
    return (
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
            <Link href="/admin" className="inline-flex items-center gap-1 rounded text-sm text-fg-muted hover:text-fg">
                <ArrowLeft className="h-4 w-4" aria-hidden /> Ops board
            </Link>
            <p className="eyebrow mt-4">Operations · Prime</p>
            <h1 className="mt-1 font-display font-wide text-3xl font-extrabold">Moderation queue</h1>
            {notice && (
                <Notice tone={notice.tone} className="mt-4" testId="prime-admin-notice">
                    {notice.text}
                </Notice>
            )}
            {!d ? (
                <div className="mt-6 space-y-2">
                    <Skeleton className="h-24" />
                    <Skeleton className="h-24" />
                </div>
            ) : (
                <div className="mt-6 grid gap-6 lg:grid-cols-2">
                    <section aria-labelledby="ratings-heading" className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700 sm:p-5" data-testid="moderation-queue">
                        <h2 id="ratings-heading" className="flex items-center gap-2 font-display text-lg font-bold">
                            <Star className="h-5 w-5 text-signal" aria-hidden /> Ratings to review <span className="font-mono text-sm text-fg-subtle">{d.ratings.length}</span>
                        </h2>
                        {d.ratings.length === 0 ? (
                            <p className="mt-3 text-sm text-fg-subtle">Nothing to review.</p>
                        ) : (
                            <ul className="mt-3 divide-y divide-graphite-700">
                                {d.ratings.map((r) => (
                                    <li key={r.id} className="py-3" data-testid={`moderation-item-${r.orderNumber}`}>
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <span className="font-mono text-sm font-semibold">{r.orderNumber}</span>
                                            <span className="text-xs text-fg-subtle">
                                                {r.shopName} · {r.buyerName} · {dateTime(r.createdAt)}
                                            </span>
                                        </div>
                                        <p className="mt-1 flex items-center gap-0.5" aria-label={`${r.stars} out of 5 stars`}>
                                            {[1, 2, 3, 4, 5].map((n) => (
                                                <Star key={n} className={cn('h-4 w-4', n <= r.stars ? 'fill-signal text-signal' : 'text-graphite-600')} aria-hidden />
                                            ))}
                                            <span className="ml-2 text-xs text-fg-muted">{r.tags.map((t) => RATING_TAG_LABELS[t]).join(' · ')}</span>
                                        </p>
                                        {r.caption && <p className="mt-1 text-sm text-fg">{r.caption}</p>}
                                        {r.photoUrl && (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={r.photoUrl} alt={`Buyer photo for ${r.orderNumber}`} className="mt-2 max-h-40 rounded-lg" />
                                        )}
                                        <div className="mt-2 flex gap-2">
                                            <Button size="sm" onClick={() => act(async () => (await primeApi.adminModerate(token, r.id, 'approve'), `Rating for ${r.orderNumber} approved.`))} data-testid={`moderate-approve-${r.orderNumber}`}>
                                                Approve
                                            </Button>
                                            <Button size="sm" variant="secondary" onClick={() => act(async () => (await primeApi.adminModerate(token, r.id, 'reject', 'Does not meet the community guidelines'), `Rating for ${r.orderNumber} rejected.`))} data-testid={`moderate-reject-${r.orderNumber}`}>
                                                Reject
                                            </Button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>

                    <section aria-labelledby="holds-heading" className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700 sm:p-5">
                        <h2 id="holds-heading" className="flex items-center gap-2 font-display text-lg font-bold">
                            <PauseCircle className="h-5 w-5 text-amber" aria-hidden /> Hold requests <span className="font-mono text-sm text-fg-subtle">{d.holds.length}</span>
                        </h2>
                        {d.holds.length === 0 ? (
                            <p className="mt-3 text-sm text-fg-subtle">No open hold requests. Jobs keep running until a hold is confirmed here.</p>
                        ) : (
                            <ul className="mt-3 divide-y divide-graphite-700">
                                {d.holds.map((h) => (
                                    <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                                        <span>
                                            <span className="block font-mono text-sm font-semibold">{h.orderNumber}</span>
                                            <span className="block text-xs text-fg-subtle">
                                                {humanize(h.orderStatus)} · {h.shopName ?? 'no shop'} · {dateTime(h.requestedAt)}
                                            </span>
                                        </span>
                                        <span className="flex gap-2">
                                            <Button size="sm" onClick={() => act(async () => (await primeApi.adminResolveHold(token, h.id, 'acknowledge'), `Hold on ${h.orderNumber} confirmed.`))} data-testid={`hold-ack-${h.orderNumber}`}>
                                                Confirm hold
                                            </Button>
                                            <Button size="sm" variant="secondary" onClick={() => act(async () => (await primeApi.adminResolveHold(token, h.id, 'decline'), `Hold on ${h.orderNumber} declined.`))}>
                                                Decline
                                            </Button>
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>

                    <section aria-labelledby="chats-heading" className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700 sm:p-5">
                        <h2 id="chats-heading" className="flex items-center gap-2 font-display text-lg font-bold">
                            <MessageCircle className="h-5 w-5 text-signal" aria-hidden /> Order chats
                        </h2>
                        {d.chats.length === 0 ? (
                            <EmptyState title="No conversations yet" />
                        ) : (
                            <ul className="mt-3 divide-y divide-graphite-700">
                                {d.chats.map((c) => (
                                    <li key={c.orderId} className="py-2">
                                        <button type="button" onClick={() => setOpenChat(openChat === c.orderId ? null : c.orderId)} aria-expanded={openChat === c.orderId} className="flex w-full items-center gap-3 rounded-lg px-1 py-1 text-left hover:bg-graphite-850">
                                            <span className="min-w-0 flex-1">
                                                <span className="block font-mono text-sm font-semibold">{c.orderNumber}</span>
                                                <span className="block truncate text-xs text-fg-muted">{c.preview}</span>
                                            </span>
                                            {c.unread > 0 && <span className="rounded-full bg-signal px-2 py-0.5 font-mono text-xs font-bold text-signal-ink">{c.unread}</span>}
                                        </button>
                                        {openChat === c.orderId && (
                                            <div className="mt-2">
                                                <OrderChat
                                                    title={`Chat · ${c.orderNumber}`}
                                                    intro="You are replying as DiscoverMake support."
                                                    adapter={{ key: ['admin-chat', c.orderId], load: () => primeApi.adminChat(token, c.orderId), post: (body) => primeApi.adminPostChat(token, c.orderId, body) }}
                                                />
                                            </div>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>

                    <section aria-labelledby="invoices-heading" className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700 sm:p-5">
                        <h2 id="invoices-heading" className="flex items-center gap-2 font-display text-lg font-bold">
                            <Receipt className="h-5 w-5 text-signal" aria-hidden /> B2B invoices
                        </h2>
                        {d.invoices.length === 0 ? (
                            <p className="mt-3 text-sm text-fg-subtle">No invoices yet.</p>
                        ) : (
                            <ul className="mt-3 divide-y divide-graphite-700">
                                {d.invoices.map((inv) => (
                                    <li key={inv.id} className="py-3">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <span className="text-sm font-semibold">{inv.company}</span>
                                            <span className="font-mono text-sm tabular">{money(inv.amountCents, inv.currency)}</span>
                                        </div>
                                        <p className="text-xs text-fg-subtle">
                                            {humanize(inv.status)} · net {inv.netDays}, due {shortDate(inv.dueDate)} · {inv.orderNumbers.join(', ')}
                                            {inv.paidReference ? ` · ref ${inv.paidReference}` : ''}
                                        </p>
                                        {(inv.status === 'open' || inv.status === 'overdue') && (
                                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                                <TextInput aria-label={`Wire reference for invoice ${inv.id}`} className="h-9 max-w-[14rem] text-xs" placeholder="Bank / wire reference" value={wireRefs[inv.id] ?? ''} onChange={(e) => setWireRefs((r) => ({ ...r, [inv.id]: e.target.value }))} />
                                                <Button
                                                    size="sm"
                                                    variant="secondary"
                                                    onClick={() =>
                                                        act(async () => {
                                                            const ref = (wireRefs[inv.id] ?? '').trim();
                                                            if (ref.length < 3) throw new Error('Enter the bank reference first.');
                                                            await primeApi.adminMarkWire(token, inv.id, ref);
                                                            return 'Wire recorded; the orders are paid and production is authorized.';
                                                        })
                                                    }
                                                >
                                                    Mark wire received
                                                </Button>
                                            </div>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                </div>
            )}
        </div>
    );
}
