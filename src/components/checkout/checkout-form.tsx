'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Globe2, Lock, Truck } from 'lucide-react';
import { CheckoutRequest, type CheckoutResponse, type QuoteView, type ShippingMethod } from '@/contracts';
import { Button, ButtonLink } from '@/components/ui/button';
import { Field, SelectInput, TextArea, TextInput } from '@/components/ui/field';
import { InfoTip } from '@/components/ui/info-tip';
import { ErrorState, Notice } from '@/components/ui/state';
import { PageSkeleton } from '@/components/ui/skeleton';
import { FlatPattern } from '@/components/part/part-preview';
import { api, ApiClientError, errorMessage } from '@/lib/api';
import { money, shortDate } from '@/lib/format';
import { rememberOrder } from '@/lib/recent-orders';
import { US_STATES } from '@/lib/us-states';
import { cn } from '@/lib/utils';
import { DevPaymentPanel } from './dev-payment-panel';
import { primeApi } from '@/components/prime/api';
import { AddressWarnings } from '@/components/prime/address-warnings';
import { PrimeCheckoutCard } from '@/components/prime/prime-checkout-card';
import { RouteCard } from './route-card';

type FormState = {
    email: string;
    name: string;
    phone: string;
    company: string;
    line1: string;
    line2: string;
    city: string;
    region: string;
    postalCode: string;
    notes: string;
    acceptTerms: boolean;
    shippingMethod: ShippingMethod | null;
};

type FieldKey = keyof FormState;

const EMPTY: FormState = { email: '', name: '', phone: '', company: '', line1: '', line2: '', city: '', region: '', postalCode: '', notes: '', acceptTerms: false, shippingMethod: null };

/** zod issue path -> form field. */
function fieldFor(path: (string | number)[]): FieldKey | null {
    const [a, b] = path;
    if (a === 'buyer') return b === 'email' ? 'email' : b === 'name' ? 'name' : b === 'phone' ? 'phone' : null;
    if (a === 'shippingAddress') {
        if (b === 'name') return 'name';
        return (['company', 'line1', 'line2', 'city', 'region', 'postalCode', 'phone'] as const).find((k) => k === b) ?? null;
    }
    if (a === 'acceptTerms') return 'acceptTerms';
    if (a === 'shippingMethod') return 'shippingMethod';
    if (a === 'notes') return 'notes';
    return null;
}

const FRIENDLY: Partial<Record<FieldKey, string>> = {
    email: 'Enter a valid email so we can send your order link.',
    name: 'Enter your full name.',
    line1: 'Enter a street address.',
    city: 'Enter a city.',
    region: 'Choose a state.',
    postalCode: 'Enter a 5-digit ZIP code.',
    acceptTerms: 'Please accept the terms to place the order.',
    shippingMethod: 'Choose a shipping method.',
};

function buildRequest(quoteId: string, f: FormState) {
    const opt = (v: string) => (v.trim() ? v.trim() : undefined);
    return {
        quoteId,
        shippingMethod: f.shippingMethod,
        buyer: { email: f.email, name: f.name, phone: opt(f.phone) },
        shippingAddress: {
            name: f.name,
            company: opt(f.company),
            line1: f.line1,
            line2: opt(f.line2),
            city: f.city,
            region: f.region,
            postalCode: f.postalCode,
            country: 'US' as const,
            phone: opt(f.phone),
        },
        acceptTerms: f.acceptTerms,
        notes: opt(f.notes),
    };
}

