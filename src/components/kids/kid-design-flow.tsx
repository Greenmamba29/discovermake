'use client';

/**
 * Kids mode design flow: one choice per screen, "Step 2 of 4" dots, a live drawing of the
 * project with the kid's words, then the real price in kid words and "Ask a grown-up".
 * Plain words (reading age about 8), every tap target at least 48 px.
 */
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Minus, Plus } from 'lucide-react';
import { kidPrice, type KidDesignOptions, type KidDesignView } from '@/contracts/kids';
import { KID_COLORS, KID_TEMPLATES, KidLabel, type KidColor, type KidTemplateId } from '@/contracts/text-to-cad';
import { ApiClientError, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { kidsApi } from './kid-api';
import { KidObjectView } from './kid-object-view';
import { KID_COLOR_HEX, KID_COLOR_NAMES, KidPreview } from './kid-preview';

type StepKind = 'label' | 'label_optional' | 'color' | 'size' | 'angle' | 'shape' | 'cups';

const FLOWS: Record<KidTemplateId, StepKind[]> = {
    name_keychain: ['label', 'color', 'size'],
    phone_stand: ['color', 'angle', 'label_optional'],
    bookmark: ['label', 'color', 'shape'],
    desk_tidy: ['color', 'cups', 'label_optional'],
    bike_hook: ['color', 'label_optional'],
};

const QUESTIONS: Record<StepKind, string> = {
    label: 'What should it say?',
    label_optional: 'Do you want words on it?',
    color: 'Pick a color',
    size: 'Pick a size',
    angle: 'How tall should it stand?',
    shape: 'Pick a shape',
    cups: 'How many cups?',
};

const CHOICES = {
    size: [
        { value: 'small', label: 'Small' },
        { value: 'big', label: 'Big' },
    ],
    angle: [
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'tall', label: 'Tall' },
    ],
    shape: [
        { value: 'rounded', label: 'Round top' },
        { value: 'arrow', label: 'Arrow' },
        { value: 'star', label: 'Star' },
    ],
} as const;

type Params = { label: string; color: KidColor; size: 'small' | 'big'; angle: 'low' | 'medium' | 'tall'; shape: 'rounded' | 'arrow' | 'star'; cups: number };

function paramsFor(template: KidTemplateId, p: Params): Record<string, unknown> {
    const label = p.label.trim();
    switch (template) {
        case 'name_keychain':
            return { label, color: p.color, size: p.size };
        case 'phone_stand':
            return { color: p.color, angle: p.angle, ...(label ? { label } : {}) };
        case 'bookmark':
            return { label, color: p.color, shape: p.shape };
        case 'desk_tidy':
            return { color: p.color, cups: p.cups, ...(label ? { label } : {}) };
        case 'bike_hook':
            return { color: p.color, ...(label ? { label } : {}) };
    }
}

function labelError(label: string, optional: boolean): string | null {
    if (optional && !label.trim()) return null;
    const r = KidLabel.safeParse(label);
    return r.success ? null : (r.error.issues[0]?.message ?? 'Check your words.');
}

