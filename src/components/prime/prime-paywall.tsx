'use client';

import { useState } from 'react';
import { BadgeCheck, Bell, CalendarClock, Gauge, Layers, Radio, Sparkles, Truck } from 'lucide-react';
import type { MembershipResponse, PrimePlan } from '@/contracts/prime';
import { Button, ButtonLink } from '@/components/ui/button';
import { Notice } from '@/components/ui/state';
import { errorMessage } from '@/lib/api';
import { money, shortDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { primeApi } from './api';

const BENEFIT_ICONS = [Truck, Gauge, CalendarClock, Layers, Radio];

function benefitsList(data: MembershipResponse) {
    const b = data.benefits;
    return [
        { title: 'Free standard shipping', body: `On every order over ${money(b.freeShippingThresholdCents)}, and on whole build carts that reach it.` },
        { title: 'Priority shop slots', body: 'Your jobs jump the partner-shop queue, flagged in every Shop Console.' },
        { title: 'Guaranteed dates', body: 'Eligible for guaranteed delivery dates, with credits when we miss one.' },
        { title: 'Member material pricing', body: `${b.materialDiscountPct}% off the material line from our pooled stock, never below cost.` },
        { title: 'Early access to live drops', body: 'Claim Build Slots before everyone else.' },
    ];
}

/** /prime — Copilot "Claim your free trial" + Givingli "Today → reminder → trial ends" timeline. */
export function PrimePaywall({ initial, cancelled }: { initial: MembershipResponse; cancelled: boolean }) {
    const [plan, setPlan] = useState<PrimePlan>('annual');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const data = initial;
    const selected = data.plans.find((p) => p.plan === plan)!;
    const trialEnds = data.trialTimeline.find((s) => s.key === 'trial_ends')!;
    const member = data.membership?.isMember;
    const priceLine = `${money(selected.priceCents, selected.currency)}${selected.interval === 'year' ? '/year' : '/month'}`;

    const start = async () => {
        setBusy(true);
        setError(null);
        try {
            const res = await primeApi.startMembership(plan);
            window.location.assign(res.redirectUrl);
        } catch (err) {
            setError(errorMessage(err));
            setBusy(false);
        }
    };

    return (
        <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6 sm:px-6">
            <p className="eyebrow">DiscoverMake Prime</p>
            <h1 className="mt-1 font-display font-wide text-3xl font-extrabold sm:text-4xl">{data.trialAvailable ? 'Claim your free trial' : 'Join DiscoverMake Prime'}</h1>
            <p className="mt-2 max-w-2xl text-lg text-fg-muted">One price, one date, any part. Free shipping, priority slots and member pricing on everything you make.</p>
            {cancelled && (
                <Notice tone="info" className="mt-4" title="No changes made">
                    You left checkout before starting Prime. Nothing was charged.
                </Notice>
            )}

            <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
                <div className="space-y-8">
                    <section aria-labelledby="benefits-heading">
                        <h2 id="benefits-heading" className="font-display text-xl font-bold">
                            What you get
                        </h2>
                        <ul className="mt-3 grid gap-3 sm:grid-cols-2" data-testid="prime-benefits">
                            {benefitsList(data).map((b, i) => {
                                const Icon = BENEFIT_ICONS[i];
                                return (
                                    <li key={b.title} className="flex gap-3 rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700">
                                        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-signal" aria-hidden />
                                        <span>
                                            <span className="block font-semibold text-fg">{b.title}</span>
                                            <span className="block text-sm text-fg-muted">{b.body}</span>
                                        </span>
                                    </li>
                                );
                            })}
                        </ul>
                    </section>

                    {data.trialAvailable && (
                        <section aria-labelledby="timeline-heading">
                            <h2 id="timeline-heading" className="font-display text-xl font-bold">
                                How your free trial works
                            </h2>
                            <ol className="mt-4 space-y-0" data-testid="trial-timeline">
                                {data.trialTimeline.map((step, i) => {
                                    const Icon = i === 0 ? Sparkles : i === 1 ? Bell : BadgeCheck;
                                    const last = i === data.trialTimeline.length - 1;
                                    return (
                                        <li key={step.key} className="relative flex gap-4 pb-6" data-testid={`trial-step-${step.key}`}>
                                            {!last && <span aria-hidden className="absolute left-[19px] top-10 h-[calc(100%-2.5rem)] w-0.5 bg-gradient-to-b from-signal to-graphite-700" />}
                                            <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-2', i === 0 ? 'bg-signal text-signal-ink ring-signal' : 'bg-graphite-850 text-signal ring-graphite-600')} aria-hidden>
                                                <Icon className="h-5 w-5" />
                                            </span>
                                            <span className="pt-1">
                                                <span className="block font-semibold text-fg">
                                                    {step.label} · <time dateTime={step.date}>{shortDate(step.date)}</time>
                                                </span>
                                                <span className="block text-sm text-fg-muted">
                                                    {step.key === 'trial_ends' ? `Your ${plan} plan starts at ${priceLine}. Cancel before this date and you pay nothing.` : step.description}
                                                </span>
                                            </span>
                                        </li>
                                    );
                                })}
                            </ol>
                        </section>
                    )}
                </div>

                <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
                    <section aria-labelledby="plan-heading" className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700 sm:p-5">
                        <h2 id="plan-heading" className="font-display text-lg font-bold">
                            Choose your plan
                        </h2>
                        <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Plan">
                            {data.plans.map((p) => (
                                <label
                                    key={p.plan}
                                    className={cn(
                                        'relative flex cursor-pointer flex-col rounded-xl p-3 ring-1 ring-inset focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-signal',
                                        plan === p.plan ? 'bg-graphite-800 ring-signal' : 'ring-graphite-700 hover:bg-graphite-850',
                                    )}
                                    data-testid={`plan-${p.plan}`}
                                >
                                    <input type="radio" name="plan" value={p.plan} checked={plan === p.plan} onChange={() => setPlan(p.plan)} className="sr-only" />
                                    <span className="text-sm font-semibold text-fg">{p.label}</span>
                                    <span className="font-mono text-lg font-bold tabular text-fg">{money(p.priceCents, p.currency)}</span>
                                    <span className="text-xs text-fg-subtle">{p.interval === 'year' ? `${money(p.perMonthCents, p.currency)}/mo` : 'per month'}</span>
                                    {p.savingsPct > 0 && <span className="mt-1 w-fit rounded-full bg-signal/15 px-2 py-0.5 text-[11px] font-bold text-signal">Save {p.savingsPct}%</span>}
                                </label>
                            ))}
                        </div>
                        <div className="mt-4">
                            {member ? (
                                <ButtonLink href="/me/membership" className="w-full" data-testid="prime-manage">
                                    You are a member · Manage
                                </ButtonLink>
                            ) : data.signedIn ? (
                                <Button className="w-full" size="lg" onClick={start} loading={busy} data-testid="prime-start-trial">
                                    {data.trialAvailable ? 'Start free trial' : `Start Prime · ${priceLine}`}
                                </Button>
                            ) : (
                                <ButtonLink href="/signin?next=/prime" className="w-full" size="lg" data-testid="prime-signin">
                                    Sign in to start your free trial
                                </ButtonLink>
                            )}
                        </div>
                        <p className="mt-3 text-xs text-fg-muted" data-testid="prime-cancel-copy">
                            {data.trialAvailable
                                ? `Free for ${data.trialDays} days, then ${priceLine}. We remind you 2 days before ${shortDate(trialEnds.date)}. Cancel in one tap from Membership before then and you pay nothing.`
                                : `${priceLine}, renews automatically. Cancel any time from Membership; you keep Prime until the end of the period you paid for.`}
                        </p>
                        {error && (
                            <p className="mt-2 text-sm font-medium text-ember" role="alert">
                                {error}
                            </p>
                        )}
                    </section>
                </aside>
            </div>
        </div>
    );
}
