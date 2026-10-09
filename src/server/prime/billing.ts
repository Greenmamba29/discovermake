/**
 * Membership billing providers.
 *
 * - `stripe`: Stripe Billing. Checkout Session in `mode: 'subscription'` with a trial
 *   (`subscription_data.trial_period_days`) on the plan's recurring Price
 *   (STRIPE_PRIME_MONTHLY_PRICE_ID / STRIPE_PRIME_ANNUAL_PRICE_ID). Lifecycle arrives as
 *   `customer.subscription.*` webhooks through POST /api/webhooks/stripe.
 * - `dev`: test double (PAYMENT_PROVIDER=dev, never in production). Starting returns an
 *   immediate snapshot that goes through the same `applySubscriptionSnapshot` path as a
 *   Stripe webhook; POST /api/me/membership/dev simulates trial end, renewal, failure, cancel.
 */
import type Stripe from 'stripe';
import type { MembershipStatus, PrimePlan } from '../../contracts/prime';
import { assertNotProduction, env } from '../env';
import { ApiError } from '../http';
import { randomBase32 } from '../ids';
import { getStripeClient } from '../payments/stripe';
import { periodMs } from './membership-config';

/** Normalized subscription state, from a Stripe event or the dev double. */
export type SubscriptionSnapshot = {
    /** Provider event id (webhook_events idempotency). */
    eventId: string;
    /** Provider event time; older events than the last applied one are ignored. */
    occurredAt: Date;
    provider: 'stripe' | 'dev';
    subscriptionId: string;
    customerId: string | null;
    /** From subscription metadata (dm_membership_id / dm_user_id). */
    membershipId: string | null;
    userId: string | null;
    plan: PrimePlan | null;
    status: MembershipStatus;
    trialEnd: Date | null;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
    canceledAt: Date | null;
};

export type StartSubscriptionInput = {
    membershipId: string;
    userId: string;
    email: string;
    plan: PrimePlan;
    /** null = no trial (trial already used). */
    trialDays: number | null;
    customerId: string | null;
    successUrl: string;
    cancelUrl: string;
};

export type StartSubscriptionResult = { redirectUrl: string; customerId: string | null; immediate: SubscriptionSnapshot | null };

export interface MembershipBilling {
    readonly name: 'stripe' | 'dev';
    start(input: StartSubscriptionInput): Promise<StartSubscriptionResult>;
    setCancelAtPeriodEnd(input: { subscriptionId: string; cancel: boolean; current: SubscriptionSnapshot }): Promise<SubscriptionSnapshot>;
}

// ---------------------------------------------------------------------------
// Stripe
// ---------------------------------------------------------------------------

const STRIPE_STATUS: Record<string, MembershipStatus> = {
    trialing: 'trialing',
    active: 'active',
    past_due: 'past_due',
    unpaid: 'past_due',
    paused: 'past_due',
    incomplete: 'incomplete',
    incomplete_expired: 'canceled',
    canceled: 'canceled',
};

const secondsToDate = (s: number | null | undefined) => (typeof s === 'number' && s > 0 ? new Date(s * 1000) : null);

/** Pure: Stripe Subscription object -> snapshot (exported for tests). */
export function snapshotFromStripeSubscription(sub: Stripe.Subscription, event: { id: string; created: number }): SubscriptionSnapshot {
    const raw = sub as unknown as {
        current_period_end?: number;
        items?: { data?: { current_period_end?: number }[] };
    };
    const periodEnd = raw.items?.data?.[0]?.current_period_end ?? raw.current_period_end ?? null;
    const plan = sub.metadata?.dm_plan === 'annual' || sub.metadata?.dm_plan === 'monthly' ? (sub.metadata.dm_plan as PrimePlan) : null;
    return {
        eventId: event.id,
        occurredAt: new Date(event.created * 1000),
        provider: 'stripe',
        subscriptionId: sub.id,
        customerId: typeof sub.customer === 'string' ? sub.customer : (sub.customer?.id ?? null),
        membershipId: sub.metadata?.dm_membership_id ?? null,
        userId: sub.metadata?.dm_user_id ?? null,
        plan,
        status: STRIPE_STATUS[sub.status] ?? 'incomplete',
        trialEnd: secondsToDate(sub.trial_end),
        currentPeriodEnd: secondsToDate(periodEnd),
        cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
        canceledAt: secondsToDate(sub.canceled_at),
    };
}

