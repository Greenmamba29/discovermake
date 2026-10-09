'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, ExternalLink, Loader2, Lock } from 'lucide-react';
import { ClaimSlotsRequest, type ClaimSlotsResponse, type DropQueueResponse, type DropView, type FeaturedProduct, type QuoteView, type ShippingMethod } from '@/contracts';
import { mediaApi } from '@/components/media/media-api';
import { Button, buttonClass } from '@/components/ui/button';
import { Field, SelectInput, TextArea, TextInput } from '@/components/ui/field';
import { QtyStepper } from '@/components/ui/qty-stepper';
import { Notice } from '@/components/ui/state';
import { api, errorMessage } from '@/lib/api';
import { dateTime, money } from '@/lib/format';
import { US_STATES } from '@/lib/us-states';
import { liveApi } from './live-api';
import { Sheet } from './sheet';

// ---------------------------------------------------------------------------
// Make Mine: clone the build (when it has an approved version) + configure overlay
// ---------------------------------------------------------------------------

type CloneState = { status: 'idle' | 'running' | 'done' | 'skipped' | 'error'; buildId?: string; displayId?: string; message?: string };

export function ConfigureSheet({ open, onClose, featured }: { open: boolean; onClose: () => void; featured: FeaturedProduct | null }) {
    const [clone, setClone] = useState<CloneState>({ status: 'idle' });
    const clonedFor = useRef<string | null>(null);

    useEffect(() => {
        if (!open || !featured || clonedFor.current === featured.buildId) return;
        clonedFor.current = featured.buildId;
        if (!featured.hasApprovedVersion) {
            setClone({ status: 'skipped' });
            return;
        }
        setClone({ status: 'running' });
        liveApi
            .clone(featured.buildId)
            .then((r) => setClone({ status: 'done', buildId: r.buildId, displayId: r.displayId }))
            .catch((err) => setClone({ status: 'error', message: errorMessage(err) }));
    }, [open, featured]);

    return (
        <Sheet open={open} onClose={onClose} title={featured ? `Make your ${featured.name}` : 'Make Mine'} testId="configure-sheet">
            {featured && (
                <div className="space-y-4">
                    <p className="text-sm text-fg-muted">Configure your own version while the show keeps playing. Nothing is charged until you check out.</p>
                    {clone.status === 'running' && (
                        <p className="flex items-center gap-2 text-sm text-fg-muted" role="status">
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Copying the Build Graph…
                        </p>
                    )}
                    {clone.status === 'done' && (
                        <Notice tone="success" title={`Your copy ${clone.displayId} is ready`} testId="clone-ready">
                            It is a new build of your own, cloned from the approved version.{' '}
                            <Link href={`/build/${clone.buildId}/workspace`} target="_blank" rel="noopener" className="font-semibold text-fg underline underline-offset-2">
                                Open it in the workspace
                            </Link>
                        </Notice>
                    )}
                    {clone.status === 'error' && <Notice tone="warning" title="We could not copy this build">{clone.message}</Notice>}
                    {featured.partId && featured.quoteId ? (
                        <QuickConfigurator quoteId={featured.quoteId} partId={featured.partId} />
                    ) : featured.partId ? (
                        <Link href={`/parts/${featured.partId}`} target="_blank" rel="noopener" className={buttonClass('secondary', 'md', 'w-full')}>
                            Configure the part <ExternalLink className="h-4 w-4" aria-hidden />
                        </Link>
                    ) : (
                        <p className="text-sm text-fg-muted">This build has no flat pattern to price yet. Continue in your copy&apos;s workspace to generate CAD and get a binding quote.</p>
                    )}
                </div>
            )}
        </Sheet>
    );
}

