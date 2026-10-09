'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Compass, Factory, Hammer, KeyRound, Store } from 'lucide-react';
import type { OnboardingIntent } from '@/contracts/account';
import { Button } from '@/components/ui/button';
import { savePreferences } from '@/components/site/use-account';
import { INTEREST_OPTIONS } from '@/lib/interests';
import { cn } from '@/lib/utils';
import { FirstBuildStep } from './first-build-step';
import {
    MIN_INTERESTS,
    ONBOARDED_KEY,
    ONBOARDING_STEPS,
    back,
    canContinue,
    clearState,
    interestsNeeded,
    loadState,
    next,
    saveState,
    selectIntent,
    stepName,
    toggleInterest,
    type FirstBuild,
    type OnboardingState,
} from './onboarding-state';

const INTENTS: { value: OnboardingIntent; title: string; body: string; icon: typeof Hammer }[] = [
    { value: 'make', title: 'Make something', body: 'Upload a file or describe a part, get a price and get it made.', icon: Hammer },
    { value: 'discover', title: 'Discover things to make', body: 'Browse starter designs and remix one into your own.', icon: Compass },
    { value: 'sell', title: 'Sell my designs', body: 'Publish designs people can order, and earn on every build.', icon: Store },
    { value: 'shop', title: 'I run a shop', body: 'Take vetted jobs from the DiscoverMake network.', icon: Factory },
];

const SIGNUP_HREF = '/signin?mode=create&next=/builds';

function session(): Storage | null {
    try {
        return window.sessionStorage;
    } catch {
        return null;
    }
}

/**
 * /onboarding: 4 steps, about 60 seconds (workflow 10). Intent → Pick 5 → First build (an instant,
 * binding quote on the bundled sample) → Save with a passkey (deferred signup, Behance pattern).
 * Every step has Back and Skip; progress lives in sessionStorage so a refresh resumes, and each
 * answer is saved to PUT /api/me/preferences (best effort).
 */
