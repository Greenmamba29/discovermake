'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { Lock, ShoppingBag, Trash2 } from 'lucide-react';
import type { ShippingMethod } from '@/contracts/enums';
import { CartCheckoutRequest, type CartItemView, type CartView } from '@/contracts/prime';
import { Button, ButtonLink } from '@/components/ui/button';
import { Field, SelectInput, TextInput } from '@/components/ui/field';
import { InfoTip } from '@/components/ui/info-tip';
import { EmptyState, ErrorState, Notice } from '@/components/ui/state';
import { PageSkeleton } from '@/components/ui/skeleton';
import { FlatPattern } from '@/components/part/part-preview';
import { useMe } from '@/components/site/use-account';
import { errorMessage } from '@/lib/api';
import { money, plural, shortDate } from '@/lib/format';
import { rememberOrder } from '@/lib/recent-orders';
import { US_STATES } from '@/lib/us-states';
import { cn } from '@/lib/utils';
import { AddressWarnings } from './address-warnings';
import { announceCartChange, primeApi } from './api';
import { UpsellRow } from './complete-your-build';
import { PrimeCheckoutCard } from './prime-checkout-card';

const METHODS: { key: ShippingMethod; label: string }[] = [
    { key: 'STANDARD', label: 'Standard' },
    { key: 'EXPEDITED', label: 'Expedited' },
    { key: 'EXPRESS', label: 'Express' },
];

function ItemUpsells({ item }: { item: CartItemView }) {
    const offers = useQuery({ queryKey: ['upsells', item.quoteId], queryFn: () => primeApi.upsells(item.quoteId), enabled: item.orderable, staleTime: 60_000 });
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const qc = useQueryClient();
    const list = (offers.data?.offers ?? []).filter((o) => !item.upsells.includes(o.kind));
    if (!list.length) return null;
    return (
        <div className="mt-3 rounded-xl bg-graphite-850 px-3 ring-1 ring-graphite-700">
            <p className="pt-3 text-xs font-semibold uppercase tracking-wider text-fg-subtle">Complete your build</p>
            <ul className="divide-y divide-graphite-700">
                {list.map((o) => (
                    <UpsellRow
                        key={o.kind}
                        offer={o}
                        currency={item.currency}
                        busy={busy === o.kind}
                        added={false}
                        onAdd={async () => {
                            setBusy(o.kind);
                            setError(null);
                            try {
                                const cart = await primeApi.applyUpsell(item.id, o.kind);
                                qc.setQueryData(['cart'], cart);
                            } catch (err) {
                                setError(errorMessage(err));
                            } finally {
                                setBusy(null);
                            }
                        }}
                    />
                ))}
            </ul>
            {error && (
                <p className="pb-2 text-xs text-ember" role="alert">
                    {error}
                </p>
            )}
        </div>
    );
}

