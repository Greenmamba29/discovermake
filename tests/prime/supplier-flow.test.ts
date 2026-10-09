/**
 * Supplier-route ordering end to end against a real database: binding quote from an approved
 * supplier-confirmed offer (no supplier identity for buyers), deposit at checkout (idempotent
 * payment events), PO + supplier deposit approvals (no leg without approval), the leg through
 * production, inbound freight, receiving + QA at receipt (fail -> rework -> pass), balance at
 * shipment, delivery, payouts, ledger and the promise outcome.
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { QuoteView } from '@/contracts/quotes';
import { OrderView } from '@/contracts/orders';
import { DEV_SHOP_ID } from '@/server/db/seed';
import {
    approvals,
    domainEvents,
    inspectionPlans,
    ledgerEntries,
    manufacturingJobs,
    orderPaymentPlans,
    orderPromises,
    orders,
    payouts,
    promiseObservations,
    supplierLegs,
    supplierQuotes,
} from '@/server/db/schema';
import { ApiError } from '@/server/http';
import { getOrderLedger, ledgerBalances } from '@/server/ledger';
import { createCheckout, getOrderForBuyer, handlePaymentSucceeded, refundOrder } from '@/server/orders';
import { advanceSupplierLeg, receiveFreight } from '@/server/prime/fulfilment';
import { createSupplierBindingQuote } from '@/server/prime/quotes';
import { markShipmentDelivered } from '@/server/shipping';
import { createShipment, listJobs, recordMilestone, submitInspection } from '@/server/shops';
import { decideApproval } from '@/server/sourcing/approvals';
import { POST as quoteRoute } from '@/app/api/builds/[buildId]/sourcing/offers/[offerId]/quote/route';
import { GET as getQuoteRoute } from '@/app/api/quotes/[quoteId]/route';
import { checkoutBody } from '../orders/fixtures';
import { measurementsFor, uploadQaPhoto } from '../shop/fixtures';
import { params, quietConsole, req } from '../sourcing/fixtures';
import { useTestDb } from '../support/db';
import { ADMIN, approvedOffer, bindingSupplierQuote, depositPaidOrder, MANUAL, PARCEL, pendingBalance, payPending, poApprovals } from './fixtures';

async function rejects(p: Promise<unknown>): Promise<ApiError> {
    return p.then(
        () => {
            throw new Error('expected a rejection');
        },
        (e: unknown) => e as ApiError,
    );
}

describe('supplier-route ordering', () => {
    const ctx = useTestDb({ seed: true });
    beforeAll(() => quietConsole());

    async function events(type: string, orderId?: string) {
        const rows = await ctx.db.select().from(domainEvents).where(eq(domainEvents.eventType, type));
        return orderId ? rows.filter((r) => (r.payload as { orderId?: string }).orderId === orderId) : rows;
    }

    it('binding quote: only for an approved selection; full composition stored; buyer view hides the supplier; idempotent', async () => {
        const a = await approvedOffer(ctx.db);
        expect((await events('quote.supplier_confirmed')).some((e) => (e.payload as { offerId: string }).offerId === a.offer.id)).toBe(true);

        const res = await quoteRoute(req(`/api/builds/${a.build.id}/sourcing/offers/${a.offer.id}/quote`, { method: 'POST' }), params({ buildId: a.build.id, offerId: a.offer.id }));
        expect(res.status).toBe(201);
        const quote = QuoteView.parse(await res.json());
        expect(quote).toMatchObject({ trustLevel: 'BINDING', status: 'READY', orderable: true, routeKind: 'supplier' });
        expect(quote.supplierRoute).toMatchObject({ label: 'Verified partner · Vietnam', verified: true, depositPct: 0.5 });
        expect(quote.shippingOptions).toHaveLength(1);
        expect(quote.promise).toEqual([expect.objectContaining({ method: 'STANDARD', show: true, date: quote.shippingOptions[0].deliveryDate })]);
        expect(quote.lineItems.reduce((s, li) => s + li.totalCents, 0)).toBe(quote.subtotalCents);
        const blob = JSON.stringify(quote);
        expect(blob).not.toContain('Da Nang');
        expect(blob).not.toContain(a.supplier.id);
        expect(blob.toLowerCase()).not.toContain('alibaba');

        const [sq] = await ctx.db.select().from(supplierQuotes).where(eq(supplierQuotes.quoteId, quote.id));
        expect(sq.composition).toMatchObject({
            source: { offerId: a.offer.id, jobId: a.job.id, supplierId: a.supplier.id, selectionApprovalId: a.selectionApprovalId },
            designVersion: 1,
            quantity: 250,
            confidence: 0.9,
            supplierStatus: { verified: true, country: 'VN', trustLevel: 'SUPPLIER_CONFIRMED', incoterm: 'DDP', firstOrder: true },
        });
        expect(sq.composition.landed.totalCents).toBe(640 * 250 + 18_000);
        expect(sq.composition.subtotalCents).toBeGreaterThan(sq.composition.landed.totalCents + sq.composition.receivingFeeCents);
        expect(sq.composition.assumptions.length).toBeGreaterThan(0);
        expect(sq.composition.excludedCosts.length).toBeGreaterThan(0);
        expect((await events('quote.binding')).some((e) => (e.payload as { quoteId: string }).quoteId === quote.id)).toBe(true);

        const again = await createSupplierBindingQuote(a.build.id, a.offer.id);
        expect(again).toMatchObject({ created: false, quote: { id: quote.id } });
        // The GET view is the same supplier quote.
        const got = QuoteView.parse(await (await getQuoteRoute(req(`/api/quotes/${quote.id}`), params({ quoteId: quote.id }))).json());
        expect(got.routeKind).toBe('supplier');
    });

    it('refuses a binding quote before ops confirms the route', async () => {
        const a = await approvedOffer(ctx.db);
        const other = await bindingSupplierQuote(ctx.db);
        // `a` is selected; a fresh offer on the same job is not (its siblings were rejected on selection).
        const err = await rejects(createSupplierBindingQuote(other.build.id, a.offer.id));
        expect(err.code).toBe('NOT_FOUND');
    });

    it('checkout charges the deposit; payment events are idempotent; PO approvals are requested; no leg before approval', async () => {
        const o = await depositPaidOrder(ctx.db);
        const total = o.checkout.totals.totalCents;
        expect(o.checkout.payment).toMatchObject({ purpose: 'deposit', amountCents: Math.ceil(total * 0.5) });
        expect(o.checkout.balanceDueCents).toBe(total - Math.ceil(total * 0.5));
        expect(o.pay.alreadyProcessed).toBe(false);

        const replay = await handlePaymentSucceeded({ provider: 'dev', providerRef: o.checkout.payment.providerRef, providerPaymentId: 'x', amountCents: o.checkout.payment.amountCents!, currency: 'usd', eventId: 'replay' });
        expect(replay.alreadyProcessed).toBe(true);

        const [order] = await ctx.db.select().from(orders).where(eq(orders.id, o.orderId));
        expect(order.status).toBe('PAID');
        const [plan] = await ctx.db.select().from(orderPaymentPlans).where(eq(orderPaymentPlans.orderId, o.orderId));
        expect(plan).toMatchObject({ kind: 'DEPOSIT_BALANCE', depositCents: Math.ceil(total * 0.5), balanceCents: total - Math.ceil(total * 0.5), creditCents: 0 });
        expect(plan.depositPaidAt).not.toBeNull();

        const ledger = await getOrderLedger(o.orderId);
        expect(ledger.filter((l) => l.txnKey === `deposit:${o.orderId}`).map((l) => [l.account, l.direction, l.amountCents])).toEqual([
            ['CASH', 'DEBIT', plan.depositCents],
            ['CUSTOMER_DEPOSITS', 'CREDIT', plan.depositCents],
        ]);
        expect(ledger.some((l) => l.txnKey === `payment:${o.orderId}`)).toBe(false);

        const { po, deposit, all } = await poApprovals(ctx.db, o.orderId);
        expect(all).toHaveLength(2);
        expect(po).toMatchObject({ kind: 'PLACE_PURCHASE_ORDER', approverRole: 'ops', jobId: o.job.id, supplierOfferId: o.offer.id });
        expect(deposit).toMatchObject({ kind: 'PAY_DEPOSIT', approverRole: 'ops' });
        expect((await events('po.approval_requested', o.orderId))).toHaveLength(1);
        expect(await ctx.db.select().from(supplierLegs).where(eq(supplierLegs.orderId, o.orderId))).toHaveLength(0);
        // Production is not authorized and nothing was dispatched to a partner shop.
        expect(await events('production.authorized', o.orderId)).toHaveLength(0);
        expect(await ctx.db.select().from(manufacturingJobs).where(eq(manufacturingJobs.orderId, o.orderId))).toHaveLength(0);

        // Agents and shops cannot decide: humans only.
        const agentErr = await rejects(decideApproval(po.id, { decision: 'APPROVED' }, { kind: 'sourcing_agent', id: o.client.clientId }));
        expect(agentErr.code).toBe('FORBIDDEN');
        expect(await ctx.db.select().from(supplierLegs).where(eq(supplierLegs.orderId, o.orderId))).toHaveLength(0);

        // Buyer view: deposit paid, waiting for the PO approval, never the supplier.
        const view = OrderView.parse(await getOrderForBuyer(o.orderId, new URL(o.checkout.orderUrl).searchParams.get('t')));
        expect(view.supplierRoute).toMatchObject({ label: 'Verified partner · Vietnam', legStatus: null, payment: { depositPaid: true, balancePaid: false } });
        expect(view.statusLabel).toMatch(/approving the purchase order/);
        expect(view.promise).toMatchObject({ show: true, status: 'ON_TRACK' });
        expect(JSON.stringify(view)).not.toContain('Da Nang');
    });

    it('PO approval -> leg; production needs the supplier deposit approved; receiving + QA at receipt (fail -> rework -> pass); balance at shipment; delivered', async () => {
        const o = await depositPaidOrder(ctx.db);
        const { po, deposit } = await poApprovals(ctx.db, o.orderId);
        await decideApproval(po.id, { decision: 'APPROVED' }, ADMIN);
        const [leg] = await ctx.db.select().from(supplierLegs).where(eq(supplierLegs.orderId, o.orderId));
        expect(leg).toMatchObject({ status: 'PO_PLACED', supplierId: o.supplier.id, incoterm: 'DDP', directShip: false, receivingShopId: DEV_SHOP_ID, poApprovalId: po.id });
        expect(leg.poNumber).toMatch(/^PO-[0-9A-Z]{8}$/);
        let [order] = await ctx.db.select().from(orders).where(eq(orders.id, o.orderId));
        expect(order.status).toBe('DISPATCHED');
        expect(await events('po.placed', o.orderId)).toHaveLength(1);

        // No production before a human approved paying the supplier deposit.
        expect((await rejects(advanceSupplierLeg(leg.id, { to: 'IN_PRODUCTION_AT_SUPPLIER' }, ADMIN))).code).toBe('CONFLICT');
        await decideApproval(deposit.id, { decision: 'APPROVED' }, ADMIN);
        const supplierDeposit = (await getOrderLedger(o.orderId)).filter((l) => l.txnKey === `supplier_deposit:${o.orderId}`);
        expect(supplierDeposit.map((l) => [l.account, l.direction])).toEqual([
            ['SUPPLIER_PAYABLE', 'DEBIT'],
            ['CASH', 'CREDIT'],
        ]);

        const inProd = await advanceSupplierLeg(leg.id, { to: 'IN_PRODUCTION_AT_SUPPLIER' }, ADMIN);
        expect(inProd).toMatchObject({ status: 'IN_PRODUCTION_AT_SUPPLIER', allowedNext: ['SHIPPED_INBOUND'], supplierDeposit: { status: 'APPROVED' } });
        [order] = await ctx.db.select().from(orders).where(eq(orders.id, o.orderId));
        expect(order).toMatchObject({ status: 'ACCEPTED', shopId: DEV_SHOP_ID });
        // Ops cannot mark a partner-route leg received or delivered.
        expect((await rejects(advanceSupplierLeg(leg.id, { to: 'RECEIVED_AT_PARTNER' }, ADMIN))).code).toBe('CONFLICT');
        expect((await rejects(advanceSupplierLeg(leg.id, { to: 'SHIPPED_INBOUND' }, ADMIN))).code).toBe('VALIDATION_FAILED');

        const shipped = await advanceSupplierLeg(leg.id, { to: 'SHIPPED_INBOUND', inboundCarrier: 'Maersk', inboundTracking: 'MAEU1234567' }, ADMIN);
        expect(shipped.receivingJobId).toMatch(/^job_/);
        const jobId = shipped.receivingJobId!;
        const [job] = await ctx.db.select().from(manufacturingJobs).where(eq(manufacturingJobs.id, jobId));
        expect(job).toMatchObject({ status: 'ACCEPTED', shopId: DEV_SHOP_ID, payoutCents: order.shopCostCents });
        expect(job.packet.receiving).toMatchObject({ poNumber: leg.poNumber, origin: 'Vietnam', inboundTracking: 'MAEU1234567' });
        expect(JSON.stringify(job.packet)).not.toContain('Da Nang');
        expect(await ctx.db.select().from(inspectionPlans).where(eq(inspectionPlans.jobId, jobId))).toHaveLength(1);
        const listed = (await listJobs(DEV_SHOP_ID)).find((j) => j.id === jobId);
        expect(listed).toMatchObject({ kind: 'RECEIVING', nextAction: 'RECORD_MILESTONE' });

        // Partner receives the freight: production (QA at receipt) starts, leg RECEIVED_AT_PARTNER.
        const received = await receiveFreight(DEV_SHOP_ID, jobId);
        expect(received.status).toBe('IN_PRODUCTION');
        expect(received.milestones.map((m) => m.kind)).toEqual(['MATERIAL_STAGED']);
        expect((await ctx.db.select().from(supplierLegs).where(eq(supplierLegs.id, leg.id)))[0].status).toBe('RECEIVED_AT_PARTNER');
        expect((await rejects(receiveFreight('shop_someone_else', jobId))).code).toBe('NOT_FOUND');

        // QA at receipt fails: order QA_FAILED, leg QA_FAILED, rework job at the partner.
        const plan = (await ctx.db.select().from(inspectionPlans).where(eq(inspectionPlans.jobId, jobId)))[0];
        const critical = plan.checks.find((c) => c.critical)!;
        const fail = await submitInspection(DEV_SHOP_ID, jobId, { measurements: await measurementsFor(ctx.db, jobId, [critical.id]), photoKeys: [await uploadQaPhoto(jobId)], inspectorName: 'Receiving QA' });
        expect(fail.outcome).toBe('FAIL');
        expect((await ctx.db.select().from(supplierLegs).where(eq(supplierLegs.id, leg.id)))[0].status).toBe('QA_FAILED');
        [order] = await ctx.db.select().from(orders).where(eq(orders.id, o.orderId));
        expect(order.status).toBe('QA_FAILED');
        const reworkId = fail.reworkJobId!;

        // Rework passes: leg back to RECEIVED_AT_PARTNER, order QA_PASSED, balance requested.
        await recordMilestone(DEV_SHOP_ID, reworkId, { kind: 'FINISHING' });
        const pass = await submitInspection(DEV_SHOP_ID, reworkId, { measurements: await measurementsFor(ctx.db, reworkId), photoKeys: [await uploadQaPhoto(reworkId)], inspectorName: 'Receiving QA' });
        expect(pass.outcome).toBe('PASS');
        expect((await ctx.db.select().from(supplierLegs).where(eq(supplierLegs.id, leg.id)))[0].status).toBe('RECEIVED_AT_PARTNER');
        const balance = await pendingBalance(ctx.db, o.orderId);
        expect(balance).toMatchObject({ amountCents: o.checkout.balanceDueCents, status: 'PENDING' });
        expect(await events('order.balance_due', o.orderId)).toHaveLength(1);

        // No label until the balance is paid.
        expect((await rejects(createShipment(DEV_SHOP_ID, reworkId, { parcel: PARCEL, manual: MANUAL }))).code).toBe('CONFLICT');
        const token = new URL(o.checkout.orderUrl).searchParams.get('t');
        const due = OrderView.parse(await getOrderForBuyer(o.orderId, token));
        expect(due.statusLabel).toMatch(/^Passed inspection · pay the balance to ship · Arrives /);
        expect(due.supplierRoute?.payment.balancePayUrl).toMatch(/\/checkout\/dev-pay\?ref=/);

        // A wrong amount is flagged and changes nothing; the right one is applied once.
        await handlePaymentSucceeded({ provider: 'dev', providerRef: balance!.providerRef, providerPaymentId: null, amountCents: 1, currency: 'usd', eventId: 'bad' });
        expect((await ctx.db.select().from(orderPaymentPlans).where(eq(orderPaymentPlans.orderId, o.orderId)))[0].balancePaidAt).toBeNull();
        expect((await payPending(balance!)).alreadyProcessed).toBe(false);
        expect((await payPending(balance!)).alreadyProcessed).toBe(true);
        const afterBalance = await getOrderLedger(o.orderId);
        expect(afterBalance.filter((l) => l.txnKey === `balance:${o.orderId}`)).toHaveLength(2);
        expect(afterBalance.filter((l) => l.txnKey === `supplier_recognize:${o.orderId}`).length).toBeGreaterThanOrEqual(5);

        const shipment = await createShipment(DEV_SHOP_ID, reworkId, { parcel: PARCEL, manual: MANUAL });
        [order] = await ctx.db.select().from(orders).where(eq(orders.id, o.orderId));
        expect(order.status).toBe('SHIPPED');
        await markShipmentDelivered(shipment.id, ADMIN);
        [order] = await ctx.db.select().from(orders).where(eq(orders.id, o.orderId));
        expect(order.status).toBe('COMPLETE');
        expect((await ctx.db.select().from(supplierLegs).where(eq(supplierLegs.id, leg.id)))[0].status).toBe('DELIVERED');

        // Receiving partner paid its fee; the money nets out: held deposits are fully recognized.
        const [payout] = await ctx.db.select().from(payouts).where(and(eq(payouts.orderId, o.orderId), eq(payouts.shopId, DEV_SHOP_ID)));
        expect(payout.amountCents).toBe(order.shopCostCents);
        const all = await getOrderLedger(o.orderId);
        const byTxn = new Map<string, number>();
        for (const l of all) byTxn.set(l.txnKey, (byTxn.get(l.txnKey) ?? 0) + (l.direction === 'DEBIT' ? l.amountCents : -l.amountCents));
        expect([...byTxn.values()].every((v) => v === 0)).toBe(true);
        const balances = ledgerBalances(all);
        expect(balances.CUSTOMER_DEPOSITS ?? 0).toBe(0);
        expect(-(balances.RISK_RESERVE ?? 0)).toBeGreaterThan(0);

        // Promise outcome and observations recorded.
        const [promise] = await ctx.db.select().from(orderPromises).where(eq(orderPromises.orderId, o.orderId));
        expect(promise.status).toBe('MET');
        const obs = await ctx.db.select().from(promiseObservations).where(eq(promiseObservations.orderId, o.orderId));
        expect(obs.map((x) => x.leg).sort()).toEqual(['CARRIER_TRANSIT', 'MATERIAL_ARRIVAL', 'PACK', 'PROCESS', 'QA', 'SHOP_QUEUE']);
        expect(obs.every((x) => x.supplierId === o.supplier.id)).toBe(true);

        // Buyer tracker: every supplier step done, one sentence each.
        const final = OrderView.parse(await getOrderForBuyer(o.orderId, token));
        expect(final.supplierRoute?.steps.every((s) => s.state === 'done')).toBe(true);
        expect(final.supplierRoute?.steps.map((s) => s.sentence)).toEqual([
            'Purchase order placed with a verified partner in Vietnam',
            'Made by our partner in Vietnam',
            'Shipped to our partner in Philadelphia',
            'Received and inspected by our partner in Philadelphia',
            'Shipped to you',
            'Delivered',
        ]);
    });

    it('refund before shipping returns the deposit, cancels the leg and the pending approvals', async () => {
        const o = await depositPaidOrder(ctx.db);
        const { po } = await poApprovals(ctx.db, o.orderId);
        await decideApproval(po.id, { decision: 'APPROVED' }, ADMIN);
        await refundOrder(o.orderId, ADMIN, 'Buyer changed plans');
        const [order] = await ctx.db.select().from(orders).where(eq(orders.id, o.orderId));
        expect(order.status).toBe('REFUNDED');
        expect((await ctx.db.select().from(supplierLegs).where(eq(supplierLegs.orderId, o.orderId)))[0].status).toBe('CANCELLED');
        const pending = (await ctx.db.select().from(approvals).where(eq(approvals.status, 'PENDING'))).filter((a) => a.details?.orderId === o.orderId);
        expect(pending).toHaveLength(0);
        const refund = (await ctx.db.select().from(ledgerEntries).where(eq(ledgerEntries.txnKey, `refund:${o.orderId}`))).map((l) => [l.account, l.direction]);
        expect(refund).toEqual([
            ['CUSTOMER_DEPOSITS', 'DEBIT'],
            ['CASH', 'CREDIT'],
        ]);
    });

    it('a rejected PO leaves the order paid with no leg and alerts ops', async () => {
        const o = await depositPaidOrder(ctx.db);
        const { po } = await poApprovals(ctx.db, o.orderId);
        await decideApproval(po.id, { decision: 'REJECTED', note: 'Supplier went quiet' }, ADMIN);
        expect(await ctx.db.select().from(supplierLegs).where(eq(supplierLegs.orderId, o.orderId))).toHaveLength(0);
        const alerts = (await ctx.db.select().from(domainEvents).where(eq(domainEvents.eventType, 'ops.alert_requested'))).filter((e) => (e.payload as { orderId: string | null }).orderId === o.orderId);
        expect(alerts.some((e) => /rejected/.test((e.payload as { subject: string }).subject))).toBe(true);
    });

    it('a second checkout of the same supplier quote still charges its own deposit', async () => {
        const b = await bindingSupplierQuote(ctx.db);
        const first = await createCheckout(checkoutBody(b.supplierQuote.id));
        const second = await createCheckout(checkoutBody(b.supplierQuote.id, { buyer: { email: 'other@example.com', name: 'Other' } }));
        expect(second.payment.amountCents).toBe(first.payment.amountCents);
        expect(second.payment.purpose).toBe('deposit');
    });
});
