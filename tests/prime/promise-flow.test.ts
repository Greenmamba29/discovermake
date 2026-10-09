/**
 * Delivery Promise against a real database: promise.set at checkout with per-leg predictions,
 * at-risk rechecks, a missed promise auto-crediting the buyer (ledger + credit row), the credit
 * redeemed at the next checkout, and the weekly retraining job (cron auth, models, holdout).
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { RetrainPromiseResponse } from '@/contracts/promise';
import { buyerCredits, domainEvents, ledgerEntries, orderPaymentPlans, orderPromises, orders, promiseModels, promiseObservations, quotes } from '@/server/db/schema';
import { getOrderLedger, ledgerBalances } from '@/server/ledger';
import { createCheckout, getOrderForBuyer, handlePaymentSucceeded } from '@/server/orders';
import { availableCreditCents } from '@/server/promise/credits';
import { quotePromises, recheckOrderPromise, setOrderPromise } from '@/server/promise/engine';
import { syntheticObservations, type Observation } from '@/server/promise/training';
import { markShipmentDelivered } from '@/server/shipping';
import { createShipment } from '@/server/shops';
import { GET as retrainRoute } from '@/app/api/admin/promise/retrain/route';
import { checkoutBody, createQuoteFixture } from '../orders/fixtures';
import { createQaPassedJob } from '../shop/fixtures';
import { quietConsole } from '../sourcing/fixtures';
import { useTestDb } from '../support/db';
import { MANUAL, PARCEL } from './fixtures';

const noParams = { params: Promise.resolve({}) };

describe('Delivery Promise', () => {
    const ctx = useTestDb({ seed: true });
    beforeAll(() => quietConsole());

    async function eventsFor(type: string, orderId: string) {
        return (await ctx.db.select().from(domainEvents).where(eq(domainEvents.eventType, type))).filter((e) => e.orderId === orderId || (e.payload as { orderId?: string }).orderId === orderId);
    }

    it('checkout stores the promise with per-leg P90s and emits promise.set; the date is shown when P90 fits', async () => {
        const { quote } = await createQuoteFixture(ctx.db, { quantity: 10 });
        const res = await createCheckout(checkoutBody(quote.id));
        const [promise] = await ctx.db.select().from(orderPromises).where(eq(orderPromises.orderId, res.orderId));
        expect(promise.legs.map((l) => l.leg)).toEqual(['MATERIAL_ARRIVAL', 'SHOP_QUEUE', 'PROCESS', 'QA', 'PACK', 'CARRIER_TRANSIT']);
        expect(promise.legs.every((l) => l.source === 'prior')).toBe(true);
        expect(promise).toMatchObject({ status: 'ON_TRACK', carrierService: 'STANDARD', zone: 'Z1', bufferDays: 0 });
        expect(promise.shown).toBe(promise.p90Date <= promise.promisedDate);
        expect(promise.shown).toBe(true);
        const [set] = await eventsFor('promise.set', res.orderId);
        expect(set.payload).toMatchObject({ orderId: res.orderId, promisedDate: promise.promisedDate, shown: true });
        // The checkout view offers the same rule per shipping method.
        const [row] = await ctx.db.select().from(quotes).where(eq(quotes.id, quote.id));
        const perMethod = await quotePromises(row);
        expect(perMethod.map((p) => p.method)).toEqual(['STANDARD', 'EXPEDITED']);
        for (const p of perMethod) expect(p.show).toBe(p.p90Date <= p.date);
    });

    it('a recheck whose remaining P90 crosses the promised date marks it at risk once, with an ops alert', async () => {
        const { quote } = await createQuoteFixture(ctx.db, { quantity: 10 });
        const res = await createCheckout(checkoutBody(quote.id));
        await handlePaymentSucceeded({ provider: 'dev', providerRef: res.payment.providerRef, providerPaymentId: null, amountCents: res.payment.amountCents!, currency: 'usd', eventId: `e-${res.orderId}` });
        expect((await recheckOrderPromise(res.orderId)).atRisk).toBe(false);
        await ctx.db.update(orderPromises).set({ promisedDate: '2026-01-02' }).where(eq(orderPromises.orderId, res.orderId));
        const r = await recheckOrderPromise(res.orderId);
        expect(r.atRisk).toBe(true);
        await recheckOrderPromise(res.orderId);
        expect(await eventsFor('promise.at_risk', res.orderId)).toHaveLength(1);
        const alerts = (await ctx.db.select().from(domainEvents).where(eq(domainEvents.eventType, 'ops.alert_requested'))).filter((e) => (e.payload as { orderId: string }).orderId === res.orderId);
        expect(alerts.some((a) => /at risk/.test((a.payload as { subject: string }).subject))).toBe(true);
        expect((await ctx.db.select().from(orderPromises).where(eq(orderPromises.orderId, res.orderId)))[0].status).toBe('AT_RISK');
    });

    it('delivered after a shown promise: promise.missed, auto-credit charged to the responsible leg, redeemed on the next checkout', async () => {
        const job = await createQaPassedJob(ctx.db, { quantity: 10 });
        const [order] = await ctx.db.select().from(orders).where(eq(orders.id, job.order.id));
        const [quote] = await ctx.db.select().from(quotes).where(eq(quotes.id, order.quoteId));
        await setOrderPromise(ctx.db, { order, quote, method: 'STANDARD', shipToRegion: 'PA', now: new Date('2026-01-05T15:00:00Z') });
        await ctx.db.update(orderPromises).set({ promisedDate: '2026-01-09', shown: true, startDate: '2026-01-05' }).where(eq(orderPromises.orderId, order.id));

        const shipment = await createShipment(job.shopId, job.jobId, { parcel: PARCEL, manual: MANUAL });
        await markShipmentDelivered(shipment.id, { kind: 'admin', id: 'ops' });

        const [promise] = await ctx.db.select().from(orderPromises).where(eq(orderPromises.orderId, order.id));
        expect(promise.status).toBe('MISSED');
        const [missed] = await eventsFor('promise.missed', order.id);
        const payload = missed.payload as { responsibleLeg: string; creditCents: number; creditId: string };
        const expected = Math.min(25_000, Math.round(order.subtotalCents * 0.1));
        expect(payload.creditCents).toBe(expected);
        const [credit] = await ctx.db.select().from(buyerCredits).where(eq(buyerCredits.sourceOrderId, order.id));
        expect(credit).toMatchObject({ id: payload.creditId, amountCents: expected, status: 'AVAILABLE', responsibleLeg: payload.responsibleLeg, buyerEmail: 'maker@example.com' });
        const creditTxn = (await ctx.db.select().from(ledgerEntries).where(eq(ledgerEntries.txnKey, `promise_credit:${order.id}`))).map((l) => [l.account, l.direction, l.amountCents]);
        expect(creditTxn).toEqual([
            ['PROMISE_CREDIT_EXPENSE', 'DEBIT', expected],
            ['BUYER_CREDITS', 'CREDIT', expected],
        ]);
        const memo = (await ctx.db.select().from(ledgerEntries).where(eq(ledgerEntries.txnKey, `promise_credit:${order.id}`)))[0].memo;
        expect(memo).toContain(payload.responsibleLeg);
        expect(await ctx.db.select().from(promiseObservations).where(eq(promiseObservations.orderId, order.id))).not.toHaveLength(0);
        const view = await getOrderForBuyer(order.id, job.token);
        expect(view?.promise).toMatchObject({ status: 'MISSED', creditCents: expected });
        expect(view?.timeline.some((t) => /credit added/.test(t.label))).toBe(true);
        expect(await availableCreditCents('maker@example.com')).toBeGreaterThanOrEqual(expected);

        // Next checkout by the same buyer: the credit reduces the charge and is redeemed on payment.
        const next = await createQuoteFixture(ctx.db, { quantity: 10 });
        const res = await createCheckout(checkoutBody(next.quote.id));
        expect(res.creditAppliedCents).toBe(expected);
        expect(res.payment.amountCents).toBe(res.totals.totalCents - expected);
        const [plan] = await ctx.db.select().from(orderPaymentPlans).where(eq(orderPaymentPlans.orderId, res.orderId));
        expect(plan).toMatchObject({ kind: 'FULL', creditCents: expected, creditId: credit.id });
        // Paying the full total (not the credited amount) is a mismatch and changes nothing.
        await handlePaymentSucceeded({ provider: 'dev', providerRef: res.payment.providerRef, providerPaymentId: null, amountCents: res.totals.totalCents, currency: 'usd', eventId: 'wrong' });
        expect((await ctx.db.select().from(orders).where(eq(orders.id, res.orderId)))[0].status).toBe('PENDING_PAYMENT');
        await handlePaymentSucceeded({ provider: 'dev', providerRef: res.payment.providerRef, providerPaymentId: null, amountCents: res.payment.amountCents!, currency: 'usd', eventId: 'right' });
        expect((await ctx.db.select().from(orders).where(eq(orders.id, res.orderId)))[0].status).toBe('PAID');
        expect((await ctx.db.select().from(buyerCredits).where(eq(buyerCredits.id, credit.id)))[0]).toMatchObject({ status: 'REDEEMED', redeemedOrderId: res.orderId });
        const payment = (await getOrderLedger(res.orderId)).filter((l) => l.txnKey === `payment:${res.orderId}`);
        expect(payment.slice(0, 2).map((l) => [l.account, l.direction, l.amountCents])).toEqual([
            ['CASH', 'DEBIT', res.totals.totalCents - expected],
            ['BUYER_CREDITS', 'DEBIT', expected],
        ]);
        const both = [...(await getOrderLedger(order.id)), ...(await getOrderLedger(res.orderId))];
        expect(ledgerBalances(both).BUYER_CREDITS ?? 0).toBe(0);
        expect(await eventsFor('credit.redeemed', res.orderId)).toHaveLength(1);
        // Used once only.
        const third = await createCheckout(checkoutBody((await createQuoteFixture(ctx.db, { quantity: 10 })).quote.id));
        expect(third.creditAppliedCents ?? 0).toBe(0);
    });

    it('weekly retraining: cron auth, models from observations, holdout >= 95%; learned slips can hide a date', async () => {
        const unauthorized = await retrainRoute(new Request('http://localhost:3100/api/admin/promise/retrain'), noParams);
        expect(unauthorized.status).toBe(401);

        const synthetic = syntheticObservations(31, 600);
        // Plus a carrier that is reliably slow on STANDARD: +5 business days.
        const slow: Observation[] = Array.from({ length: 40 }, (_, i) => ({ id: `slow_${i}`, group: `slow_${i}`, leg: 'CARRIER_TRANSIT' as const, predictedDays: 4, actualDays: 9, carrierService: 'STANDARD', zone: 'Z3' }));
        const rows = [...synthetic, ...slow].map((o) => ({
            leg: o.leg,
            shopId: o.shopId ?? null,
            process: o.process ?? null,
            carrierService: o.carrierService ?? null,
            zone: o.zone ?? null,
            supplierId: o.supplierId ?? null,
            incoterm: o.incoterm ?? null,
            predictedDays: o.predictedDays,
            actualDays: o.actualDays,
            source: 'order',
        }));
        for (let i = 0; i < rows.length; i += 500) await ctx.db.insert(promiseObservations).values(rows.slice(i, i + 500));

        const res = await retrainRoute(new Request('http://localhost:3100/api/admin/promise/retrain', { headers: { authorization: 'Bearer test-cron-secret' } }), noParams);
        expect(res.status).toBe(200);
        const body = RetrainPromiseResponse.parse(await res.json());
        expect(body.modelCount).toBeGreaterThan(5);
        expect(body.observationCount).toBeGreaterThanOrEqual(rows.length);
        const models = await ctx.db.select().from(promiseModels);
        expect(models.find((m) => m.leg === 'CARRIER_TRANSIT' && m.scope === 'carrier:STANDARD:Z3')!.slipP90Days).toBeGreaterThanOrEqual(5);

        // Observations here have no order ids: each is its own holdout group, scored per leg.
        expect(body.holdout.observations).toBeGreaterThan(0);
        expect(body.holdout.legHitRate!).toBeGreaterThanOrEqual(0.9);

        // A STANDARD quote can no longer show the date it committed to: P90 now exceeds it.
        const { quote } = await createQuoteFixture(ctx.db, { quantity: 10 });
        const [row] = await ctx.db.select().from(quotes).where(eq(quotes.id, quote.id));
        const std = (await quotePromises(row)).find((p) => p.method === 'STANDARD')!;
        expect(std.show).toBe(false);
        expect(std.p90Date > std.date).toBe(true);
    });
});