export function KidDesignFlow({ template }: { template: KidTemplateId }) {
    const steps = FLOWS[template];
    const total = steps.length + 1;
    const info = KID_TEMPLATES[template];
    const [step, setStep] = useState(0);
    const [p, setP] = useState<Params>({ label: '', color: 'blue', size: 'small', angle: 'medium', shape: 'rounded', cups: 3 });
    const [touched, setTouched] = useState(false);
    const [design, setDesign] = useState<KidDesignView | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [asked, setAsked] = useState(false);

    const options: KidDesignOptions = useMemo(() => {
        const o: KidDesignOptions = { color: p.color };
        if (p.label.trim()) o.label = p.label.trim();
        if (template === 'name_keychain') o.size = p.size;
        if (template === 'phone_stand') o.angle = p.angle;
        if (template === 'bookmark') o.shape = p.shape;
        if (template === 'desk_tidy') o.cups = p.cups;
        return o;
    }, [p, template]);

    const kind = steps[step];
    const onLook = step === steps.length;
    const lblErr = kind === 'label' || kind === 'label_optional' ? labelError(p.label, kind === 'label_optional') : null;

    async function seePrice() {
        setBusy(true);
        setError(null);
        setDesign(null);
        try {
            setDesign(await kidsApi.design(template, paramsFor(template, p)));
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(false);
        }
    }

    async function tryAgain() {
        if (!design) return seePrice();
        setBusy(true);
        setError(null);
        try {
            setDesign(await kidsApi.price(design.id));
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(false);
        }
    }

    async function ask() {
        if (!design) return;
        setBusy(true);
        setError(null);
        try {
            await kidsApi.ask(design.id);
            setAsked(true);
        } catch (err) {
            setError(err instanceof ApiClientError ? err.message : errorMessage(err));
        } finally {
            setBusy(false);
        }
    }

    function next() {
        if (lblErr) {
            setTouched(true);
            return;
        }
        setTouched(false);
        const n = step + 1;
        setStep(n);
        if (n === steps.length) void seePrice();
    }

    function back() {
        setDesign(null);
        setError(null);
        setAsked(false);
        setStep((s) => Math.max(0, s - 1));
    }

    const heading = onLook ? (asked ? 'Sent to your grown-up!' : `Your ${info.title.toLowerCase()}`) : QUESTIONS[kind!];

    return (
        <div className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4 py-6" data-testid="kid-design-flow">
            <div className="flex items-center justify-between gap-3">
                {step > 0 && !asked ? (
                    <button type="button" onClick={back} className="flex h-12 min-w-[48px] items-center gap-2 rounded-2xl px-3 text-base font-bold text-ink hover:bg-ink/5" data-testid="kid-back">
                        <ArrowLeft className="h-6 w-6" aria-hidden /> Back
                    </button>
                ) : (
                    <Link href="/kids" className="flex h-12 min-w-[48px] items-center gap-2 rounded-2xl px-3 text-base font-bold text-ink hover:bg-ink/5" data-testid="kid-back">
                        <ArrowLeft className="h-6 w-6" aria-hidden /> Back
                    </Link>
                )}
                <div className="flex flex-col items-end gap-1">
                    <p className="text-sm font-bold text-ink-muted" data-testid="kid-step">
                        Step {Math.min(step + 1, total)} of {total}
                    </p>
                    <div className="flex gap-1.5" aria-hidden>
                        {Array.from({ length: total }, (_, i) => (
                            <span key={i} className={cn('h-2.5 w-2.5 rounded-full', i <= step ? 'bg-ink' : 'bg-paper-line')} />
                        ))}
                    </div>
                </div>
            </div>

            <h1 className="text-3xl font-extrabold leading-tight text-ink">{heading}</h1>

            {onLook ? (
                <KidObjectView template={template} options={options} glbUrl={design?.glbUrl ?? null} title={info.title.toLowerCase()} />
            ) : (
                <KidPreview template={template} options={options} title={`Drawing of your ${info.title.toLowerCase()}`} />
            )}

            {(kind === 'label' || kind === 'label_optional') && (
                <div className="flex flex-col gap-2">
                    <label htmlFor="kid-label" className="text-lg font-bold text-ink">
                        {kind === 'label' ? 'Type your words' : 'Type your words, or skip'}
                    </label>
                    <input
                        id="kid-label"
                        value={p.label}
                        maxLength={12}
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        onChange={(e) => setP({ ...p, label: e.target.value })}
                        onBlur={() => setTouched(true)}
                        aria-invalid={touched && Boolean(lblErr)}
                        aria-describedby="kid-label-help"
                        className="h-16 rounded-2xl bg-paper-raised px-4 text-3xl font-extrabold tracking-wide text-ink ring-2 ring-inset ring-paper-line focus:outline-none focus:ring-ink aria-[invalid=true]:ring-ember"
                        data-testid="kid-label-input"
                    />
                    <div id="kid-label-help" className="flex items-start justify-between gap-3 text-base">
                        <p className={cn('font-semibold', touched && lblErr ? 'text-[#a8431a]' : 'text-ink-muted')} role={touched && lblErr ? 'alert' : undefined} data-testid="kid-label-message">
                            {touched && lblErr ? lblErr : 'Tip: use a nickname, not your full name.'}
                        </p>
                        <p className="shrink-0 font-bold text-ink-muted" data-testid="kid-label-count">
                            {p.label.length} of 12
                        </p>
                    </div>
                </div>
            )}

            {kind === 'color' && (
                <fieldset>
                    <legend className="sr-only">Color</legend>
                    <div className="grid grid-cols-4 gap-3" role="radiogroup" aria-label="Color">
                        {KID_COLORS.map((c) => (
                            <button
                                key={c}
                                type="button"
                                role="radio"
                                aria-checked={p.color === c}
                                onClick={() => setP({ ...p, color: c })}
                                className={cn('flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-2xl bg-paper-raised text-sm font-bold text-ink ring-2 ring-inset', p.color === c ? 'ring-ink' : 'ring-paper-line')}
                                data-testid={`kid-color-${c}`}
                            >
                                <span className="h-8 w-8 rounded-full ring-2 ring-ink/20" style={{ background: KID_COLOR_HEX[c] }} aria-hidden />
                                {KID_COLOR_NAMES[c]}
                            </button>
                        ))}
                    </div>
                </fieldset>
            )}

            {(kind === 'size' || kind === 'angle' || kind === 'shape') && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" role="radiogroup" aria-label={QUESTIONS[kind]}>
                    {CHOICES[kind].map((c) => {
                        const on = p[kind] === c.value;
                        return (
                            <button
                                key={c.value}
                                type="button"
                                role="radio"
                                aria-checked={on}
                                onClick={() => setP({ ...p, [kind]: c.value })}
                                className={cn('min-h-[64px] rounded-2xl bg-paper-raised px-4 text-xl font-extrabold text-ink ring-2 ring-inset', on ? 'ring-ink' : 'ring-paper-line')}
                                data-testid={`kid-${kind}-${c.value}`}
                            >
                                {c.label}
                            </button>
                        );
                    })}
                </div>
            )}

            {kind === 'cups' && (
                <div className="flex items-center justify-center gap-6" role="group" aria-label="How many cups">
                    <button type="button" onClick={() => setP({ ...p, cups: Math.max(2, p.cups - 1) })} disabled={p.cups <= 2} className="flex h-16 w-16 items-center justify-center rounded-2xl bg-paper-raised text-ink ring-2 ring-inset ring-paper-line disabled:opacity-40" aria-label="One less cup" data-testid="kid-cups-less">
                        <Minus className="h-8 w-8" aria-hidden />
                    </button>
                    <p className="min-w-[4ch] text-center text-5xl font-extrabold text-ink" aria-live="polite" data-testid="kid-cups">
                        {p.cups}
                    </p>
                    <button type="button" onClick={() => setP({ ...p, cups: Math.min(4, p.cups + 1) })} disabled={p.cups >= 4} className="flex h-16 w-16 items-center justify-center rounded-2xl bg-paper-raised text-ink ring-2 ring-inset ring-paper-line disabled:opacity-40" aria-label="One more cup" data-testid="kid-cups-more">
                        <Plus className="h-8 w-8" aria-hidden />
                    </button>
                </div>
            )}

            {!onLook && (
                <button type="button" onClick={next} className="flex h-16 items-center justify-center gap-3 rounded-2xl bg-ink text-xl font-extrabold text-paper hover:bg-black" data-testid="kid-next">
                    {step === steps.length - 1 ? 'See my price' : kind === 'label_optional' && !p.label.trim() ? 'Skip' : 'Next'}
                    <ArrowRight className="h-6 w-6" aria-hidden />
                </button>
            )}

            {onLook && (
                <section aria-live="polite" className="flex flex-col gap-4" data-testid="kid-price-area">
                    {busy && !design && <p className="text-xl font-bold text-ink-muted">Asking the workshop…</p>}
                    {error && (
                        <p className="rounded-2xl bg-[#fbe3d6] p-4 text-lg font-bold text-ink" role="alert" data-testid="kid-error">
                            {error}
                        </p>
                    )}
                    {design && design.status === 'priced' && design.priceCents !== null && design.withinLimit && !asked && (
                        <>
                            <p className="text-2xl font-extrabold text-ink" data-testid="kid-price">
                                This costs {kidPrice(design.priceCents)}. A grown-up needs to say yes.
                            </p>
                            <button type="button" onClick={ask} disabled={busy} className="flex h-16 items-center justify-center rounded-2xl bg-ink text-xl font-extrabold text-paper hover:bg-black disabled:opacity-60" data-testid="kid-ask">
                                Ask a grown-up
                            </button>
                        </>
                    )}
                    {design && design.message && !(design.status === 'priced' && design.withinLimit) && (
                        <div className="flex flex-col gap-3 rounded-2xl bg-paper-raised p-4 ring-2 ring-inset ring-paper-line" data-testid={design.status === 'offline' ? 'kid-offline' : 'kid-message'}>
                            <p className="text-xl font-bold text-ink">{design.message}</p>
                            {design.status === 'priced' ? (
                                <button type="button" onClick={() => (setStep(0), setDesign(null))} className="flex h-14 items-center justify-center rounded-2xl bg-ink text-lg font-extrabold text-paper" data-testid="kid-change">
                                    Change it
                                </button>
                            ) : (
                                <button type="button" onClick={tryAgain} disabled={busy} className="flex h-14 items-center justify-center rounded-2xl bg-ink text-lg font-extrabold text-paper disabled:opacity-60" data-testid="kid-try-again">
                                    Try again
                                </button>
                            )}
                        </div>
                    )}
                    {asked && (
                        <div className="flex flex-col gap-3" data-testid="kid-asked">
                            <p className="text-xl font-bold text-ink">A grown-up will look at it. You can see it in My things.</p>
                            <Link href="/kids/things" className="flex h-16 items-center justify-center rounded-2xl bg-ink text-xl font-extrabold text-paper" data-testid="kid-see-things">
                                See my things
                            </Link>
                        </div>
                    )}
                </section>
            )}
        </div>
    );
}