export function CheckoutForm({ quoteId, cancelled }: { quoteId: string; cancelled: boolean }) {
    const quoteQuery = useQuery({ queryKey: ['quote', quoteId], queryFn: () => api.getQuote(quoteId) });
    const quote = quoteQuery.data;
    const partQuery = useQuery({ queryKey: ['part', quote?.partId], queryFn: () => api.getPart(quote!.partId), enabled: Boolean(quote) });

    if (quoteQuery.isLoading) return <PageSkeleton label="Loading checkout" />;
    if (quoteQuery.error || !quote) {
        const notFound = quoteQuery.error instanceof ApiClientError && quoteQuery.error.status === 404;
        return (
            <ErrorState
                title={notFound ? 'Quote not found' : 'Could not load checkout'}
                message={notFound ? 'This checkout link does not match a quote. Configure your part again to get a fresh price.' : errorMessage(quoteQuery.error)}
                action={<ButtonLink href="/make">Upload a part</ButtonLink>}
            />
        );
    }
    if (!quote.orderable) return <NotOrderable quote={quote} />;
    return <CheckoutBody quote={quote} preview={partQuery.data?.preview ?? null} cancelled={cancelled} />;
}

function NotOrderable({ quote }: { quote: QuoteView }) {
    const copy: Record<string, { title: string; body: string }> = {
        ORDERED: { title: 'This quote was already ordered', body: 'Each quote can be ordered once. Start a new order with the same configuration below.' },
        EXPIRED: { title: 'This quote has expired', body: 'Prices are held for a limited time. Get a fresh binding price with the same configuration.' },
        REVIEW: { title: 'This quote needs shop review', body: 'It cannot be paid for yet. Adjust the configuration for an instant binding quote.' },
        NEEDS_INPUT: { title: 'This part has issues to fix', body: 'Resolve the manufacturability issues before checkout.' },
    };
    const c = copy[quote.status] ?? copy.EXPIRED;
    return <ErrorState title={c.title} message={c.body} action={<ButtonLink href={`/parts/${quote.partId}?from=${quote.id}`}>Get a fresh quote</ButtonLink>} />;
}

