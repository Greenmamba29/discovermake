/**
 * Prime configuration: plans, prices and benefits (owner inputs via env, sane defaults).
 * Pure apart from reading env(); the paywall, checkout and the membership API all read
 * these same numbers.
 */
import type { MembershipStatus, PrimeBenefits, PrimePlan, PrimePlanView, TrialTimelineStep } from '../../contracts/prime';
import { env } from '../env';

export const PRIME_CURRENCY = 'usd';
/** The trial-ending reminder goes out this many days before the trial ends. */
export const TRIAL_REMINDER_DAYS_BEFORE = 2;

export function primePrices(): Record<PrimePlan, number> {
    const e = env();
    return { monthly: e.PRIME_MONTHLY_PRICE_CENTS, annual: e.PRIME_ANNUAL_PRICE_CENTS };
}

export function trialDays(): number {
    return env().PRIME_TRIAL_DAYS;
}

export function primePlans(): PrimePlanView[] {
    const p = primePrices();
    const annualPerMonth = Math.round(p.annual / 12);
    const savingsPct = p.monthly > 0 ? Math.max(0, Math.min(100, Math.round((1 - p.annual / (p.monthly * 12)) * 100))) : 0;
    return [
        { plan: 'monthly', label: 'Monthly', priceCents: p.monthly, currency: PRIME_CURRENCY, interval: 'month', perMonthCents: p.monthly, savingsPct: 0 },
        { plan: 'annual', label: 'Annual', priceCents: p.annual, currency: PRIME_CURRENCY, interval: 'year', perMonthCents: annualPerMonth, savingsPct },
    ];
}

export function primeBenefits(): PrimeBenefits {
    const e = env();
    return {
        freeShippingThresholdCents: e.PRIME_FREE_SHIPPING_THRESHOLD_CENTS,
        materialDiscountPct: e.PRIME_MATERIAL_DISCOUNT_PCT,
        priorityQueue: true,
        guaranteedDates: true,
        earlyAccess: true,
    };
}

/** Benefits apply while trialing or active (never past_due, canceled or incomplete). */
export function isMemberStatus(status: MembershipStatus): boolean {
    return status === 'trialing' || status === 'active';
}

const DAY_MS = 86_400_000;

/** YYYY-MM-DD in UTC (calendar dates on the paywall). */
export function isoDay(d: Date): string {
    return d.toISOString().slice(0, 10);
}

/** Givingli / Copilot timeline with real dates: Today → reminder → trial ends (first charge). */
export function trialTimeline(now: Date = new Date(), days: number = trialDays(), plan: PrimePlan = 'monthly'): TrialTimelineStep[] {
    const ends = new Date(now.getTime() + days * DAY_MS);
    const reminder = new Date(ends.getTime() - TRIAL_REMINDER_DAYS_BEFORE * DAY_MS);
    const price = primePrices()[plan];
    const money = `$${(price / 100).toFixed(2)}`;
    return [
        { key: 'today', label: 'Today', date: isoDay(now), description: 'Free shipping over the threshold, priority shop slots, member material pricing and early access start now.' },
        {
            key: 'reminder',
            label: `Day ${Math.max(1, days - TRIAL_REMINDER_DAYS_BEFORE)} · Reminder`,
            date: isoDay(reminder),
            description: 'We email you two days before your trial ends. Cancel in one tap from Membership if it is not for you.',
        },
        {
            key: 'trial_ends',
            label: `Day ${days} · Trial ends`,
            date: isoDay(ends),
            description: `Your ${plan === 'annual' ? 'annual' : 'monthly'} plan starts at ${money}${plan === 'annual' ? '/year' : '/month'}. Cancel before this date and you pay nothing.`,
        },
    ];
}

/** Length of a paid period (dev provider renewals). */
export function periodMs(plan: PrimePlan): number {
    return plan === 'annual' ? 365 * DAY_MS : 30 * DAY_MS;
}
