import Stripe from 'stripe';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { MembershipResponse } from '@/contracts/prime';
import { domainEvents, memberships, membershipEvents, orderBenefits, orders, webhookEvents } from '@/server/db/schema';
import { resetEnvCache } from '@/server/env';
import { createCheckout } from '@/server/orders';
import { snapshotFromStripeSubscription, type SubscriptionSnapshot } from '@/server/prime/billing';
import { getMembershipForBenefits, getMembershipRow, processMembershipEvent, sendTrialReminders, simulateDevMembership, snapshotOf, startMembership, updateMembership } from '@/server/prime/membership';
import { GET as getMembershipRoute, PATCH as patchMembershipRoute, POST as postMembershipRoute } from '@/app/api/me/membership/route';
import { POST as postStripeWebhook } from '@/app/api/webhooks/stripe/route';
import { useTestDb as withTestDb } from '../support/db';
import { checkoutBody, createQuoteFixture, quietConsole } from '../orders/fixtures';
import { params, req, signedInUser } from '../accounts/helpers';

vi.mock('@/server/dispatch', async (orig) => ({ ...(await orig<typeof import('@/server/dispatch')>()), dispatchOrder: async () => null, expireStaleOffers: async () => 0 }));

const ctx = withTestDb({ seed: true });
beforeAll(() => quietConsole());

const viewerOf = (email: string, id: string) => ({ id, email });