export class StripeMembershipBilling implements MembershipBilling {
    readonly name = 'stripe' as const;

    private priceId(plan: PrimePlan): string {
        const e = env();
        const id = plan === 'annual' ? e.STRIPE_PRIME_ANNUAL_PRICE_ID : e.STRIPE_PRIME_MONTHLY_PRICE_ID;
        if (!id || !e.STRIPE_SECRET_KEY) throw new ApiError('NOT_IMPLEMENTED', 'Prime is not available yet. Please check back soon.', 503);
        return id;
    }

    async start(input: StartSubscriptionInput): Promise<StartSubscriptionResult> {
        const price = this.priceId(input.plan);
        const stripe = getStripeClient();
        const metadata = { dm_membership_id: input.membershipId, dm_user_id: input.userId, dm_plan: input.plan, dm_app: new URL(env().APP_URL).host };
        const session = await stripe.checkout.sessions.create(
            {
                mode: 'subscription',
                client_reference_id: input.membershipId,
                ...(input.customerId ? { customer: input.customerId } : { customer_email: input.email }),
                line_items: [{ price, quantity: 1 }],
                subscription_data: {
                    metadata,
                    ...(input.trialDays ? { trial_period_days: input.trialDays, trial_settings: { end_behavior: { missing_payment_method: 'cancel' } } } : {}),
                },
                payment_method_collection: 'always',
                metadata,
                success_url: input.successUrl,
                cancel_url: input.cancelUrl,
            },
            { idempotencyKey: `prime:${input.membershipId}:${input.plan}:${Math.floor(Date.now() / 600_000)}` },
        );
        if (!session.url) throw new Error('Stripe did not return a Checkout URL');
        return { redirectUrl: session.url, customerId: null, immediate: null };
    }

    async setCancelAtPeriodEnd(input: { subscriptionId: string; cancel: boolean }): Promise<SubscriptionSnapshot> {
        const stripe = getStripeClient();
        const sub = await stripe.subscriptions.update(input.subscriptionId, { cancel_at_period_end: input.cancel });
        return snapshotFromStripeSubscription(sub, { id: `api:${input.subscriptionId}:${input.cancel ? 'cancel' : 'resume'}:${Date.now()}`, created: Math.floor(Date.now() / 1000) });
    }
}

// ---------------------------------------------------------------------------
// Dev double
// ---------------------------------------------------------------------------

const DEV = 'dev membership billing';

export class DevMembershipBilling implements MembershipBilling {
    readonly name = 'dev' as const;

    constructor() {
        assertNotProduction(DEV);
    }

    async start(input: StartSubscriptionInput): Promise<StartSubscriptionResult> {
        assertNotProduction(DEV);
        const now = new Date();
        const subscriptionId = `devsub_${randomBase32(20).toLowerCase()}`;
        const customerId = input.customerId ?? `devcus_${randomBase32(20).toLowerCase()}`;
        const trialEnd = input.trialDays ? new Date(now.getTime() + input.trialDays * 86_400_000) : null;
        return {
            redirectUrl: new URL('/me/membership?welcome=1', env().APP_URL).toString(),
            customerId,
            immediate: {
                eventId: `dev:${subscriptionId}:created`,
                occurredAt: now,
                provider: 'dev',
                subscriptionId,
                customerId,
                membershipId: input.membershipId,
                userId: input.userId,
                plan: input.plan,
                status: trialEnd ? 'trialing' : 'active',
                trialEnd,
                currentPeriodEnd: trialEnd ?? new Date(now.getTime() + periodMs(input.plan)),
                cancelAtPeriodEnd: false,
                canceledAt: null,
            },
        };
    }

    async setCancelAtPeriodEnd(input: { subscriptionId: string; cancel: boolean; current: SubscriptionSnapshot }): Promise<SubscriptionSnapshot> {
        assertNotProduction(DEV);
        const now = new Date();
        return { ...input.current, eventId: `dev:${input.subscriptionId}:${input.cancel ? 'cancel' : 'resume'}:${now.getTime()}`, occurredAt: now, cancelAtPeriodEnd: input.cancel };
    }
}

export function getMembershipBilling(): MembershipBilling {
    return env().PAYMENT_PROVIDER === 'dev' ? new DevMembershipBilling() : new StripeMembershipBilling();
}
