/**
 * Prime membership lifecycle (signed-in users only).
 *
 *   incomplete ─► trialing ─► active ─► past_due ─► canceled
 *        │            │          ▲          │
 *        └────────────┴──────────┴──────────┘  (cancel from any live state; past_due → active on payment)
 *
 * The provider (Stripe Billing, or the dev double) is the source of truth. Every change
 * arrives as a `SubscriptionSnapshot` and is applied by `applySubscriptionSnapshot`:
 *   - exactly once per provider event (`webhook_events` dedupe in `processMembershipEvent`);
 *   - in order (an event older than `last_event_at` is ignored);
 *   - only along the transitions above (anything else is logged and ignored);
 *   - with `membership_events` audit rows and `membership.*` domain events in the same tx.
 */
import { and, eq, isNull, lte, gt } from 'drizzle-orm';
import type { Actor } from '../../contracts/common';
import type { MembershipResponse, MembershipStatus, MembershipView, PrimePlan } from '../../contracts/prime';
import { getDb, withTx, type DbOrTx } from '../db';
import { memberships, membershipEvents } from '../db/schema';
import { env } from '../env';
import { emitEvent } from '../events/outbox';
import { ApiError } from '../http';
import { newId } from '../ids';
import { sendR3Mail } from '../r3/mail';
import { processOnce } from '../r3/webhook-dedupe';
import type { MembershipForBenefits } from './benefits';
import { getMembershipBilling, type SubscriptionSnapshot } from './billing';
import { isMemberStatus, periodMs, primeBenefits, primePlans, primePrices, TRIAL_REMINDER_DAYS_BEFORE, trialDays, trialTimeline } from './membership-config';

export type MembershipRow = typeof memberships.$inferSelect;
export type MembershipViewer = { id: string; email: string };

export const MEMBERSHIP_TRANSITIONS: Readonly<Record<MembershipStatus, readonly MembershipStatus[]>> = {
    incomplete: ['trialing', 'active', 'canceled'],
    trialing: ['active', 'past_due', 'canceled'],
    active: ['past_due', 'canceled'],
    past_due: ['active', 'canceled'],
    canceled: ['incomplete', 'active'],
};