export function OnboardingFlow() {
    const router = useRouter();
    const [state, setState] = useState<OnboardingState | null>(null);
    const heading = useRef<HTMLHeadingElement>(null);
    const lastStep = useRef<number | null>(null);

    useEffect(() => setState(loadState(session())), []);
    useEffect(() => {
        if (!state) return;
        saveState(session(), state);
        // Move focus to the new step's heading (not on first paint).
        if (lastStep.current !== null && lastStep.current !== state.step) heading.current?.focus();
        lastStep.current = state.step;
    }, [state]);

    const update = useCallback((fn: (s: OnboardingState) => OnboardingState) => setState((s) => (s ? fn(s) : s)), []);

    const finish = useCallback(
        (s: OnboardingState) => {
            void savePreferences({ intent: s.intent ?? undefined, interests: s.interests.length ? s.interests : undefined, complete: true });
            try {
                window.localStorage.setItem(ONBOARDED_KEY, '1');
            } catch {
                // ignore
            }
            clearState(session());
        },
        [],
    );

    if (!state) {
        return (
            <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6" aria-busy="true">
                <div className="skeleton h-2 w-full" />
                <div className="skeleton mt-8 h-10 w-3/4" />
                <div className="skeleton mt-6 h-48 w-full" />
            </div>
        );
    }

    const step = stepName(state);
    const total = ONBOARDING_STEPS.length;
    const pct = Math.round(((state.step + 1) / total) * 100);

    const onContinue = () => {
        if (!canContinue(state)) return;
        if (step === 'intent' && state.intent) void savePreferences({ intent: state.intent });
        if (step === 'interests') void savePreferences({ interests: state.interests });
        update(next);
    };
    const onSkip = () => {
        if (step === 'save') {
            finish(state);
            router.push('/');
            return;
        }
        update(next);
    };
    const onBack = () => {
        if (state.step === 0) router.push('/');
        else update(back);
    };

    return (
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pb-10 pt-6 sm:px-6 sm:pt-10" data-testid="onboarding" data-step={step}>
            {/* Blinkist: "Step 1 of 4" with a progress bar; Back and Skip on every step. */}
            <div className="flex items-center justify-between gap-3">
                <button type="button" onClick={onBack} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-fg-muted hover:text-fg" data-testid="onboarding-back">
                    <ArrowLeft className="h-4 w-4" aria-hidden />
                    Back
                </button>
                <p className="font-mono text-xs text-fg-muted" data-testid="onboarding-progress">
                    Step {state.step + 1} of {total}
                </p>
                <button type="button" onClick={onSkip} className="inline-flex min-h-[44px] items-center rounded-lg px-2 text-sm font-medium text-fg-muted hover:text-fg" data-testid="onboarding-skip">
                    {step === 'save' ? 'Skip for now' : 'Skip'}
                </button>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-graphite-700" role="progressbar" aria-label="Onboarding progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={`Step ${state.step + 1} of ${total}`}>
                <div className="h-full rounded-full bg-signal transition-[width] duration-300" style={{ width: `${pct}%` }} />
            </div>

            <div className="mt-8 flex-1">
                {step === 'intent' && (
                    <section aria-labelledby="onb-title">
                        <p className="eyebrow">Welcome to DiscoverMake</p>
                        <h1 id="onb-title" ref={heading} tabIndex={-1} className="mt-2 font-display font-wide text-3xl font-extrabold tracking-tight focus:outline-none sm:text-4xl">
                            What brings you here?
                        </h1>
                        <p className="mt-2 text-fg-muted">You can always change this later.</p>
                        <fieldset className="mt-6">
                            <legend className="sr-only">What brings you here?</legend>
                            <div className="grid gap-3 sm:grid-cols-2">
                                {INTENTS.map((o) => {
                                    const checked = state.intent === o.value;
                                    return (
                                        <label key={o.value} className="block cursor-pointer" data-testid={`intent-option-${o.value}`}>
                                            <input type="radio" name="intent" value={o.value} checked={checked} onChange={() => update((s) => selectIntent(s, o.value))} className="peer sr-only" />
                                            <span
                                                className={cn(
                                                    'flex h-full items-start gap-3 rounded-2xl bg-graphite-850 p-4 ring-1 ring-inset ring-graphite-600 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-signal',
                                                    checked ? 'bg-signal/10 ring-2 ring-signal' : 'hover:ring-graphite-500',
                                                )}
                                            >
                                                <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', checked ? 'bg-signal text-signal-ink' : 'bg-graphite-700 text-fg')}>
                                                    <o.icon className="h-5 w-5" aria-hidden />
                                                </span>
                                                <span className="min-w-0">
                                                    <span className="block font-semibold text-fg">{o.title}</span>
                                                    <span className="mt-0.5 block text-sm text-fg-muted">{o.body}</span>
                                                </span>
                                            </span>
                                        </label>
                                    );
                                })}
                            </div>
                        </fieldset>
                    </section>
                )}

                {step === 'interests' && (
                    <section aria-labelledby="onb-title">
                        <p className="eyebrow">Your feed</p>
                        <h1 id="onb-title" ref={heading} tabIndex={-1} className="mt-2 font-display font-wide text-3xl font-extrabold tracking-tight focus:outline-none sm:text-4xl">
                            Pick 5 things you love to make
                        </h1>
                        <p className="mt-2 text-fg-muted">We use them to choose your Discover starters. Pick as many as you like.</p>
                        <p className="mt-4 font-mono text-sm text-fg" aria-live="polite" data-testid="interest-count">
                            {state.interests.length < MIN_INTERESTS ? `${state.interests.length} of ${MIN_INTERESTS} picked` : `${state.interests.length} picked`}
                        </p>
                        <fieldset className="mt-3">
                            <legend className="sr-only">Interests</legend>
                            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                {INTEREST_OPTIONS.map((o) => {
                                    const checked = state.interests.includes(o.slug);
                                    return (
                                        <li key={o.slug}>
                                            <label className="block cursor-pointer" data-testid={`interest-chip-${o.slug}`}>
                                                <input type="checkbox" checked={checked} onChange={() => update((s) => toggleInterest(s, o.slug))} className="peer sr-only" />
                                                <span
                                                    className={cn(
                                                        'relative flex min-h-[72px] flex-col items-start justify-between gap-2 rounded-xl bg-graphite-850 p-3 ring-1 ring-inset ring-graphite-600 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-signal',
                                                        checked ? 'bg-signal/10 ring-2 ring-signal' : 'hover:ring-graphite-500',
                                                    )}
                                                >
                                                    <o.icon className={cn('h-5 w-5', checked ? 'text-signal' : 'text-fg-muted')} aria-hidden />
                                                    <span className="text-sm font-semibold text-fg">{o.label}</span>
                                                    {checked && (
                                                        <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-signal text-signal-ink">
                                                            <Check className="h-3.5 w-3.5" aria-hidden />
                                                        </span>
                                                    )}
                                                </span>
                                            </label>
                                        </li>
                                    );
                                })}
                            </ul>
                        </fieldset>
                    </section>
                )}

                {step === 'first-build' && (
                    <section aria-labelledby="onb-title">
                        <p className="eyebrow">Your first build</p>
                        <h1 id="onb-title" ref={heading} tabIndex={-1} className="mt-2 font-display font-wide text-3xl font-extrabold tracking-tight focus:outline-none sm:text-4xl">
                            A real price in seconds
                        </h1>
                        <p className="mt-2 text-fg-muted">We are quoting our sample wall bracket through the same engine your own files use. Nothing here is simulated.</p>
                        <div className="mt-6">
                            <FirstBuildStep firstBuild={state.firstBuild} onQuoted={(fb: FirstBuild) => update((s) => ({ ...s, firstBuild: fb }))} />
                        </div>
                    </section>
                )}

                {step === 'save' && (
                    <section aria-labelledby="onb-title">
                        <p className="eyebrow">Keep it</p>
                        <h1 id="onb-title" ref={heading} tabIndex={-1} className="mt-2 font-display font-wide text-3xl font-extrabold tracking-tight focus:outline-none sm:text-4xl">
                            Save your build
                        </h1>
                        <p className="mt-2 text-fg-muted">
                            Create an account with a passkey to keep this quote and your picks on every device. No password to remember. You can also keep going as a guest; this device remembers your builds.
                        </p>
                        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                            <Link
                                href={SIGNUP_HREF}
                                onClick={() => finish(state)}
                                className="inline-flex h-14 items-center justify-center gap-2.5 rounded-xl bg-signal px-6 text-base font-semibold text-signal-ink transition-colors hover:bg-signal-strong"
                                data-testid="onboarding-passkey"
                            >
                                <KeyRound className="h-5 w-5" aria-hidden />
                                Save your build with a passkey
                            </Link>
                            <Link
                                href="/"
                                onClick={() => finish(state)}
                                className="inline-flex h-14 items-center justify-center rounded-xl px-6 text-base font-semibold text-fg-muted ring-1 ring-inset ring-graphite-600 transition-colors hover:bg-graphite-800 hover:text-fg"
                                data-testid="onboarding-not-now"
                            >
                                Not now
                            </Link>
                        </div>
                    </section>
                )}
            </div>

            {step !== 'save' && (
                <div className="mt-10 flex flex-wrap items-center justify-end gap-3 border-t border-graphite-700 pt-5">
                    {step === 'interests' && !canContinue(state) && <p className="mr-auto text-sm text-fg-muted">Pick {interestsNeeded(state)} more to continue</p>}
                    <Button size="lg" onClick={onContinue} disabled={!canContinue(state)} data-testid="onboarding-continue">
                        Continue
                        <ArrowRight className="h-4 w-4" aria-hidden />
                    </Button>
                </div>
            )}
        </div>
    );
}
