'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { ChevronDown, LogOut, RefreshCw, Search } from 'lucide-react';
import type { AdminOrderRow, OrderStatus } from '@/contracts';
import { Button, ButtonLink } from '@/components/ui/button';
import { ConfirmAction } from '@/components/ui/confirm-action';
import { Field, TextInput } from '@/components/ui/field';
import { StatusPill } from '@/components/ui/status-pill';
import { EmptyState, ErrorState, Notice } from '@/components/ui/state';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiClientError, api, errorMessage } from '@/lib/api';
import { sourcingApi } from '@/components/sourcing/api';
import { PrimeQueueLink } from '@/components/prime/admin-prime';
import { dateTime, money } from '@/lib/format';
import { cn } from '@/lib/utils';

const KEY = 'dm.adminToken';
const FILTERS: { label: string; statuses?: OrderStatus[] }[] = [
    { label: 'Needs attention', statuses: ['PAID', 'DISPATCHED', 'QA_FAILED', 'SHIPPED'] },
    { label: 'In production', statuses: ['ACCEPTED', 'IN_PRODUCTION', 'QA_PASSED'] },
    { label: 'All' },
];

function readToken(): string | null {
    try {
        return window.sessionStorage.getItem(KEY);
    } catch {
        return null;
    }
}

/** Ops board: admin token lives in sessionStorage only (cleared when the tab closes). */
export function OpsBoard() {
    const [token, setToken] = useState<string | null>(null);
    const [ready, setReady] = useState(false);
    useEffect(() => {
        setToken(readToken());
        setReady(true);
    }, []);
    if (!ready) return null;
    if (!token) return <AdminLogin onToken={(t) => setToken(t)} />;
    return (
        <Board
            token={token}
            onSignOut={() => {
                try {
                    window.sessionStorage.removeItem(KEY);
                } catch {
                    /* ignore */
                }
                setToken(null);
            }}
        />
    );
}

function AdminLogin({ onToken }: { onToken: (t: string) => void }) {
    const [value, setValue] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const submit = async (e: FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            await api.adminOrders(value.trim(), ['PAID']);
            try {
                window.sessionStorage.setItem(KEY, value.trim());
            } catch {
                /* session-only fallback: keep it in memory */
            }
            onToken(value.trim());
        } catch (err) {
            setError(err instanceof ApiClientError && (err.status === 401 || err.status === 403) ? 'That admin token was not accepted.' : errorMessage(err));
        } finally {
            setBusy(false);
        }
    };
    return (
        <div className="mx-auto w-full max-w-md px-4 py-16 sm:px-6">
            <p className="eyebrow">Operations</p>
            <h1 className="mt-2 font-display font-wide text-3xl font-extrabold">Ops board</h1>
            <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
                <Field label="Admin token" error={error} hint="Kept in this tab only and cleared when you close it.">
                    {({ id, describedBy, invalid }) => (
                        <TextInput id={id} type="password" className="font-mono" value={value} onChange={(e) => setValue(e.target.value)} aria-describedby={describedBy} aria-invalid={invalid} data-testid="admin-token-input" />
                    )}
                </Field>
                <Button type="submit" className="w-full" loading={busy} disabled={!value.trim()} data-testid="admin-login-submit">
                    Open ops board
                </Button>
            </form>
        </div>
    );
}