describe('membership lifecycle (dev provider)', () => {
    it('starts a 7-day trial, then trial → active → cancel at period end → resume → canceled', async () => {
        const u = await signedInUser();
        const me = viewerOf(u.email!, u.userId!);
        const started = await startMembership(me, 'monthly');
        expect(started.redirectUrl).toBe('http://localhost:3100/me/membership?welcome=1');
        expect(started.membership).toMatchObject({ status: 'trialing', plan: 'monthly', isMember: true, guaranteedDates: true, cancelAtPeriodEnd: false });
        const days = (new Date(started.membership!.trialEndsAt!).getTime() - Date.now()) / 86_400_000;
        expect(days).toBeGreaterThan(6.9);
        expect(days).toBeLessThan(7.1);
        expect((await getMembershipForBenefits(u.userId))?.isMember).toBe(true);
        await expect(startMembership(me, 'annual')).rejects.toThrow(/already a Prime member/);

        const active = await simulateDevMembership(me, 'end_trial');
        expect(active).toMatchObject({ status: 'active', isMember: true });

        const scheduled = await updateMembership(me, 'cancel');
        expect(scheduled).toMatchObject({ status: 'active', cancelAtPeriodEnd: true, renewsAt: null, isMember: true });
        const resumed = await updateMembership(me, 'resume');
        expect(resumed.cancelAtPeriodEnd).toBe(false);

        const pastDue = await simulateDevMembership(me, 'payment_failed');
        expect(pastDue).toMatchObject({ status: 'past_due', isMember: false });
        expect((await getMembershipForBenefits(u.userId))?.isMember).toBe(false);
        const back = await simulateDevMembership(me, 'renew');
        expect(back.status).toBe('active');
        const canceled = await simulateDevMembership(me, 'cancel_now');
        expect(canceled).toMatchObject({ status: 'canceled', isMember: false });

        const row = (await getMembershipRow(u.userId!))!;
        const audit = await ctx.db.select().from(membershipEvents).where(eq(membershipEvents.membershipId, row.id));
        expect(audit.filter((a) => a.kind === 'status').map((a) => `${a.fromStatus}->${a.toStatus}`)).toEqual(['incomplete->trialing', 'trialing->active', 'active->past_due', 'past_due->active', 'active->canceled']);
        const events = await ctx.db.select().from(domainEvents).where(eq(domainEvents.correlationId, row.id));
        const types = events.map((e) => e.eventType);
        expect(types).toContain('membership.trial_started');
        expect(types).toContain('membership.cancel_scheduled');
        expect(types).toContain('membership.resumed');
        expect(types.filter((t) => t === 'membership.status_changed')).toHaveLength(5);

        // A second trial is never offered; re-subscribing goes straight to active.
        const again = await startMembership(me, 'annual');
        expect(again.membership).toMatchObject({ status: 'active', plan: 'annual' });
    });

    it('is idempotent per provider event and ignores stale or illegal events', async () => {
        const u = await signedInUser();
        const me = viewerOf(u.email!, u.userId!);
        await startMembership(me, 'monthly');
        const row = (await getMembershipRow(u.userId!))!;
        const later = new Date(Date.now() + 60_000);
        const toActive: SubscriptionSnapshot = { ...snapshotOf(row), eventId: 'dev:idem:1', occurredAt: later, status: 'active' };
        expect(await processMembershipEvent(toActive)).toEqual({ duplicate: false, applied: true });
        expect(await processMembershipEvent(toActive)).toEqual({ duplicate: true, applied: false });
        // An older event (out of order) does not roll the state back.
        const stale: SubscriptionSnapshot = { ...toActive, eventId: 'dev:idem:0', occurredAt: new Date(Date.now() - 60_000), status: 'trialing' };
        expect(await processMembershipEvent(stale)).toEqual({ duplicate: false, applied: false });
        expect((await getMembershipRow(u.userId!))!.status).toBe('active');
        // canceled -> past_due is not a legal transition.
        await processMembershipEvent({ ...toActive, eventId: 'dev:idem:2', occurredAt: new Date(later.getTime() + 1000), status: 'canceled' });
        expect(await processMembershipEvent({ ...toActive, eventId: 'dev:idem:3', occurredAt: new Date(later.getTime() + 2000), status: 'past_due' })).toEqual({ duplicate: false, applied: false });
        expect((await getMembershipRow(u.userId!))!.status).toBe('canceled');
    });

    it('serves the membership API (signed out: plans + timeline; signed in: start / cancel)', async () => {
        const anon = MembershipResponse.parse(await (await getMembershipRoute(req('GET', '/api/me/membership', null), params({}))).json());
        expect(anon).toMatchObject({ signedIn: false, membership: null, trialAvailable: true, trialDays: 7 });
        expect(anon.trialTimeline).toHaveLength(3);
        expect((await postMembershipRoute(req('POST', '/api/me/membership', null, { plan: 'monthly' }), params({}))).status).toBe(401);

        const u = await signedInUser();
        const res = await postMembershipRoute(req('POST', '/api/me/membership', u, { plan: 'annual' }), params({}));
        expect(res.status).toBe(201);
        const patched = MembershipResponse.parse(await (await patchMembershipRoute(req('PATCH', '/api/me/membership', u, { action: 'cancel' }), params({}))).json());
        expect(patched.membership).toMatchObject({ status: 'trialing', cancelAtPeriodEnd: true });
        expect(patched.trialAvailable).toBe(false);
    });

    it('sends the trial-ending reminder once, two days before', async () => {
        const u = await signedInUser();
        await startMembership(viewerOf(u.email!, u.userId!), 'monthly');
        const row = (await getMembershipRow(u.userId!))!;
        expect((await sendTrialReminders(new Date())).sent).toBe(0); // 7 days out
        const fiveDaysOn = new Date(row.trialEndsAt!.getTime() - 36 * 3600_000);
        const first = await sendTrialReminders(fiveDaysOn);
        expect(first.sent).toBeGreaterThanOrEqual(1);
        expect((await getMembershipRow(u.userId!))!.trialReminderSentAt).not.toBeNull();
        const again = await sendTrialReminders(fiveDaysOn);
        expect(again.sent).toBe(0);
    });

    it('applies member benefits at checkout and flags the order for priority', async () => {
        const u = await signedInUser();
        await startMembership(viewerOf(u.email!, u.userId!), 'monthly');
        const { quote } = await createQuoteFixture(ctx.db, { quantity: 20, unitPriceCents: 500 }); // subtotal 10000 >= 7500
        const membership = await getMembershipForBenefits(u.userId);
        const res = await createCheckout(checkoutBody(quote.id), { buyerUserId: u.userId, membership });
        expect(res.totals.shippingCents).toBe(0);
        const materialLine = quote.lineItems.find((l) => l.code === 'MATERIAL')!.totalCents;
        expect(res.totals.subtotalCents).toBe(quote.subtotalCents - Math.floor(materialLine * 0.1));
        const [order] = await ctx.db.select().from(orders).where(eq(orders.id, res.orderId));
        expect(order.shopCostCents).toBe(quote.shopCostCents);
        expect(order.shopCostCents + order.platformFeeCents).toBe(order.subtotalCents);
        const [flags] = await ctx.db.select().from(orderBenefits).where(eq(orderBenefits.orderId, res.orderId));
        expect(flags).toMatchObject({ priority: true, guaranteedDates: true, shippingWaivedCents: 1500 });

        // Non-member: snapshot price, no flags.
        const { quote: q2 } = await createQuoteFixture(ctx.db, { quantity: 20, unitPriceCents: 500 });
        const plain = await createCheckout(checkoutBody(q2.id), {});
        expect(plain.totals).toMatchObject({ subtotalCents: q2.subtotalCents, shippingCents: 1500 });
        expect(await ctx.db.select().from(orderBenefits).where(eq(orderBenefits.orderId, plain.orderId))).toHaveLength(0);
    });
});