function QuickConfigurator({ quoteId, partId }: { quoteId: string; partId: string }) {
    const base = useQuery({ queryKey: ['quote', quoteId], queryFn: () => api.getQuote(quoteId) });
    const catalog = useQuery({ queryKey: ['catalog'], queryFn: () => api.catalog() });
    const [materialId, setMaterialId] = useState<string | null>(null);
    const [thicknessId, setThicknessId] = useState<string | null>(null);
    const [quantity, setQuantity] = useState(1);
    const [quote, setQuote] = useState<QuoteView | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (base.data && materialId === null) {
            setMaterialId(base.data.config.materialId);
            setThicknessId(base.data.config.thicknessOptionId);
            setQuantity(base.data.config.quantity);
        }
    }, [base.data, materialId]);

    const material = catalog.data?.materials.find((m) => m.id === materialId) ?? null;
    if (base.isLoading || catalog.isLoading) return <p className="text-sm text-fg-muted">Loading options…</p>;
    if (!base.data || !catalog.data) return <Notice tone="warning">Options could not be loaded. Try again in a moment.</Notice>;

    const getPrice = async () => {
        if (!material || !thicknessId) return;
        setBusy(true);
        setError(null);
        try {
            const c = base.data!.config;
            const compatible = new Set(material.compatibleServiceIds);
            const q = await api.createQuote({
                partId,
                materialId: material.id,
                thicknessOptionId: thicknessId,
                finishServiceId: c.finishServiceId && compatible.has(c.finishServiceId) ? c.finishServiceId : null,
                services: c.services.filter((s) => compatible.has(s.serviceId)),
                quantity,
            });
            setQuote(q);
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-4" data-testid="quick-configurator">
            <Field label="Material">
                {({ id }) => (
                    <SelectInput
                        id={id}
                        value={materialId ?? ''}
                        onChange={(e) => {
                            const m = catalog.data!.materials.find((x) => x.id === e.target.value);
                            setMaterialId(e.target.value);
                            setThicknessId(m?.thicknessOptions[0]?.id ?? null);
                            setQuote(null);
                        }}
                        data-testid="configure-material"
                    >
                        {catalog.data!.materials.map((m) => (
                            <option key={m.id} value={m.id}>
                                {m.name}
                            </option>
                        ))}
                    </SelectInput>
                )}
            </Field>
            <Field label="Thickness">
                {({ id }) => (
                    <SelectInput
                        id={id}
                        value={thicknessId ?? ''}
                        onChange={(e) => {
                            setThicknessId(e.target.value);
                            setQuote(null);
                        }}
                        data-testid="configure-thickness"
                    >
                        {(material?.thicknessOptions ?? []).map((t) => (
                            <option key={t.id} value={t.id}>
                                {t.label}
                            </option>
                        ))}
                    </SelectInput>
                )}
            </Field>
            <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">Quantity</span>
                <QtyStepper
                    value={quantity}
                    onChange={(n) => {
                        setQuantity(n);
                        setQuote(null);
                    }}
                    testId="configure-qty"
                    size="sm"
                />
            </div>
            {error && <Notice tone="error">{error}</Notice>}
            {quote ? (
                <div className="rounded-xl bg-graphite-850 p-3 ring-1 ring-graphite-700" data-testid="configure-price">
                    <p className="text-sm text-fg-muted">
                        {quote.config.quantity} × {money(quote.unitPriceCents, quote.currency)} · ships {quote.shipDate}
                    </p>
                    <p className="font-display text-2xl font-bold tabular">{money(quote.subtotalCents, quote.currency)}</p>
                    {quote.orderable ? (
                        <Link href={`/checkout/${quote.id}`} className={buttonClass('primary', 'md', 'mt-3 w-full')} data-testid="configure-buy">
                            Buy this version
                        </Link>
                    ) : (
                        <p className="mt-2 text-sm text-amber">This configuration needs shop review ({quote.status.toLowerCase()}); pick another option for an instant binding price.</p>
                    )}
                </div>
            ) : (
                <Button className="w-full" onClick={getPrice} loading={busy} data-testid="configure-price-cta">
                    Get my binding price
                </Button>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Remix: text -> existing remix API -> progress -> open result
// ---------------------------------------------------------------------------

export function RemixSheet({ open, onClose, featured }: { open: boolean; onClose: () => void; featured: FeaturedProduct | null }) {
    const [text, setText] = useState('');
    const [step, setStep] = useState(0);
    const [result, setResult] = useState<{ buildId: string; displayId: string } | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) {
            setStep(0);
            setResult(null);
            setError(null);
        }
    }, [open]);

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        if (!featured || text.trim().length < 3) return;
        setError(null);
        setStep(1);
        try {
            const name = `${featured.name} (remix: ${text.trim()})`.slice(0, 120);
            const r = await liveApi.remix(featured.buildId, name);
            setStep(2);
            await new Promise((res) => setTimeout(res, 250));
            setStep(3);
            setResult({ buildId: r.buildId, displayId: r.displayId });
        } catch (err) {
            setStep(0);
            setError(errorMessage(err));
        }
    };

    const steps = ['Forking the Build Graph', 'Copying the approved version', 'Saving your change request'];
    return (
        <Sheet open={open} onClose={onClose} title="Remix this build" testId="remix-sheet">
            <form onSubmit={submit} className="space-y-4">
                <Field label="What should change?" hint='For example: "30% larger, orange powder coat".'>
                    {({ id, describedBy }) => <TextArea id={id} aria-describedby={describedBy} value={text} maxLength={200} onChange={(e) => setText(e.target.value)} disabled={step > 0} data-testid="remix-text" />}
                </Field>
                {step > 0 && (
                    <ol className="space-y-1.5 text-sm" aria-live="polite" data-testid="remix-progress">
                        {steps.map((label, i) => (
                            <li key={label} className="flex items-center gap-2">
                                {step > i + 1 || (step === 3 && result) ? <CheckCircle2 className="h-4 w-4 text-signal" aria-hidden /> : <Loader2 className="h-4 w-4 animate-spin text-fg-subtle" aria-hidden />}
                                {label}
                            </li>
                        ))}
                    </ol>
                )}
                {error && <Notice tone="error">{error}</Notice>}
                {result ? (
                    <div className="space-y-2">
                        <p className="text-sm text-fg-muted">Your remix {result.displayId} is a new build derived from this one. Apply the change in its workspace, then get a binding quote.</p>
                        <Link href={`/build/${result.buildId}/workspace`} className={buttonClass('primary', 'md', 'w-full')} data-testid="remix-open">
                            Open my remix
                        </Link>
                    </div>
                ) : (
                    <Button type="submit" className="w-full" loading={step > 0} disabled={text.trim().length < 3} data-testid="remix-submit">
                        Remix it
                    </Button>
                )}
            </form>
        </Sheet>
    );
}

