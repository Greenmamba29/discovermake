'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { BadgeCheck, CalendarClock, Gauge, Truck } from 'lucide-react';
import type { MembershipResponse, MembershipStatus } from '@/contracts/prime';
import { ButtonLink } from '@/components/ui/button';
import { ConfirmAction } from '@/components/ui/confirm-action';
import { ErrorState, Notice } from '@/components/ui/state';
import { PageSkeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { longDate, money } from '@/lib/format';
import { cn } from '@/lib/utils';
import { primeApi } from './api';

const STATUS_TEXT: Record<MembershipStatus, string> = {
    incomplete: 'Not started',
    trialing: 'Free trial',
    active: 'Active',
    past_due: 'Payment failed',
    canceled: 'Cancelled',
};

/** /me/membership — status, renewal date, cancel / resume. */
export function MembershipScreen({ welcome }: { welcome: boolean }) {
    const qc = useQueryClient();
    const q = useQuery({ queryKey: ['membership'], queryFn: () => primeApi.membership() });
    const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
    if (q.isLoading) return <PageSkeleton label="Loading your membership" />;
    if (q.error || !q.data) return <ErrorState title="Could not load your membership" message={errorMessage(q.error)} />;
    const data = q.data;
    const m = data.membership;

    const act = async (action: 'cancel' | 'resume') => {
        try {
            const next = await primeApi.updateMembership(action);
            qc.setQueryData<MembershipResponse>(['membership'], next);
            setNotice({ tone: 'success', text: action === 'cancel' ? 'Your membership will end at the end of this period. You keep every benefit until then.' : 'Your membership will renew as usual.' });
        } catch (err) {
            setNotice({ tone: 'error', text: errorMessage(err) });
        }
    };

    const plan = m ? data.plans.find((p) => p.plan === m.plan) : null;
    return (
        <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6 sm:px-6">
            <p className="eyebrow">Me · Membership</p>
            <h1 className="mt-1 font-display font-wide text-3xl font-extrabold">DiscoverMake Prime</h1>
            {!data.signedIn ? (
                <Notice className="mt-6" title="Sign in to manage Prime" action={<ButtonLink href="/signin?next=/me/membership">Sign in</ButtonLink>}>
                    Your membership belongs to your account.
                </Notice>
            ) : !m || m.status === 'incomplete' ? (
                <Notice className="mt-6" title="You are not a member yet" action={<ButtonLink href="/prime">{data.trialAvailable ? 'Start your free trial' : 'Join Prime'}</ButtonLink>}>
                    Free shipping over {money(data.benefits.freeShippingThresholdCents)}, priority shop slots, guaranteed dates and member material pricing.
                </Notice>
            ) : (
                <div className="mt-6 space-y-6">
                    {welcome && m.isMember && (
                        <Notice tone="success" title="Welcome to Prime" testId="membership-welcome">
                            Your benefits apply to your next checkout.
                        </Notice>
                    )}
                    {notice && (
                        <Notice tone={notice.tone} testId="membership-notice">
                            {notice.text}
                        </Notice>
                    )}
                    <section aria-labelledby="status-heading" className="rounded-3xl bg-graphite-900 p-5 ring-1 ring-graphite-700 sm:p-6" data-testid="membership-card">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <h2 id="status-heading" className="font-display text-xl font-bold">
                                {plan?.label ?? m.plan} plan
                            </h2>
                            <span className={cn('rounded-full px-2.5 py-1 text-xs font-bold', m.isMember ? 'bg-signal/15 text-signal' : 'bg-amber/15 text-amber')} data-testid="membership-status">
                                {STATUS_TEXT[m.status]}
                                {m.cancelAtPeriodEnd ? ' · ends soon' : ''}
                            </span>
                        </div>
                        <p className="mt-2 text-lg text-fg" data-testid="membership-sentence">
                            {m.status === 'trialing'
                                ? m.cancelAtPeriodEnd
                                    ? `Your trial ends ${longDate(m.trialEndsAt)}. You will not be charged.`
                                    : `Free until ${longDate(m.trialEndsAt)}, then ${plan ? money(plan.priceCents, plan.currency) : ''}${plan?.interval === 'year' ? '/year' : '/month'}.`
                                : m.status === 'active'
                                  ? m.cancelAtPeriodEnd
                                      ? `Prime ends ${longDate(m.currentPeriodEnd)}. You will not be charged again.`
                                      : `Renews ${longDate(m.renewsAt)} at ${plan ? money(plan.priceCents, plan.currency) : ''}.`
                                  : m.status === 'past_due'
                                    ? 'Your last payment failed. Benefits are paused until it goes through.'
                                    : `Cancelled ${longDate(m.canceledAt)}.`}
                        </p>
                        <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
                            <li className="flex items-center gap-2 text-fg-muted">
                                <Truck className="h-4 w-4 text-signal" aria-hidden /> Free shipping over {money(data.benefits.freeShippingThresholdCents)}
                            </li>
                            <li className="flex items-center gap-2 text-fg-muted">
                                <Gauge className="h-4 w-4 text-signal" aria-hidden /> Priority shop slots
                            </li>
                            <li className="flex items-center gap-2 text-fg-muted">
                                <CalendarClock className="h-4 w-4 text-signal" aria-hidden /> Guaranteed-date eligible
                            </li>
                        </ul>
                        <div className="mt-5 flex flex-wrap gap-2">
                            {m.isMember && !m.cancelAtPeriodEnd && (
                                <ConfirmAction
                                    label="Cancel membership"
                                    confirmLabel="Yes, cancel"
                                    prompt={`Prime stays on until ${longDate(m.status === 'trialing' ? m.trialEndsAt : m.currentPeriodEnd)}, then stops. No further charges.`}
                                    variant="secondary"
                                    onConfirm={() => act('cancel')}
                                    testId="membership-cancel"
                                />
                            )}
                            {m.isMember && m.cancelAtPeriodEnd && (
                                <ConfirmAction label="Keep my membership" confirmLabel="Resume" prompt="Undo the cancellation and keep renewing?" onConfirm={() => act('resume')} testId="membership-resume" />
                            )}
                            {m.status === 'canceled' && <ButtonLink href="/prime">Join again</ButtonLink>}
                        </div>
                    </section>
                    <p className="flex items-start gap-2 text-xs text-fg-subtle">
                        <BadgeCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> Cancelling keeps every benefit until the end of the period you already have; you are never charged again after you cancel.
                    </p>
                </div>
            )}
        </div>
    );
}