function Board({ token, onSignOut }: { token: string; onSignOut: () => void }) {
    const [filter, setFilter] = useState(0);
    const [open, setOpen] = useState<string | null>(null);
    const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
    const qc = useQueryClient();
    const statuses = FILTERS[filter].statuses;
    const list = useQuery({ queryKey: ['admin-orders', token, filter], queryFn: () => api.adminOrders(token, statuses), refetchInterval: 10_000 });

    const expire = async () => {
        try {
            const r = await api.adminExpireOffers(token);
            setNotice({ tone: 'success', text: `${r.expired} stale ${r.expired === 1 ? 'offer' : 'offers'} expired and re-dispatched.` });
            void qc.invalidateQueries({ queryKey: ['admin-orders'] });
        } catch (err) {
            setNotice({ tone: 'error', text: errorMessage(err) });
        }
    };

    if (list.error instanceof ApiClientError && list.error.status === 401) {
        return <ErrorState title="Admin token rejected" message="Sign in again with a valid token." action={<Button onClick={onSignOut}>Sign in again</Button>} />;
    }

    return (
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <p className="eyebrow">Operations</p>
                    <h1 className="mt-1 font-display font-wide text-3xl font-extrabold">Orders</h1>
                </div>
                <div className="flex flex-wrap gap-2">
                    <SourcingDeskLink token={token} />
                    <PrimeQueueLink token={token} />
                    <ConfirmAction label="Expire stale offers" confirmLabel="Expire now" prompt="Expire offers past their deadline and re-dispatch?" variant="secondary" size="sm" onConfirm={expire} />
                    <Button variant="ghost" size="sm" onClick={() => list.refetch()} aria-label="Refresh">
                        <RefreshCw className={cn('h-4 w-4', list.isFetching && 'animate-spin')} aria-hidden />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={onSignOut}>
                        <LogOut className="h-4 w-4" aria-hidden /> Sign out
                    </Button>
                </div>
            </div>
            {notice && (
                <Notice tone={notice.tone} className="mt-4">
                    {notice.text}
                </Notice>
            )}
            <div className="mt-6 flex gap-1 rounded-xl bg-graphite-900 p-1 ring-1 ring-graphite-700" role="tablist" aria-label="Order filter">
                {FILTERS.map((f, i) => (
                    <button key={f.label} type="button" role="tab" aria-selected={i === filter} onClick={() => setFilter(i)} className={cn('h-9 flex-1 rounded-lg text-sm font-semibold', i === filter ? 'bg-graphite-700 text-fg' : 'text-fg-muted hover:text-fg')}>
                        {f.label}
                    </button>
                ))}
            </div>
            <div className="mt-4">
                {list.isLoading ? (
                    <div className="space-y-2">
                        <Skeleton className="h-16" />
                        <Skeleton className="h-16" />
                    </div>
                ) : list.error ? (
                    <Notice tone="error">{errorMessage(list.error)}</Notice>
                ) : list.data && list.data.orders.length === 0 ? (
                    <EmptyState title="No orders here">Orders show up as soon as they are created.</EmptyState>
                ) : (
                    <ul className="divide-y divide-graphite-700 overflow-hidden rounded-2xl bg-graphite-900 ring-1 ring-graphite-700">
                        {list.data?.orders.map((o) => (
                            <OrderRow key={o.id} token={token} order={o} open={open === o.id} onToggle={() => setOpen(open === o.id ? null : o.id)} onNotice={setNotice} />
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}

/** Link to the R2 sourcing desk with the pending-approval count (hidden if the count cannot be loaded). */
function SourcingDeskLink({ token }: { token: string }) {
    const pending = useQuery({ queryKey: ['sourcing-approvals', token, 'PENDING'], queryFn: () => sourcingApi.adminApprovals(token, 'PENDING'), refetchInterval: 30_000, retry: false });
    const count = pending.data?.length ?? 0;
    return (
        <ButtonLink href="/admin/sourcing" variant="secondary" size="sm" data-testid="ops-sourcing-link">
            <Search className="h-4 w-4" aria-hidden /> Sourcing desk
            {count > 0 && (
                <span className="rounded-full bg-amber/20 px-1.5 text-[11px] font-bold text-amber" aria-label={`${count} approvals pending`}>
                    {count}
                </span>
            )}
        </ButtonLink>
    );
}

/** Orders a refund can still apply to (state machine: any time after payment, before shipping). */
const REFUNDABLE: ReadonlySet<OrderStatus> = new Set(['PAID', 'DISPATCHED', 'ACCEPTED', 'IN_PRODUCTION', 'QA_FAILED', 'QA_PASSED']);

function OrderRow({ token, order, open, onToggle, onNotice }: { token: string; order: AdminOrderRow; open: boolean; onToggle: () => void; onNotice: (n: { tone: 'success' | 'error'; text: string }) => void }) {
    const qc = useQueryClient();
    const detail = useQuery({ queryKey: ['admin-order', order.id], queryFn: () => api.adminOrder(token, order.id), enabled: open });
    const [refundReason, setRefundReason] = useState('');
    const [payoutRefs, setPayoutRefs] = useState<Record<string, string>>({});
    const refresh = () => {
        void qc.invalidateQueries({ queryKey: ['admin-orders'] });
        void qc.invalidateQueries({ queryKey: ['admin-order', order.id] });
    };
    const act = async (fn: () => Promise<string>) => {
        try {
            onNotice({ tone: 'success', text: await fn() });
            refresh();
        } catch (err) {
            onNotice({ tone: 'error', text: errorMessage(err) });
        }
    };
    return (
        <li>
            <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-graphite-850" data-testid={`admin-order-${order.orderNumber}`}>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-semibold">{order.orderNumber}</span>
                        <StatusPill status={order.universalStatus} />
                        <span className="font-mono text-[11px] text-fg-subtle">{order.status}</span>
                    </div>
                    <p className="truncate text-xs text-fg-muted">
                        {order.buyerEmail} · {order.shopName ?? 'no shop yet'} · {dateTime(order.createdAt)}
                    </p>
                </div>
                <span className="font-mono text-sm tabular">{money(order.totalCents, order.currency)}</span>
                <ChevronDown className={cn('h-4 w-4 text-fg-subtle transition-transform', open && 'rotate-180')} aria-hidden />
            </button>
            {open && (
                <div className="space-y-4 border-t border-graphite-700 bg-graphite-850 px-4 py-4">
                    <div className="flex flex-wrap gap-2">
                        {order.status === 'PAID' && (
                            <ConfirmAction
                                label="Dispatch to a shop"
                                confirmLabel="Dispatch"
                                prompt="Offer this order to the best matching shop?"
                                size="sm"
                                onConfirm={() => act(async () => {
                                    const r = await api.adminDispatch(token, order.id);
                                    return r.jobId ? `Offered to ${r.shopId}.` : 'No eligible shop right now; the order stays PAID.';
                                })}
                                testId="admin-dispatch"
                            />
                        )}
                        {order.status === 'SHIPPED' && (
                            <ConfirmAction
                                label="Mark delivered"
                                confirmLabel="Mark delivered"
                                prompt="Confirm the carrier delivered this order? This activates the passport and records payouts."
                                size="sm"
                                onConfirm={() => act(async () => {
                                    await api.adminMarkOrderDelivered(token, order.id);
                                    return `${order.orderNumber} marked delivered.`;
                                })}
                                testId="admin-mark-delivered"
                            />
                        )}
                    </div>
                    {REFUNDABLE.has(order.status) && (
                        <div className="flex flex-wrap items-end gap-2">
                            <Field label="Refund reason" className="min-w-[16rem] flex-1">
                                {({ id }) => <TextInput id={id} value={refundReason} placeholder="Buyer cancelled before production" onChange={(e) => setRefundReason(e.target.value)} data-testid="admin-refund-reason" />}
                            </Field>
                            <ConfirmAction
                                label="Refund in full"
                                confirmLabel="Refund now"
                                prompt="Refund the buyer in full, withdraw the job from the shop and reverse the ledger? This cannot be undone."
                                variant="secondary"
                                size="sm"
                                onConfirm={() => act(async () => {
                                    if (refundReason.trim().length < 3) throw new Error('Enter a refund reason (3+ characters).');
                                    await api.adminRefund(token, order.id, { reason: refundReason.trim() });
                                    return `${order.orderNumber} refunded.`;
                                })}
                                testId="admin-refund"
                            />
                        </div>
                    )}
                    {detail.isLoading && <Skeleton className="h-24" />}
                    {detail.data && (
                        <div className="grid gap-4 text-xs md:grid-cols-2">
                            <div>
                                <p className="eyebrow mb-2">Status history</p>
                                <ol className="space-y-1">
                                    {detail.data.statusHistory.map((h, i) => (
                                        <li key={i} className="font-mono text-fg-muted">
                                            {dateTime(h.at)} · {h.from ?? '∅'} → <span className="text-fg">{h.to}</span> · {h.actorId}
                                            {h.reason ? ` · ${h.reason}` : ''}
                                        </li>
                                    ))}
                                </ol>
                                <p className="eyebrow mb-2 mt-4">Jobs</p>
                                <ul className="space-y-1 font-mono text-fg-muted">
                                    {detail.data.jobs.map((j) => (
                                        <li key={j.id}>
                                            {j.id} · {j.shopId} · <span className="text-fg">{j.status}</span>
                                            {j.isRework ? ' · rework' : ''}
                                        </li>
                                    ))}
                                    {detail.data.jobs.length === 0 && <li>None</li>}
                                </ul>
                            </div>
                            <div>
                                <p className="eyebrow mb-2">Ledger</p>
                                <table className="w-full font-mono">
                                    <tbody>
                                        {detail.data.ledger.map((l, i) => (
                                            <tr key={i} className="border-t border-graphite-700">
                                                <td className="py-1 pr-2 text-fg-subtle">{l.txnKey.split(':')[0]}</td>
                                                <td className="py-1 pr-2 text-fg">{l.account}</td>
                                                <td className="py-1 pr-2 text-fg-muted">{l.direction}</td>
                                                <td className="py-1 text-right tabular text-fg">{money(l.amountCents, order.currency)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                <p className="eyebrow mb-2 mt-4">Payouts</p>
                                <ul className="space-y-1 font-mono text-fg-muted">
                                    {detail.data.payouts.map((p) => (
                                        <li key={p.id} className="space-y-1">
                                            <div>
                                                {p.shopId} · {money(p.amountCents, order.currency)} · {p.method} · <span className="text-fg">{p.status}</span>
                                            </div>
                                            {p.status === 'PENDING' && p.method === 'manual' && (
                                                <div className="flex flex-wrap items-center gap-2 font-sans">
                                                    <TextInput
                                                        aria-label={`Payment reference for payout ${p.id}`}
                                                        className="h-9 max-w-[14rem] text-xs"
                                                        placeholder="ACH / check reference"
                                                        value={payoutRefs[p.id] ?? ''}
                                                        onChange={(e) => setPayoutRefs((r) => ({ ...r, [p.id]: e.target.value }))}
                                                        data-testid={`admin-payout-ref-${p.id}`}
                                                    />
                                                    <ConfirmAction
                                                        label="Mark paid"
                                                        confirmLabel="Confirm paid"
                                                        prompt="Record that this shop payout was sent?"
                                                        variant="secondary"
                                                        size="sm"
                                                        onConfirm={() => act(async () => {
                                                            const ref = (payoutRefs[p.id] ?? '').trim();
                                                            if (!ref) throw new Error('Enter the payment reference first.');
                                                            await api.adminMarkPayoutPaid(token, p.id, { reference: ref });
                                                            return 'Payout marked paid.';
                                                        })}
                                                        testId={`admin-payout-paid-${p.id}`}
                                                    />
                                                </div>
                                            )}
                                        </li>
                                    ))}
                                    {detail.data.payouts.length === 0 && <li>None yet</li>}
                                </ul>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </li>
    );
}