export function canMembershipTransition(from: MembershipStatus, to: MembershipStatus): boolean {
    return from === to || MEMBERSHIP_TRANSITIONS[from].includes(to);
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function toMembershipView(row: MembershipRow): MembershipView {
    const isMember = isMemberStatus(row.status);
    const b = primeBenefits();
    const renewsAt = isMember && !row.cancelAtPeriodEnd ? (row.status === 'trialing' ? row.trialEndsAt : row.currentPeriodEnd) : null;
    return {
        id: row.id,
        status: row.status,
        plan: row.plan,
        isMember,
        trialEndsAt: iso(row.trialEndsAt),
        currentPeriodEnd: iso(row.currentPeriodEnd),
        renewsAt: iso(renewsAt),
        cancelAtPeriodEnd: row.cancelAtPeriodEnd,
        canceledAt: iso(row.canceledAt),
        provider: row.provider,
        guaranteedDates: isMember && b.guaranteedDates,
        earlyAccess: isMember && b.earlyAccess,
        priorityQueue: isMember && b.priorityQueue,
    };
}

export async function getMembershipRow(userId: string, db: DbOrTx = getDb()): Promise<MembershipRow | null> {
    const [row] = await db.select().from(memberships).where(eq(memberships.userId, userId)).limit(1);
    return row ?? null;
}

/** Benefits input for checkout (null when signed out / no membership). */
export async function getMembershipForBenefits(userId: string | null | undefined): Promise<MembershipForBenefits> {
    if (!userId) return null;
    const row = await getMembershipRow(userId);
    if (!row) return null;
    return { isMember: isMemberStatus(row.status), membershipId: row.id, benefits: primeBenefits() };
}

/**
 * Public membership flags for other modules (e.g. the Delivery Promise engine reads
 * `guaranteedDates`, Live reads `earlyAccess`). Null when the user has no membership.
 */
export async function getMembership(userId: string): Promise<MembershipView | null> {
    const row = await getMembershipRow(userId);
    return row ? toMembershipView(row) : null;
}

export async function getMembershipResponse(viewer: MembershipViewer | null, now: Date = new Date()): Promise<MembershipResponse> {
    const row = viewer ? await getMembershipRow(viewer.id) : null;
    return {
        signedIn: Boolean(viewer),
        membership: row ? toMembershipView(row) : null,
        trialAvailable: !row?.trialUsed,
        trialDays: trialDays(),
        plans: primePlans(),
        benefits: primeBenefits(),
        trialTimeline: trialTimeline(now, trialDays(), row?.plan ?? 'monthly'),
    };
}

function buyerActor(userId: string): Actor {
    return { kind: 'buyer', id: userId };
}

/** Start a membership: Stripe Checkout (subscription mode) or the dev double. */
export async function startMembership(viewer: MembershipViewer, plan: PrimePlan): Promise<{ redirectUrl: string; membership: MembershipView | null }> {
    const db = getDb();
    const billing = getMembershipBilling();
    let row = await getMembershipRow(viewer.id);
    if (row && isMemberStatus(row.status)) throw new ApiError('CONFLICT', 'You are already a Prime member.');
    if (row && row.status === 'past_due') throw new ApiError('CONFLICT', 'Your last Prime payment failed. Update your payment method from Membership.');
    if (!row) {
        await db
            .insert(memberships)
            .values({ id: newId('membership'), userId: viewer.id, email: viewer.email, plan, status: 'incomplete', provider: billing.name })
            .onConflictDoNothing({ target: memberships.userId });
        row = (await getMembershipRow(viewer.id))!;
    } else {
        await db.update(memberships).set({ plan, email: viewer.email, provider: billing.name }).where(eq(memberships.id, row.id));
    }
    const appUrl = env().APP_URL;
    const result = await billing.start({
        membershipId: row.id,
        userId: viewer.id,
        email: viewer.email,
        plan,
        trialDays: row.trialUsed ? null : trialDays(),
        customerId: row.provider === billing.name ? row.providerCustomerId : null,
        successUrl: new URL('/me/membership?welcome=1', appUrl).toString(),
        cancelUrl: new URL('/prime?cancelled=1', appUrl).toString(),
    });
    if (result.immediate) await processMembershipEvent(result.immediate, buyerActor(viewer.id));
    const fresh = await getMembershipRow(viewer.id);
    return { redirectUrl: result.redirectUrl, membership: fresh ? toMembershipView(fresh) : null };
}

/** Cancel at period end, or resume a scheduled cancellation. */
export async function updateMembership(viewer: MembershipViewer, action: 'cancel' | 'resume'): Promise<MembershipView> {
    const row = await getMembershipRow(viewer.id);
    if (!row || !row.providerSubscriptionId) throw new ApiError('NOT_FOUND', 'You do not have a Prime membership.');
    if (action === 'cancel' && !(isMemberStatus(row.status) || row.status === 'past_due')) throw new ApiError('CONFLICT', 'This membership is not active.');
    if (action === 'resume' && !(isMemberStatus(row.status) && row.cancelAtPeriodEnd)) throw new ApiError('CONFLICT', 'There is no scheduled cancellation to undo.');
    const billing = getMembershipBilling();
    if (billing.name !== row.provider) throw new ApiError('CONFLICT', 'This membership is managed by another payment provider.');
    const snapshot = await billing.setCancelAtPeriodEnd({ subscriptionId: row.providerSubscriptionId, cancel: action === 'cancel', current: snapshotOf(row) });
    await processMembershipEvent(snapshot, buyerActor(viewer.id));
    return toMembershipView((await getMembershipRow(viewer.id))!);
}

/** Current row as a snapshot (dev simulations, API-side updates). */
export function snapshotOf(row: MembershipRow): SubscriptionSnapshot {
    return {
        eventId: '',
        occurredAt: new Date(),
        provider: row.provider,
        subscriptionId: row.providerSubscriptionId ?? '',
        customerId: row.providerCustomerId,
        membershipId: row.id,
        userId: row.userId,
        plan: row.plan,
        status: row.status,
        trialEnd: row.trialEndsAt,
        currentPeriodEnd: row.currentPeriodEnd,
        cancelAtPeriodEnd: row.cancelAtPeriodEnd,
        canceledAt: row.canceledAt,
    };
}

/** Exactly-once wrapper (webhook_events) around applySubscriptionSnapshot. */
export async function processMembershipEvent(s: SubscriptionSnapshot, actor?: Actor): Promise<{ duplicate: boolean; applied: boolean }> {
    const r = await processOnce(s.provider, s.eventId, 'membership.subscription', { ...s, occurredAt: s.occurredAt.toISOString() }, () => applySubscriptionSnapshot(s, actor));
    return r.duplicate ? { duplicate: true, applied: false } : { duplicate: false, applied: r.result };
}

/** Apply a provider snapshot. Returns false when it was ignored (stale, unknown, illegal). */
export async function applySubscriptionSnapshot(s: SubscriptionSnapshot, actor: Actor = { kind: 'payment_provider', id: s.provider }): Promise<boolean> {
    return withTx(async (tx) => {
        let row: MembershipRow | undefined;
        if (s.subscriptionId) [row] = await tx.select().from(memberships).where(and(eq(memberships.provider, s.provider), eq(memberships.providerSubscriptionId, s.subscriptionId))).for('update');
        if (!row && s.membershipId) [row] = await tx.select().from(memberships).where(eq(memberships.id, s.membershipId)).for('update');
        if (!row && s.userId) [row] = await tx.select().from(memberships).where(eq(memberships.userId, s.userId)).for('update');
        if (!row) {
            console.warn(`[prime] subscription ${s.subscriptionId} matches no membership; ignored`);
            return false;
        }
        if (row.lastEventAt && s.occurredAt.getTime() < row.lastEventAt.getTime()) return false;
        // A different subscription may only replace a finished one (re-subscribe after cancel).
        if (row.providerSubscriptionId && s.subscriptionId && row.providerSubscriptionId !== s.subscriptionId && !(row.status === 'canceled' || row.status === 'incomplete')) {
            console.warn(`[prime] ignoring event for old subscription ${s.subscriptionId} on membership ${row.id}`);
            return false;
        }
        const from = row.status;
        const to = s.status;
        if (!canMembershipTransition(from, to)) {
            console.warn(`[prime] illegal membership transition ${from} -> ${to} on ${row.id}; ignored`);
            return false;
        }
        const now = new Date();
        const trialStarting = to === 'trialing' && from !== 'trialing';
        const update: Partial<typeof memberships.$inferInsert> = {
            status: to,
            providerSubscriptionId: s.subscriptionId || row.providerSubscriptionId,
            providerCustomerId: s.customerId ?? row.providerCustomerId,
            plan: s.plan ?? row.plan,
            trialEndsAt: s.trialEnd ?? row.trialEndsAt,
            currentPeriodEnd: s.currentPeriodEnd ?? row.currentPeriodEnd,
            cancelAtPeriodEnd: to === 'canceled' ? false : s.cancelAtPeriodEnd,
            canceledAt: to === 'canceled' ? (s.canceledAt ?? row.canceledAt ?? now) : null,
            lastEventAt: s.occurredAt,
            updatedAt: now,
        };
        if (trialStarting || s.trialEnd) update.trialUsed = true;
        if (trialStarting) {
            update.trialStartedAt = now;
            update.trialReminderSentAt = null;
        }
        await tx.update(memberships).set(update).where(eq(memberships.id, row.id));

        const ctx = { actor, correlationId: row.id };
        if (from !== to) {
            await tx.insert(membershipEvents).values({ membershipId: row.id, kind: 'status', fromStatus: from, toStatus: to, providerEventId: s.eventId || null });
            await emitEvent(tx, { type: 'membership.status_changed', payload: { membershipId: row.id, userId: row.userId, from, to, providerEventId: s.eventId || null }, ...ctx });
            if (trialStarting) {
                await emitEvent(tx, {
                    type: 'membership.trial_started',
                    payload: { membershipId: row.id, userId: row.userId, plan: update.plan ?? row.plan, trialEndsAt: (update.trialEndsAt ?? now).toISOString() },
                    ...ctx,
                });
            }
        }
        if (to !== 'canceled' && s.cancelAtPeriodEnd !== row.cancelAtPeriodEnd) {
            await tx.insert(membershipEvents).values({ membershipId: row.id, kind: s.cancelAtPeriodEnd ? 'cancel_scheduled' : 'resumed', fromStatus: from, toStatus: to, providerEventId: s.eventId || null });
            if (s.cancelAtPeriodEnd) {
                const effective = to === 'trialing' ? (update.trialEndsAt ?? null) : (update.currentPeriodEnd ?? null);
                await emitEvent(tx, { type: 'membership.cancel_scheduled', payload: { membershipId: row.id, userId: row.userId, effectiveAt: iso(effective) }, ...ctx });
            } else {
                await emitEvent(tx, { type: 'membership.resumed', payload: { membershipId: row.id, userId: row.userId }, ...ctx });
            }
        }
        return true;
    });
}

/** Dev double: simulate what Stripe Billing would send next. */
export async function simulateDevMembership(viewer: MembershipViewer, action: 'end_trial' | 'renew' | 'payment_failed' | 'cancel_now'): Promise<MembershipView> {
    const row = await getMembershipRow(viewer.id);
    if (!row || row.provider !== 'dev' || !row.providerSubscriptionId) throw new ApiError('NOT_FOUND', 'No dev membership to simulate.');
    const now = new Date();
    const base = { ...snapshotOf(row), eventId: `dev:${row.providerSubscriptionId}:${action}:${now.getTime()}`, occurredAt: now };
    let next: SubscriptionSnapshot;
    switch (action) {
        case 'end_trial':
            if (row.status !== 'trialing') throw new ApiError('CONFLICT', 'The membership is not trialing.');
            next = row.cancelAtPeriodEnd ? { ...base, status: 'canceled', canceledAt: now } : { ...base, status: 'active', currentPeriodEnd: new Date(now.getTime() + periodMs(row.plan)) };
            break;
        case 'renew': {
            const from = Math.max(now.getTime(), row.currentPeriodEnd?.getTime() ?? now.getTime());
            next = { ...base, status: 'active', currentPeriodEnd: new Date(from + periodMs(row.plan)) };
            break;
        }
        case 'payment_failed':
            next = { ...base, status: 'past_due' };
            break;
        case 'cancel_now':
            next = { ...base, status: 'canceled', canceledAt: now };
            break;
    }
    await processMembershipEvent(next, { kind: 'payment_provider', id: 'dev' });
    return toMembershipView((await getMembershipRow(viewer.id))!);
}

/**
 * Trial-ending reminders (cron-safe, idempotent): trials ending within the next
 * TRIAL_REMINDER_DAYS_BEFORE days that have not been reminded get one email.
 */
export async function sendTrialReminders(now: Date = new Date()): Promise<{ sent: number }> {
    const db = getDb();
    const horizon = new Date(now.getTime() + TRIAL_REMINDER_DAYS_BEFORE * 86_400_000);
    const due = await db
        .select()
        .from(memberships)
        .where(and(eq(memberships.status, 'trialing'), isNull(memberships.trialReminderSentAt), gt(memberships.trialEndsAt, now), lte(memberships.trialEndsAt, horizon)))
        .limit(500);
    let sent = 0;
    for (const m of due) {
        // Claim first so overlapping cron runs never double-send.
        const claimed = await withTx(async (tx) => {
            const [locked] = await tx.update(memberships).set({ trialReminderSentAt: now }).where(and(eq(memberships.id, m.id), isNull(memberships.trialReminderSentAt))).returning();
            if (!locked) return false;
            await emitEvent(tx, {
                type: 'membership.trial_reminder_sent',
                payload: { membershipId: m.id, userId: m.userId, trialEndsAt: m.trialEndsAt!.toISOString() },
                actor: { kind: 'system', id: 'prime-reminders' },
                correlationId: m.id,
            });
            return true;
        });
        if (!claimed) continue;
        const price = primePrices()[m.plan];
        const date = m.trialEndsAt!.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
        await sendR3Mail({
            to: m.email,
            subject: 'Your DiscoverMake Prime trial ends in 2 days',
            paragraphs: [
                `Your free trial ends on ${date}. ${m.cancelAtPeriodEnd ? 'You already cancelled, so you will not be charged.' : `Your ${m.plan} plan then starts at $${(price / 100).toFixed(2)}${m.plan === 'annual' ? ' per year' : ' per month'}.`}`,
                'Not for you? Cancel in one tap before the trial ends and you pay nothing.',
            ],
            link: { label: 'Manage membership', href: new URL('/me/membership', env().APP_URL).toString() },
            idempotencyKey: `prime-trial-reminder:${m.id}:${m.trialEndsAt!.toISOString()}`,
        });
        sent++;
    }
    return { sent };
}