function CartItem({ item, onRemove }: { item: CartItemView; onRemove: () => void }) {
    const s = item.summary;
    return (
        <li className="py-4" data-testid="cart-item">
            <div className="flex gap-3">
                <div className="h-16 w-16 shrink-0 rounded-xl bg-graphite-850 p-2 ring-1 ring-graphite-700">{item.preview ? <FlatPattern preview={item.preview} /> : null}</div>
                <div className="min-w-0 flex-1 text-sm">
                    <p className="truncate font-semibold text-fg">{s.partFilename}</p>
                    <p className="text-fg-muted">
                        {s.quantity} × {s.materialName} · {s.thicknessLabel}
                    </p>
                    <p className="text-xs text-fg-subtle">{[s.finishName ?? 'As cut', ...s.serviceNames].join(' · ')} · ships by {shortDate(item.shipDate)}</p>
                    {!item.orderable && <p className="mt-1 text-xs font-medium text-amber">This price expired. Remove it and get a fresh quote.</p>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="font-mono text-sm font-semibold tabular">{money(item.subtotalCents, item.currency)}</span>
                    <Button size="sm" variant="ghost" onClick={onRemove} aria-label={`Remove ${s.partFilename}`} data-testid="cart-item-remove">
                        <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                </div>
            </div>
            <ItemUpsells item={item} />
        </li>
    );
}

type Form = { email: string; name: string; company: string; line1: string; line2: string; city: string; region: string; postalCode: string; acceptTerms: boolean };
const EMPTY: Form = { email: '', name: '', company: '', line1: '', line2: '', city: '', region: '', postalCode: '', acceptTerms: false };

/** Build cart: several binding quotes, "Complete your build" upsells, one checkout. */
export function CartScreen({ cancelled }: { cancelled: boolean }) {
    const qc = useQueryClient();
    const cartQuery = useQuery({ queryKey: ['cart'], queryFn: () => primeApi.cart() });
    const me = useMe();
    const [method, setMethod] = useState<ShippingMethod>('STANDARD');
    const [form, setForm] = useState<Form>(EMPTY);
    const [payBy, setPayBy] = useState<'card' | 'invoice'>('card');
    const [netDays, setNetDays] = useState<15 | 30>(30);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const cart = cartQuery.data;
    const previewQuery = useQuery({ queryKey: ['cart-preview', method, cart?.items.map((i) => i.quoteId).join(',')], queryFn: () => primeApi.cartPreview(method), enabled: Boolean(cart?.count), retry: false });

    useEffect(() => {
        const email = me.data?.viewer?.email;
        if (email) setForm((f) => (f.email ? f : { ...f, email }));
    }, [me.data]);

    if (cartQuery.isLoading) return <PageSkeleton label="Loading your build cart" />;
    if (cartQuery.error || !cart) return <ErrorState title="Could not load your cart" message={errorMessage(cartQuery.error)} />;

    const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
    const remove = async (itemId: string) => {
        const next = await primeApi.removeFromCart(itemId);
        qc.setQueryData(['cart'], next);
    };
    const preview = previewQuery.data ?? null;
    const totals = preview?.totals;

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        setError(null);
        const opt = (v: string) => (v.trim() ? v.trim() : undefined);
        const body = {
            shippingMethod: method,
            buyer: { email: form.email.trim(), name: form.name.trim() },
            shippingAddress: { name: form.name.trim(), company: opt(form.company), line1: form.line1.trim(), line2: opt(form.line2), city: form.city.trim(), region: form.region, postalCode: form.postalCode.trim(), country: 'US' as const },
            acceptTerms: form.acceptTerms,
            payment: payBy === 'invoice' ? { mode: 'invoice' as const, netDays } : { mode: 'card' as const },
        };
        const parsed = CartCheckoutRequest.safeParse(body);
        if (!parsed.success) {
            setError(form.acceptTerms ? 'Check your contact and shipping details.' : 'Please accept the terms to place the order.');
            return;
        }
        if (payBy === 'invoice' && !form.company.trim()) {
            setError('Pay by invoice is for business buyers: enter your company name.');
            return;
        }
        setSubmitting(true);
        try {
            const res = await primeApi.cartCheckout(parsed.data);
            for (const o of res.orders) rememberOrder({ orderId: o.orderId, orderNumber: o.orderNumber, url: o.orderUrl, createdAt: new Date().toISOString() });
            announceCartChange({ ...cart, items: [], count: 0, subtotalCents: 0 } satisfies CartView);
            window.location.assign(res.payment.redirectUrl);
        } catch (err) {
            setError(errorMessage(err));
            setSubmitting(false);
        }
    };

    return (
        <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6">
            <p className="eyebrow">Build cart</p>
            <h1 className="mt-1 font-display font-wide text-3xl font-extrabold">Your build cart</h1>
            {cancelled && (
                <Notice tone="warning" className="mt-4" title="Payment was cancelled">
                    Nothing was charged. Your parts are still in the cart.
                </Notice>
            )}
            {cart.count === 0 ? (
                <div className="mt-8">
                    <EmptyState icon={<ShoppingBag className="h-8 w-8" aria-hidden />} title="Your build cart is empty" action={<ButtonLink href="/make">Quote a part</ButtonLink>}>
                        Add parts from their quote with “Add to build cart” to order them together in one checkout.
                    </EmptyState>
                </div>
            ) : (
                <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_400px]">
                    <div className="space-y-6">
                        <section aria-labelledby="cart-items-heading" className="rounded-2xl bg-graphite-900 px-4 ring-1 ring-graphite-700 sm:px-5">
                            <h2 id="cart-items-heading" className="pt-4 font-display text-lg font-bold">
                                {plural(cart.count, 'part')}
                            </h2>
                            <ul className="divide-y divide-graphite-700" data-testid="cart-items">
                                {cart.items.map((i) => (
                                    <CartItem key={i.id} item={i} onRemove={() => void remove(i.id)} />
                                ))}
                            </ul>
                        </section>

                        <form onSubmit={submit} noValidate className="space-y-6" aria-label="Cart checkout">
                            <fieldset className="space-y-4">
                                <legend className="font-display text-xl font-bold">Contact and shipping</legend>
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <Field label="Email">{({ id }) => <TextInput id={id} type="email" autoComplete="email" value={form.email} onChange={(e) => set('email', e.target.value)} data-testid="cart-email" />}</Field>
                                    <Field label="Full name">{({ id }) => <TextInput id={id} autoComplete="name" value={form.name} onChange={(e) => set('name', e.target.value)} data-testid="cart-name" />}</Field>
                                    <Field label="Company" optional hint="Needed to pay by invoice.">
                                        {({ id, describedBy }) => <TextInput id={id} autoComplete="organization" value={form.company} onChange={(e) => set('company', e.target.value)} aria-describedby={describedBy} data-testid="cart-company" />}
                                    </Field>
                                    <Field label="Street address">{({ id }) => <TextInput id={id} autoComplete="address-line1" value={form.line1} onChange={(e) => set('line1', e.target.value)} data-testid="cart-line1" />}</Field>
                                    <Field label="Apartment, suite, unit" optional>
                                        {({ id }) => <TextInput id={id} autoComplete="address-line2" value={form.line2} onChange={(e) => set('line2', e.target.value)} data-testid="cart-line2" />}
                                    </Field>
                                    <Field label="City">{({ id }) => <TextInput id={id} autoComplete="address-level2" value={form.city} onChange={(e) => set('city', e.target.value)} data-testid="cart-city" />}</Field>
                                    <Field label="State">
                                        {({ id }) => (
                                            <SelectInput id={id} autoComplete="address-level1" value={form.region} onChange={(e) => set('region', e.target.value)} data-testid="cart-region">
                                                <option value="">Select</option>
                                                {US_STATES.map(([code, name]) => (
                                                    <option key={code} value={code}>
                                                        {name}
                                                    </option>
                                                ))}
                                            </SelectInput>
                                        )}
                                    </Field>
                                    <Field label="ZIP code">{({ id }) => <TextInput id={id} autoComplete="postal-code" inputMode="numeric" value={form.postalCode} onChange={(e) => set('postalCode', e.target.value)} data-testid="cart-postal" />}</Field>
                                </div>
                                <AddressWarnings
                                    address={{ name: form.name, line1: form.line1, line2: form.line2 || undefined, city: form.city, region: form.region, postalCode: form.postalCode }}
                                    onUseSuggestion={(a) => setForm((f) => ({ ...f, line1: a.line1, line2: a.line2 ?? '', city: a.city, region: a.region, postalCode: a.postalCode }))}
                                />
                            </fieldset>

                            <fieldset>
                                <legend className="font-display text-xl font-bold">Shipping method</legend>
                                <p className="mt-1 text-sm text-fg-subtle">Each part ships from its shop with this method.</p>
                                <div className="mt-3 grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Shipping method">
                                    {METHODS.map((m) => (
                                        <label
                                            key={m.key}
                                            className={cn(
                                                'flex cursor-pointer items-center justify-between rounded-xl p-3.5 ring-1 ring-inset focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-signal',
                                                method === m.key ? 'bg-graphite-800 ring-signal' : 'ring-graphite-700 hover:bg-graphite-850',
                                            )}
                                            data-testid={`cart-shipping-${m.key}`}
                                        >
                                            <input type="radio" name="cartShipping" value={m.key} checked={method === m.key} onChange={() => setMethod(m.key)} className="sr-only" />
                                            <span className="font-semibold">{m.label}</span>
                                        </label>
                                    ))}
                                </div>
                            </fieldset>

                            <fieldset>
                                <legend className="font-display text-xl font-bold">Payment</legend>
                                <div className="mt-3 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Payment method">
                                    {(
                                        [
                                            ['card', 'Card, bank or wallet', 'One payment for every part.'],
                                            ['invoice', 'Pay by invoice (ACH / wire)', 'Business net 15 / 30. Production starts when the invoice is paid.'],
                                        ] as const
                                    ).map(([key, label, hint]) => (
                                        <label
                                            key={key}
                                            className={cn(
                                                'flex cursor-pointer flex-col rounded-xl p-3.5 ring-1 ring-inset focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-signal',
                                                payBy === key ? 'bg-graphite-800 ring-signal' : 'ring-graphite-700 hover:bg-graphite-850',
                                            )}
                                            data-testid={`cart-pay-by-${key}`}
                                        >
                                            <input type="radio" name="cartPayBy" value={key} checked={payBy === key} onChange={() => setPayBy(key)} className="sr-only" />
                                            <span className="font-semibold">{label}</span>
                                            <span className="mt-0.5 text-xs text-fg-subtle">{hint}</span>
                                        </label>
                                    ))}
                                </div>
                                {payBy === 'invoice' && (
                                    <div className="mt-3 flex items-center gap-3 text-sm">
                                        {([15, 30] as const).map((d) => (
                                            <label key={d} className="inline-flex items-center gap-1.5">
                                                <input type="radio" name="cartNet" checked={netDays === d} onChange={() => setNetDays(d)} className="accent-[#5fe08a]" />
                                                Net {d}
                                            </label>
                                        ))}
                                    </div>
                                )}
                            </fieldset>

                            <label className="flex cursor-pointer items-start gap-3 rounded-xl p-1 text-sm">
                                <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[#5fe08a]" checked={form.acceptTerms} onChange={(e) => set('acceptTerms', e.target.checked)} data-testid="cart-terms" />
                                <span className="text-fg-muted">I approve these designs and configurations for production and accept the Terms, Production Policy and Quality Guarantee.</span>
                            </label>

                            {error && (
                                <Notice tone="error" title="We could not place the order" testId="cart-error">
                                    {error}
                                </Notice>
                            )}
                            <Button type="submit" size="lg" className="w-full" loading={submitting} disabled={cart.items.some((i) => !i.orderable)} data-testid="cart-checkout-cta">
                                <Lock className="h-4 w-4" aria-hidden />
                                {totals ? `${payBy === 'invoice' ? 'Place order · invoice' : 'Pay'} ${money(totals.totalCents, totals.currency)} for ${plural(cart.count, 'part')}` : 'Checkout'}
                            </Button>
                        </form>
                    </div>

                    <aside aria-labelledby="cart-summary-heading" className="space-y-4 lg:sticky lg:top-20 lg:self-start">
                        <section className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700 sm:p-5">
                            <h2 id="cart-summary-heading" className="font-display text-lg font-bold">
                                Summary
                            </h2>
                            {totals ? (
                                <dl className="mt-3 space-y-2 text-sm">
                                    <div className="flex justify-between">
                                        <dt className="flex items-center text-fg-muted">
                                            Parts
                                            <InfoTip label="parts" text="The sum of each part's binding instant quote." />
                                        </dt>
                                        <dd className="font-mono tabular">{money(preview!.originalTotals.subtotalCents, totals.currency)}</dd>
                                    </div>
                                    {preview!.originalTotals.subtotalCents > totals.subtotalCents && (
                                        <div className="flex justify-between">
                                            <dt className="text-fg-muted">Prime material pricing</dt>
                                            <dd className="font-mono tabular text-signal">−{money(preview!.originalTotals.subtotalCents - totals.subtotalCents, totals.currency)}</dd>
                                        </div>
                                    )}
                                    <div className="flex justify-between">
                                        <dt className="flex items-center text-fg-muted">
                                            Shipping
                                            <InfoTip label="shipping" text="Each part ships from its shop; prices are locked with each quote." />
                                        </dt>
                                        <dd className="font-mono tabular" data-testid="cart-shipping-total">
                                            {totals.shippingCents === 0 ? 'Free' : money(totals.shippingCents, totals.currency)}
                                        </dd>
                                    </div>
                                    <div className="flex justify-between border-t border-graphite-700 pt-2 text-base font-bold">
                                        <dt>Total</dt>
                                        <dd className="font-mono tabular" data-testid="cart-total">
                                            {money(totals.totalCents, totals.currency)}
                                        </dd>
                                    </div>
                                </dl>
                            ) : previewQuery.error ? (
                                <p className="mt-3 text-sm text-amber">{errorMessage(previewQuery.error)}</p>
                            ) : (
                                <p className="mt-3 text-sm text-fg-subtle">Pricing your cart…</p>
                            )}
                        </section>
                        <PrimeCheckoutCard preview={preview} currency={cart.currency} />
                        <p className="text-xs text-fg-subtle">
                            Want just one part? Open it from <Link href="/builds" className="underline">My Builds</Link> and check out on its own.
                        </p>
                    </aside>
                </div>
            )}
        </div>
    );
}