describe('Stripe Billing webhooks (customer.subscription.*)', () => {
    const SECRET = 'whsec_test_prime';
    beforeAll(() => {
        process.env.STRIPE_WEBHOOK_SECRET = SECRET;
        resetEnvCache();
    });

    function signed(event: object) {
        const payload = JSON.stringify(event);
        const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
        return new Request('http://localhost:3100/api/webhooks/stripe', { method: 'POST', headers: { 'stripe-signature': header, 'content-type': 'application/json' }, body: payload });
    }

    function subscriptionEvent(id: string, created: number, sub: Record<string, unknown>) {
        return { id, object: 'event', type: 'customer.subscription.updated', created, data: { object: { object: 'subscription', ...sub } } };
    }

    it('normalizes a Stripe subscription (items period end, statuses)', () => {
        const snap = snapshotFromStripeSubscription(
            { id: 'sub_1', status: 'unpaid', customer: 'cus_1', trial_end: null, cancel_at_period_end: false, canceled_at: null, metadata: { dm_membership_id: 'mem_x', dm_user_id: 'usr_x', dm_plan: 'annual' }, items: { data: [{ current_period_end: 1_900_000_000 }] } } as unknown as Stripe.Subscription,
            { id: 'evt_1', created: 1_800_000_000 },
        );
        expect(snap).toMatchObject({ status: 'past_due', plan: 'annual', membershipId: 'mem_x', subscriptionId: 'sub_1', customerId: 'cus_1' });
        expect(snap.currentPeriodEnd?.toISOString()).toBe(new Date(1_900_000_000_000).toISOString());
    });

    it('applies a verified subscription event exactly once (replay is a no-op)', async () => {
        const u = await signedInUser();
        await ctx.db.insert(memberships).values({ userId: u.userId!, email: u.email!, plan: 'monthly', status: 'incomplete', provider: 'stripe' });
        const row = (await getMembershipRow(u.userId!))!;
        const now = Math.floor(Date.now() / 1000);
        const base = { id: 'sub_prime_1', customer: 'cus_prime_1', cancel_at_period_end: false, canceled_at: null, metadata: { dm_membership_id: row.id, dm_user_id: u.userId, dm_plan: 'monthly' }, items: { data: [{ current_period_end: now + 7 * 86400 }] } };
        const trialing = subscriptionEvent('evt_prime_trial', now, { ...base, status: 'trialing', trial_end: now + 7 * 86400 });
        expect((await postStripeWebhook(signed(trialing), params({}))).status).toBe(200);
        expect((await getMembershipRow(u.userId!))!).toMatchObject({ status: 'trialing', providerSubscriptionId: 'sub_prime_1', trialUsed: true });
        expect((await postStripeWebhook(signed(trialing), params({}))).status).toBe(200);
        const processed = await ctx.db.select().from(webhookEvents).where(and(eq(webhookEvents.provider, 'stripe'), eq(webhookEvents.eventId, 'evt_prime_trial')));
        expect(processed).toHaveLength(1);
        const statusEvents = await ctx.db.select().from(membershipEvents).where(eq(membershipEvents.membershipId, row.id));
        expect(statusEvents).toHaveLength(1);

        const activeEvt = subscriptionEvent('evt_prime_active', now + 10, { ...base, status: 'active', trial_end: now - 1 });
        await postStripeWebhook(signed(activeEvt), params({}));
        const deleted = { ...subscriptionEvent('evt_prime_deleted', now + 20, { ...base, status: 'canceled', canceled_at: now + 20 }), type: 'customer.subscription.deleted' };
        await postStripeWebhook(signed(deleted), params({}));
        expect((await getMembershipRow(u.userId!))!.status).toBe('canceled');

        const bad = signed(trialing);
        const tampered = new Request(bad.url, { method: 'POST', headers: { 'stripe-signature': 't=1,v1=deadbeef' }, body: JSON.stringify(trialing) });
        expect((await postStripeWebhook(tampered, params({}))).status).toBe(400);
    });
});