// ---------------------------------------------------------------------------
// Claim Build Slot: ship-to + authorize-only payment hold
// ---------------------------------------------------------------------------

const METHODS: { method: ShippingMethod; label: string }[] = [
    { method: 'STANDARD', label: 'Standard' },
    { method: 'EXPEDITED', label: 'Expedited' },
    { method: 'EXPRESS', label: 'Express' },
];

export function ClaimSheet({ open, onClose, drop, onClaimed }: { open: boolean; onClose: () => void; drop: DropView | null; onClaimed: (r: ClaimSlotsResponse) => void }) {
    const [quantity, setQuantity] = useState(1);
    const [form, setForm] = useState({ name: '', line1: '', city: '', region: '', postalCode: '', method: 'STANDARD' as ShippingMethod, terms: false });
    const [claim, setClaim] = useState<ClaimSlotsResponse | null>(null);
    const [queue, setQueue] = useState<DropQueueResponse | null>(null);
    const [authorized, setAuthorized] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const idem = useRef<string>('');

    useEffect(() => {
        if (open) {
            idem.current = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now());
            setClaim(null);
            setQueue(null);
            setAuthorized(false);
            setError(null);
        }
    }, [open]);

    // R5 fair queue: poll the position until the entry is admitted (a held claim) or rejected.
    const queued = queue?.status === 'QUEUED' ? queue : null;
    useEffect(() => {
        if (!queued) return;
        const t = setTimeout(() => {
            mediaApi
                .queueStatus(queued.dropId)
                .then(setQueue)
                .catch((err) => setError(errorMessage(err)));
        }, 1000);
        return () => clearTimeout(t);
    }, [queued]);

    const max = drop ? Math.max(1, Math.min(drop.perBuyerLimit - drop.viewerClaimedSlots, drop.totalSlots - drop.claimedSlots)) : 1;
    const body = useMemo(
        () => ({
            quantity,
            buyer: { name: form.name },
            shippingAddress: { name: form.name, line1: form.line1, city: form.city, region: form.region, postalCode: form.postalCode, country: 'US' as const },
            shippingMethod: form.method,
            acceptTerms: form.terms,
        }),
        [quantity, form],
    );

    if (!drop) return null;
    const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        setError(null);
        const parsed = ClaimSlotsRequest.safeParse(body);
        if (!parsed.success) {
            setError(form.terms ? 'Check the name and US shipping address (5-digit ZIP).' : 'Please accept the terms to hold your slot.');
            return;
        }
        setBusy(true);
        try {
            if (drop.fairQueue) {
                setQueue(await mediaApi.joinQueue(drop.id, parsed.data));
                return;
            }
            const r = await liveApi.claim(drop.id, parsed.data, idem.current);
            setClaim(r);
            onClaimed(r);
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(false);
        }
    };

    const authorize = async () => {
        if (!claim) return;
        if (claim.payment.provider !== 'dev') {
            if (claim.checkoutUrl) window.location.assign(claim.checkoutUrl);
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await api.devConfirm({ providerRef: claim.payment.providerRef, outcome: 'succeeded' });
            setAuthorized(true);
            onClaimed({ ...claim, status: 'AUTHORIZED' });
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(false);
        }
    };

    const authorizeQueued = async () => {
        const c = queue?.claim;
        if (!c) return;
        if (c.payment?.provider !== 'dev') {
            if (c.checkoutUrl) window.location.assign(c.checkoutUrl);
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await api.devConfirm({ providerRef: c.payment.providerRef, outcome: 'succeeded' });
            setAuthorized(true);
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Sheet open={open} onClose={onClose} title={`Claim a Build Slot · ${money(drop.priceCents)}`} testId="claim-sheet">
            {queue && !claim ? (
                <div className="space-y-4" data-testid="queue-status" data-status={authorized ? 'AUTHORIZED' : queue.status}>
                    {queue.status === 'QUEUED' && (
                        <Notice tone="info" title={`You are number ${queue.position ?? '…'} in line`}>
                            High demand: claims that arrive in the same second are ordered at random, then admitted one by one. {queue.queueLength} waiting. Keep this open.
                        </Notice>
                    )}
                    {queue.status === 'REJECTED' && (
                        <Notice tone="warning" title="No slot this time" testId="queue-rejected">
                            {queue.reason ?? 'The drop could not take your claim.'}
                        </Notice>
                    )}
                    {queue.status === 'ADMITTED' && queue.claim && (
                        <>
                            <Notice tone="success" title={authorized ? 'Payment authorized' : `You are in: ${queue.quantity} slot${queue.quantity === 1 ? '' : 's'} held`}>
                                {authorized ? 'Your hold is in place. You are charged only if the drop reaches its goal.' : `Authorize the hold of ${money(queue.claim.totalCents)} (incl. shipping) to keep your slot.`}
                            </Notice>
                            {!authorized && (
                                <Button className="w-full" onClick={authorizeQueued} loading={busy} data-testid="queue-authorize">
                                    {queue.claim.payment?.provider === 'dev' ? `Authorize test payment · ${money(queue.claim.totalCents)}` : 'Authorize payment'}
                                </Button>
                            )}
                        </>
                    )}
                    {error && <Notice tone="error">{error}</Notice>}
                </div>
            ) : !claim ? (
                <form onSubmit={submit} noValidate className="space-y-4">
                    <p className="text-sm text-fg-muted">
                        You are reserving capacity in a production run. Your card is only authorized now and charged when the drop reaches {drop.thresholdSlots} slots by {dateTime(drop.closesAt)}. Otherwise the hold is released.
                    </p>
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium">Slots</span>
                        <QtyStepper value={Math.min(quantity, max)} onChange={setQuantity} min={1} max={max} testId="claim-qty" size="sm" />
                    </div>
                    <Field label="Full name">{({ id }) => <TextInput id={id} autoComplete="name" value={form.name} onChange={(e) => set('name', e.target.value)} data-testid="claim-name" />}</Field>
                    <Field label="Street address">{({ id }) => <TextInput id={id} autoComplete="address-line1" value={form.line1} onChange={(e) => set('line1', e.target.value)} data-testid="claim-line1" />}</Field>
                    <div className="grid grid-cols-[1.3fr_1fr_1fr] gap-2">
                        <Field label="City">{({ id }) => <TextInput id={id} autoComplete="address-level2" value={form.city} onChange={(e) => set('city', e.target.value)} data-testid="claim-city" />}</Field>
                        <Field label="State">
                            {({ id }) => (
                                <SelectInput id={id} autoComplete="address-level1" value={form.region} onChange={(e) => set('region', e.target.value)} data-testid="claim-region">
                                    <option value="">–</option>
                                    {US_STATES.map(([code]) => (
                                        <option key={code} value={code}>
                                            {code}
                                        </option>
                                    ))}
                                </SelectInput>
                            )}
                        </Field>
                        <Field label="ZIP">{({ id }) => <TextInput id={id} autoComplete="postal-code" inputMode="numeric" value={form.postalCode} onChange={(e) => set('postalCode', e.target.value)} data-testid="claim-postal" />}</Field>
                    </div>
                    <fieldset>
                        <legend className="text-sm font-medium">Shipping</legend>
                        <div className="mt-2 grid grid-cols-3 gap-2">
                            {METHODS.map((m) => (
                                <label key={m.method} className={`cursor-pointer rounded-xl px-2 py-2 text-center text-sm ring-1 ring-inset ${form.method === m.method ? 'bg-graphite-800 ring-signal' : 'ring-graphite-600'}`}>
                                    <input type="radio" name="claim-method" className="sr-only" checked={form.method === m.method} onChange={() => set('method', m.method)} />
                                    {m.label}
                                </label>
                            ))}
                        </div>
                    </fieldset>
                    <label className="flex items-start gap-3 text-sm text-fg-muted">
                        <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[#5fe08a]" checked={form.terms} onChange={(e) => set('terms', e.target.checked)} data-testid="claim-terms" />
                        <span>I authorize a hold for this order and accept the Terms. I am charged only if the drop reaches its goal; my order then goes to production.</span>
                    </label>
                    {error && <Notice tone="error" testId="claim-error">{error}</Notice>}
                    <Button type="submit" className="w-full" loading={busy} data-testid="claim-submit">
                        <Lock className="h-4 w-4" aria-hidden /> {drop.fairQueue ? `Join the queue for ${quantity} slot${quantity === 1 ? '' : 's'}` : `Hold ${quantity} slot${quantity === 1 ? '' : 's'}`}
                    </Button>
                </form>
            ) : (
                <div className="space-y-4" data-testid="claim-result" data-status={authorized ? 'AUTHORIZED' : claim.status}>
                    <Notice tone="success" title={authorized ? 'Payment authorized' : `${claim.drop.viewerClaimedSlots} slot${claim.drop.viewerClaimedSlots === 1 ? '' : 's'} held`}>
                        {authorized
                            ? `Your hold of ${money(claim.totalCents)} is in place. You are charged only if the drop reaches ${claim.drop.thresholdSlots} slots.`
                            : `Authorize the hold of ${money(claim.totalCents)} (incl. shipping) before ${dateTime(claim.expiresAt)} to keep your slot.`}
                    </Notice>
                    {!authorized && (
                        <Button className="w-full" onClick={authorize} loading={busy} data-testid="claim-authorize">
                            {claim.payment.provider === 'dev' ? `Authorize test payment · ${money(claim.totalCents)}` : 'Authorize payment'}
                        </Button>
                    )}
                    {claim.payment.provider === 'dev' && !authorized && <p className="text-xs text-fg-subtle">Development payment provider: no card is charged. The same hold, capture and release pipeline runs as with Stripe.</p>}
                    {error && <Notice tone="error">{error}</Notice>}
                    <a href={claim.orderUrl} className="block text-center text-sm font-semibold text-fg underline underline-offset-2" target="_blank" rel="noopener" data-testid="claim-order-link">
                        View your order
                    </a>
                </div>
            )}
        </Sheet>
    );
}