function CheckoutBody({ quote, preview, cancelled }: { quote: QuoteView; preview: import('@/contracts').PartPreview | null; cancelled: boolean }) {
    const defaultMethod = quote.shippingOptions.find((o) => o.method === 'STANDARD')?.method ?? quote.shippingOptions[0].method;
    const [form, setForm] = useState<FormState>({ ...EMPTY, shippingMethod: defaultMethod });
    const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
    const [submitted, setSubmitted] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [serverError, setServerError] = useState<string | null>(null);
    const [order, setOrder] = useState<CheckoutResponse | null>(null);
    const errorSummaryRef = useRef<HTMLDivElement>(null);

    const selected = quote.shippingOptions.find((o) => o.method === form.shippingMethod) ?? null;
    // R3: server preview with Prime benefits (display only; checkout re-prices from the snapshot).
    const previewQuery = useQuery({
        queryKey: ['checkout-preview', quote.id, form.shippingMethod],
        queryFn: () => primeApi.checkoutPreview(quote.id, form.shippingMethod!),
        enabled: Boolean(form.shippingMethod),
        retry: false,
    });
    const serverPreview = previewQuery.data && previewQuery.data.totals ? previewQuery.data : null;
    const shippingCents = serverPreview ? serverPreview.totals.shippingCents : (selected?.priceCents ?? 0);
    const primeDiscountCents = serverPreview ? serverPreview.originalTotals.subtotalCents - serverPreview.totals.subtotalCents : 0;
    const totalCents = serverPreview ? serverPreview.totals.totalCents : quote.subtotalCents + shippingCents; // display only; the server prices from the quote snapshot
    const [payBy, setPayBy] = useState<'card' | 'invoice'>('card');
    const [netDays, setNetDays] = useState<15 | 30>(30);
    const freight = /^freight/i.test(quote.shippingOptions.find((o) => o.method === 'STANDARD')?.label ?? '');
    const supplier = quote.routeKind === 'supplier' ? (quote.supplierRoute ?? null) : null;
    const depositCents = supplier ? Math.min(totalCents, Math.ceil(totalCents * supplier.depositPct)) : totalCents;

    const errors = useMemo(() => {
        const parsed = CheckoutRequest.safeParse(buildRequest(quote.id, form));
        const out: Partial<Record<FieldKey, string>> = {};
        if (!parsed.success) {
            for (const issue of parsed.error.issues) {
                const k = fieldFor(issue.path);
                if (k && !out[k]) out[k] = FRIENDLY[k] ?? issue.message;
            }
        }
        return out;
    }, [form, quote.id]);

    const show = (k: FieldKey) => ((submitted || touched[k]) && errors[k]) || null;
    const set = <K extends FieldKey>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
    const blur = (k: FieldKey) => () => setTouched((t) => ({ ...t, [k]: true }));

    const onSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setSubmitted(true);
        setServerError(null);
        const parsed = CheckoutRequest.safeParse(buildRequest(quote.id, form));
        if (!parsed.success) {
            requestAnimationFrame(() => errorSummaryRef.current?.focus());
            return;
        }
        if (payBy === 'invoice' && !supplier && !form.company.trim()) {
            setServerError('Pay by invoice is for business buyers: enter your company name.');
            return;
        }
        setSubmitting(true);
        try {
            if (payBy === 'invoice' && !supplier) {
                const inv = await primeApi.invoiceCheckout({ ...parsed.data, shippingAddress: { ...parsed.data.shippingAddress, company: form.company.trim() }, netDays });
                for (const o of inv.orders) rememberOrder({ orderId: o.orderId, orderNumber: o.orderNumber, url: o.orderUrl, createdAt: new Date().toISOString() });
                window.location.assign(inv.confirmationUrl);
                return;
            }
            const res = await api.checkout(parsed.data);
            rememberOrder({ orderId: res.orderId, orderNumber: res.orderNumber, url: res.orderUrl, createdAt: new Date().toISOString() });
            if (res.payment.provider === 'stripe') {
                window.location.assign(res.payment.redirectUrl);
                return;
            }
            setOrder(res);
        } catch (err) {
            setServerError(errorMessage(err));
        } finally {
            setSubmitting(false);
        }
    };

    const errorCount = Object.keys(errors).length;
    const s = quote.summary;

    return (
        <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6">
            <Link href={`/parts/${quote.partId}?from=${quote.id}`} className="inline-flex items-center gap-1 rounded text-sm text-fg-muted hover:text-fg">
                <ArrowLeft className="h-4 w-4" aria-hidden /> Back to configuration
            </Link>
            <p className="eyebrow mt-4">Step 4 of 4 · Approve and pay</p>
            <h1 className="mt-1 font-display font-wide text-3xl font-extrabold">Checkout</h1>

            {cancelled && (
                <Notice tone="warning" className="mt-4" title="Payment was cancelled">
                    Nothing was charged. Your price is held until {shortDate(quote.validUntil)}.
                </Notice>
            )}

            <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_400px]">
                <form onSubmit={onSubmit} noValidate className="space-y-8" aria-describedby={serverError ? 'checkout-server-error' : undefined}>
                    {submitted && errorCount > 0 && (
                        <div ref={errorSummaryRef} tabIndex={-1} className="rounded-xl bg-ember/10 p-4 text-sm ring-1 ring-inset ring-ember/40" role="alert">
                            <p className="font-semibold text-fg">Check {errorCount === 1 ? '1 field' : `${errorCount} fields`} before paying</p>
                            <ul className="mt-1 list-disc pl-5 text-fg-muted">
                                {Object.entries(errors).map(([k, v]) => (
                                    <li key={k}>{v}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <fieldset disabled={Boolean(order)} className="space-y-4">
                        <legend className="font-display text-xl font-bold">Contact</legend>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Field label="Email" error={show('email')} hint="Your order link and receipts go here.">
                                {({ id, describedBy, invalid }) => (
                                    <TextInput id={id} type="email" autoComplete="email" inputMode="email" value={form.email} onChange={(e) => set('email', e.target.value)} onBlur={blur('email')} aria-describedby={describedBy} aria-invalid={invalid} data-testid="checkout-email" />
                                )}
                            </Field>
                            <Field label="Full name" error={show('name')}>
                                {({ id, describedBy, invalid }) => (
                                    <TextInput id={id} autoComplete="name" value={form.name} onChange={(e) => set('name', e.target.value)} onBlur={blur('name')} aria-describedby={describedBy} aria-invalid={invalid} data-testid="checkout-name" />
                                )}
                            </Field>
                            <Field label="Phone" optional error={show('phone')} hint="Only used by the carrier for delivery questions.">
                                {({ id, describedBy, invalid }) => (
                                    <TextInput id={id} type="tel" autoComplete="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} onBlur={blur('phone')} aria-describedby={describedBy} aria-invalid={invalid} data-testid="checkout-phone" />
                                )}
                            </Field>
                            <Field label="Company" optional error={show('company')}>
                                {({ id, describedBy, invalid }) => (
                                    <TextInput id={id} autoComplete="organization" value={form.company} onChange={(e) => set('company', e.target.value)} aria-describedby={describedBy} aria-invalid={invalid} data-testid="checkout-company" />
                                )}
                            </Field>
                        </div>
                    </fieldset>

                    <fieldset disabled={Boolean(order)} className="space-y-4">
                        <legend className="font-display text-xl font-bold">Shipping address</legend>
                        <p className="-mt-2 text-sm text-fg-subtle">We ship to addresses in the United States.</p>
                        <Field label="Street address" error={show('line1')}>
                            {({ id, describedBy, invalid }) => (
                                <TextInput id={id} autoComplete="address-line1" value={form.line1} onChange={(e) => set('line1', e.target.value)} onBlur={blur('line1')} aria-describedby={describedBy} aria-invalid={invalid} data-testid="checkout-line1" />
                            )}
                        </Field>
                        <Field label="Apartment, suite, unit" optional error={show('line2')}>
                            {({ id, describedBy, invalid }) => (
                                <TextInput id={id} autoComplete="address-line2" value={form.line2} onChange={(e) => set('line2', e.target.value)} aria-describedby={describedBy} aria-invalid={invalid} data-testid="checkout-line2" />
                            )}
                        </Field>
                        <div className="grid gap-4 sm:grid-cols-[1.4fr_1fr_1fr]">
                            <Field label="City" error={show('city')}>
                                {({ id, describedBy, invalid }) => (
                                    <TextInput id={id} autoComplete="address-level2" value={form.city} onChange={(e) => set('city', e.target.value)} onBlur={blur('city')} aria-describedby={describedBy} aria-invalid={invalid} data-testid="checkout-city" />
                                )}
                            </Field>
                            <Field label="State" error={show('region')}>
                                {({ id, describedBy, invalid }) => (
                                    <SelectInput id={id} autoComplete="address-level1" value={form.region} onChange={(e) => set('region', e.target.value)} onBlur={blur('region')} aria-describedby={describedBy} aria-invalid={invalid} data-testid="checkout-region">
                                        <option value="">Select</option>
                                        {US_STATES.map(([code, name]) => (
                                            <option key={code} value={code}>
                                                {name}
                                            </option>
                                        ))}
                                    </SelectInput>
                                )}
                            </Field>
                            <Field label="ZIP code" error={show('postalCode')}>
                                {({ id, describedBy, invalid }) => (
                                    <TextInput id={id} autoComplete="postal-code" inputMode="numeric" value={form.postalCode} onChange={(e) => set('postalCode', e.target.value)} onBlur={blur('postalCode')} aria-describedby={describedBy} aria-invalid={invalid} data-testid="checkout-postal" />
                                )}
                            </Field>
                        </div>
                        <AddressWarnings
                            address={{ name: form.name, company: form.company || undefined, line1: form.line1, line2: form.line2 || undefined, city: form.city, region: form.region, postalCode: form.postalCode }}
                            freight={freight}
                            onUseSuggestion={(a) => setForm((f) => ({ ...f, line1: a.line1, line2: a.line2 ?? '', city: a.city, region: a.region, postalCode: a.postalCode }))}
                        />
                    </fieldset>

                    <fieldset disabled={Boolean(order)}>
                        <legend className="font-display text-xl font-bold">Shipping method</legend>
                        <p className="mt-1 text-sm text-fg-subtle">
                            {supplier
                                ? `Made by a ${supplier.label.toLowerCase()}${supplier.receivingPartner ? `, inspected in ${supplier.receivingPartner.city}, ${supplier.receivingPartner.region}` : ''} before it ships to you.`
                                : quote.promise
                                  ? `Ships from ${quote.route.city}, ${quote.route.region}. A date is shown only when we can stand behind it.`
                                  : `Ships from ${quote.route.city}, ${quote.route.region} by ${shortDate(quote.shipDate)}. Dates are delivery estimates.`}
                        </p>
                        <div className="mt-4 grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Shipping method">
                            {quote.shippingOptions.map((o) => {
                                const checked = form.shippingMethod === o.method;
                                return (
                                    <label
                                        key={o.method}
                                        className={cn(
                                            'flex cursor-pointer flex-col rounded-xl p-3.5 ring-1 ring-inset transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-signal',
                                            checked ? 'bg-graphite-800 ring-signal' : 'ring-graphite-700 hover:bg-graphite-850',
                                        )}
                                        data-testid={`shipping-option-${o.method}`}
                                        data-checked={checked || undefined}
                                    >
                                        <input type="radio" name="shippingMethod" value={o.method} checked={checked} onChange={() => set('shippingMethod', o.method)} className="sr-only" />
                                        <span className="flex items-center justify-between gap-2">
                                            <span className="font-semibold text-fg">{o.method === 'STANDARD' ? 'Standard' : o.method === 'EXPEDITED' ? 'Expedited' : 'Express'}</span>
                                            <span className="font-mono text-sm tabular text-fg">{money(o.priceCents, quote.currency)}</span>
                                        </span>
                                        <span className="mt-1 text-sm text-signal" data-testid={`shipping-option-date-${o.method}`}>
                                            {arrivalText(quote, o)}
                                        </span>
                                        <span className="mt-0.5 text-xs text-fg-subtle">{o.label}</span>
                                    </label>
                                );
                            })}
                        </div>
                        {show('shippingMethod') && <p className="mt-2 text-xs font-medium text-ember">{show('shippingMethod')}</p>}
                    </fieldset>

                    <fieldset disabled={Boolean(order)} className="space-y-4">
                        <legend className="font-display text-xl font-bold">Note for the shop</legend>
                        <Field label="Notes" optional error={show('notes')} hint="Packing or labelling requests. Design changes need a new quote.">
                            {({ id, describedBy, invalid }) => (
                                <TextArea id={id} maxLength={1000} value={form.notes} onChange={(e) => set('notes', e.target.value)} aria-describedby={describedBy} aria-invalid={invalid} data-testid="checkout-notes" />
                            )}
                        </Field>
                        <div>
                            <label className="flex cursor-pointer items-start gap-3 rounded-xl p-1 text-sm">
                                <input
                                    type="checkbox"
                                    className="mt-0.5 h-5 w-5 shrink-0 accent-[#5fe08a]"
                                    checked={form.acceptTerms}
                                    onChange={(e) => set('acceptTerms', e.target.checked)}
                                    aria-invalid={Boolean(show('acceptTerms'))}
                                    aria-describedby={show('acceptTerms') ? 'terms-err' : undefined}
                                    data-testid="checkout-terms"
                                />
                                <span className="text-fg-muted">
                                    I approve this design version and configuration for production, and accept the Terms, Production Policy and Quality Guarantee. Parts are made to my drawing; production starts once payment is confirmed.
                                </span>
                            </label>
                            {show('acceptTerms') && (
                                <p id="terms-err" className="mt-1 pl-9 text-xs font-medium text-ember" role="alert">
                                    {show('acceptTerms')}
                                </p>
                            )}
                        </div>
                    </fieldset>

                    {!supplier && (<fieldset disabled={Boolean(order)}>
                        <legend className="font-display text-xl font-bold">Payment</legend>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Payment method">
                            {(
                                [
                                    ['card', 'Card, bank or wallet', 'Pay now with Stripe. Production starts once payment is confirmed.'],
                                    ['invoice', 'Pay by invoice (ACH / wire)', 'For businesses: net 15 or 30 by bank transfer. Production starts when the invoice is paid.'],
                                ] as const
                            ).map(([key, label, hint]) => (
                                <label
                                    key={key}
                                    className={cn(
                                        'flex cursor-pointer flex-col rounded-xl p-3.5 ring-1 ring-inset focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-signal',
                                        payBy === key ? 'bg-graphite-800 ring-signal' : 'ring-graphite-700 hover:bg-graphite-850',
                                    )}
                                    data-testid={`pay-by-${key}`}
                                >
                                    <input type="radio" name="payBy" value={key} checked={payBy === key} onChange={() => setPayBy(key)} className="sr-only" />
                                    <span className="font-semibold text-fg">{label}</span>
                                    <span className="mt-0.5 text-xs text-fg-subtle">{hint}</span>
                                </label>
                            ))}
                        </div>
                        {payBy === 'invoice' && (
                            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                                <span className="text-fg-muted">Terms</span>
                                {([15, 30] as const).map((d) => (
                                    <label key={d} className="inline-flex items-center gap-1.5">
                                        <input type="radio" name="netDays" checked={netDays === d} onChange={() => setNetDays(d)} className="accent-[#5fe08a]" />
                                        Net {d}
                                    </label>
                                ))}
                                {!form.company.trim() && <span className="text-xs text-amber">Enter your company name above.</span>}
                            </div>
                        )}
                    </fieldset>)}

                    <PrimeCheckoutCard preview={serverPreview} currency={quote.currency} />

                    {serverError && (
                        <Notice tone="error" title="We could not place the order" testId="checkout-error">
                            <span id="checkout-server-error">{serverError}</span>
                        </Notice>
                    )}

                    {order ? (
                        <div className="space-y-3">
                            <Notice tone="success" title={`Order ${order.orderNumber} created`}>
                                Waiting for payment. Your price is locked at {money(order.totals.totalCents, order.totals.currency)}.
                                {order.payment.purpose === 'deposit' && order.balanceDueCents != null && ` Due now: ${money(order.payment.amountCents ?? order.totals.totalCents, order.totals.currency)} deposit; ${money(order.balanceDueCents, order.totals.currency)} before shipping.`}
                                {order.creditAppliedCents ? ` A ${money(order.creditAppliedCents, order.totals.currency)} delivery-promise credit was applied.` : ''}
                            </Notice>
                            <DevPaymentPanel providerRef={order.payment.providerRef} amountLabel={money(order.payment.amountCents ?? order.totals.totalCents, order.totals.currency)} />
                        </div>
                    ) : (
                        <div className="sticky bottom-0 z-20 -mx-4 border-t border-graphite-700 bg-graphite-950/95 p-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
                            <Button type="submit" size="lg" className="w-full" loading={submitting} data-testid="pay-cta">
                                <Lock className="h-4 w-4" aria-hidden />
                                {supplier
                                    ? `Pay ${money(depositCents, quote.currency)} deposit and place the order`
                                    : payBy === 'invoice'
                                      ? `Place order · invoice ${money(totalCents, quote.currency)}`
                                      : `Pay ${money(totalCents, quote.currency)} and start production`}
                            </Button>
                            <p className="mt-2 hidden text-center text-xs text-fg-subtle sm:block">The amount is set by the server from your binding quote and the shipping method you chose.</p>
                        </div>
                    )}
                </form>

                <OrderSummary
                    quote={quote}
                    preview={preview}
                    shippingCents={selected ? shippingCents : null}
                    shippingLabel={selected?.label ?? null}
                    totalCents={totalCents}
                    primeDiscountCents={primeDiscountCents}
                    depositCents={supplier ? depositCents : null}
                    arrival={selected ? arrivalText(quote, selected) : null}
                />
            </div>
            <p className="sr-only" aria-live="polite">
                {s.quantity} parts, {s.materialName}, total {money(totalCents, quote.currency)}
            </p>
        </div>
    );
}

function OrderSummary({
    quote,
    preview,
    shippingCents,
    shippingLabel,
    totalCents,
    primeDiscountCents = 0,
    depositCents,
    arrival,
}: {
    quote: QuoteView;
    preview: import('@/contracts').PartPreview | null;
    shippingCents: number | null;
    shippingLabel: string | null;
    totalCents: number;
    primeDiscountCents?: number;
    /** Supplier route: what is charged today (the rest is due before shipping). */
    depositCents: number | null;
    arrival: string | null;
}) {
    const s = quote.summary;
    return (
        <aside aria-labelledby="summary-heading" className="space-y-4 lg:sticky lg:top-20 lg:self-start">
            <section className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700 sm:p-5">
                <h2 id="summary-heading" className="font-display text-lg font-bold">
                    Order summary
                </h2>
                <div className="mt-4 flex gap-3">
                    <div className="h-20 w-20 shrink-0 rounded-xl bg-graphite-850 p-2 ring-1 ring-graphite-700">{preview ? <FlatPattern preview={preview} /> : null}</div>
                    <div className="min-w-0 text-sm">
                        <p className="truncate font-semibold text-fg">{s.partFilename}</p>
                        <p className="text-fg-muted">
                            {s.materialName} · {s.thicknessLabel}
                        </p>
                        <p className="text-fg-muted">{[s.finishName ?? 'As cut', ...s.serviceNames].join(' · ')}</p>
                        <p className="font-mono text-xs text-fg-subtle">
                            {s.bboxWidthMm.toFixed(1)} × {s.bboxHeightMm.toFixed(1)} mm · design v{quote.designVersion}
                        </p>
                    </div>
                </div>
                <dl className="mt-4 space-y-2 border-t border-graphite-700 pt-4 text-sm">
                    <div className="flex items-center justify-between">
                        <dt className="flex items-center text-fg-muted">
                            {s.quantity} × {money(quote.unitPriceCents, quote.currency)}
                            <InfoTip label="parts price" text="Binding price from your instant quote. It covers material, cutting, any finishing and operations you chose, inspection and packaging." />
                        </dt>
                        <dd className="font-mono tabular">{money(quote.subtotalCents, quote.currency)}</dd>
                    </div>
                    {quote.lineItems
                        .filter((li) => li.code === 'PLATFORM_FEE' || li.code === 'MINIMUM_ORDER')
                        .map((li) => (
                            <div key={li.code} className="flex items-center justify-between pl-3 text-xs">
                                <dt className="flex items-center text-fg-subtle">
                                    incl. {li.label}
                                    <InfoTip label={li.label} text={li.explainer} />
                                </dt>
                                <dd className="font-mono tabular text-fg-subtle">{money(li.totalCents, quote.currency)}</dd>
                            </div>
                        ))}
                    {primeDiscountCents > 0 && (
                        <div className="flex items-center justify-between" data-testid="checkout-prime-discount">
                            <dt className="flex items-center text-fg-muted">
                                Prime material pricing
                                <InfoTip label="Prime material pricing" text="Members get a share of our pooled material pricing on the material line, never below what the shop is paid." />
                            </dt>
                            <dd className="font-mono tabular text-signal">−{money(primeDiscountCents, quote.currency)}</dd>
                        </div>
                    )}
                    <div className="flex items-center justify-between">
                        <dt className="flex items-center text-fg-muted">
                            Shipping
                            <InfoTip label="shipping" text={shippingLabel ? `${shippingLabel}. Shipping prices are locked with your quote.` : 'Choose a shipping method. Prices are locked with your quote.'} />
                        </dt>
                        <dd className="font-mono tabular" data-testid="checkout-shipping">{shippingCents == null ? '—' : shippingCents === 0 ? 'Free' : money(shippingCents, quote.currency)}</dd>
                    </div>
                    <div className="flex items-center justify-between">
                        <dt className="flex items-center text-fg-muted">
                            Sales tax
                            <InfoTip label="sales tax" text="No sales tax is added to this order." />
                        </dt>
                        <dd className="font-mono tabular">{money(0, quote.currency)}</dd>
                    </div>
                    <div className="flex items-center justify-between border-t border-graphite-700 pt-3 text-base font-bold">
                        <dt>Total</dt>
                        <dd className="font-mono tabular" data-testid="checkout-total">
                            {money(totalCents, quote.currency)}
                        </dd>
                    </div>
                    {depositCents != null && (
                        <>
                            <div className="flex items-center justify-between text-sm" data-testid="checkout-deposit">
                                <dt className="flex items-center text-fg-muted">
                                    Due today (deposit)
                                    <InfoTip label="deposit" text="Supplier-made orders are paid in two parts: a deposit now, so we can place the purchase order, and the balance once your parts pass inspection and are ready to ship." />
                                </dt>
                                <dd className="font-mono tabular">{money(depositCents, quote.currency)}</dd>
                            </div>
                            <div className="flex items-center justify-between text-sm" data-testid="checkout-balance">
                                <dt className="text-fg-muted">Due before shipping</dt>
                                <dd className="font-mono tabular">{money(totalCents - depositCents, quote.currency)}</dd>
                            </div>
                        </>
                    )}
                </dl>
                <p className="mt-3 flex items-center gap-1.5 text-xs text-fg-subtle">
                    <Truck className="h-3.5 w-3.5" aria-hidden /> {arrival && /^Arrives/.test(arrival) ? `${arrival} · inspected before it ships` : `Ships by ${shortDate(quote.shipDate)} · inspected before it leaves the shop`}
                </p>
            </section>
            {quote.supplierRoute ? <SupplierRouteSummary route={quote.supplierRoute} /> : <RouteCard route={quote.route} compact />}
        </aside>
    );
}

/**
 * Delivery Promise (R3): "Arrives <date>" only when the engine's P90 fits inside the committed date;
 * otherwise the ship-date language. Quotes from before R3 carry no promise and keep their estimate.
 */
export function arrivalText(quote: QuoteView, option: QuoteView['shippingOptions'][number]): string {
    if (!quote.promise) return `Arrives ${shortDate(option.deliveryDate)}`;
    const p = quote.promise.find((x) => x.method === option.method);
    return p?.show ? `Arrives ${shortDate(p.date)}` : `Ships by ${shortDate(quote.shipDate)}`;
}

function SupplierRouteSummary({ route }: { route: NonNullable<QuoteView['supplierRoute']> }) {
    return (
        <div className="flex gap-3 rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700" data-testid="supplier-route-card">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-graphite-750 text-fg" aria-hidden>
                <Globe2 className="h-6 w-6" />
            </span>
            <div className="min-w-0 text-sm">
                <p className="font-semibold text-fg">{route.label}</p>
                <p className="text-fg-muted">
                    {route.receivingPartner ? `Inspected by ${route.receivingPartner.name} in ${route.receivingPartner.city}, ${route.receivingPartner.region}` : 'Inspected before it ships'}
                </p>
            </div>
        </div>
    );
}
