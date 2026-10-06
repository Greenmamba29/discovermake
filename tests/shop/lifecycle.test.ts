/**
 * Full order lifecycle through the real module functions:
 * checkout -> payment confirmed (dev provider) -> auto dispatch -> shop accepts ->
 * milestones -> QA pass -> shipment -> delivered -> passport + payout -> COMPLETE.
 */
import { asc, eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PassportPublicView, PassportSnapshot } from '@/contracts/passport';
import { ShopJobDetail } from '@/contracts/shop';
import { DEV_SHOP_ID } from '@/server/db/seed';
import { domainEvents, ledgerEntries, manufacturingJobs, orders, passports, payouts, shipments } from '@/server/db/schema';
import { getOrderLedger, ledgerBalances } from '@/server/ledger';
import { createCheckout, getOrderForBuyer, handlePaymentSucceeded } from '@/server/orders';
import { activatePassport, getPublicPassport, verifyPassport } from '@/server/passport';
import { markShipmentDelivered } from '@/server/shipping';
import { acceptJob, createShipment, getJob, listJobs, recordMilestone, submitInspection } from '@/server/shops';
import { useTestDb } from '../support/db';
import { BUYER_ADDRESS, createQaPassedJob, createQuoteFixture, measurementsFor, quietConsole, uploadQaPhoto } from './fixtures';

vi.mock('@/server/quote', async (orig) => (await import('./mocks')).quoteModuleMock(orig));

describe('order lifecycle PAID -> COMPLETE', () => {
    const ctx = useTestDb({ seed: true });
    beforeAll(() => quietConsole());

    it('runs a real order end to end and activates a verifiable passport', async () => {
        const { quote } = await createQuoteFixture(ctx.db, { quantity: 12, bend: true, finish: true });
        const checkout = await createCheckout({
            quoteId: quote.id,
            shippingMethod: 'STANDARD',
            buyer: { email: 'maker@example.com', name: 'Ada Maker' },
            shippingAddress: BUYER_ADDRESS,
            acceptTerms: true,
        });
        const token = new URL(checkout.orderUrl).searchParams.get('t');
        const orderId = checkout.orderId;

        // Payment confirmed -> PAID -> dispatched after commit.
        const paid = await handlePaymentSucceeded({
            provider: 'dev',
            providerRef: checkout.payment.providerRef,
            providerPaymentId: null,
            amountCents: checkout.totals.totalCents,
            currency: 'usd',
            eventId: 'evt_lifecycle_1',
        });
        expect(paid).toEqual({ orderId, alreadyProcessed: false });
        let [order] = await ctx.db.select().from(orders).where(eq(orders.id, orderId));
        expect(order.status).toBe('DISPATCHED');

        const [inbox] = await listJobs(DEV_SHOP_ID);
        expect(inbox.orderId).toBe(orderId);
        expect(inbox.nextAction).toBe('ACCEPT_OR_DECLINE');
        expect(inbox.payoutCents).toBe(order.shopCostCents);
        const jobId = inbox.id;

        const accepted = ShopJobDetail.parse(await acceptJob(DEV_SHOP_ID, jobId));
        expect(accepted.packet.files[0].filename).toBe('bracket.dxf');
        expect(accepted.inspectionPlan?.checks.length).toBeGreaterThan(3);

        for (const kind of ['MATERIAL_STAGED', 'CUTTING', 'BENDING', 'FINISHING'] as const) {
            await recordMilestone(DEV_SHOP_ID, jobId, { kind });
        }
        const photo = await uploadQaPhoto(jobId);
        const qa = await submitInspection(DEV_SHOP_ID, jobId, { measurements: await measurementsFor(ctx.db, jobId), photoKeys: [photo], inspectorName: 'Sam Inspector', notes: 'First article OK' });
        expect(qa.outcome).toBe('PASS');
        await recordMilestone(DEV_SHOP_ID, jobId, { kind: 'PACKED' });

        const shipment = await createShipment(DEV_SHOP_ID, jobId, {
            parcel: { lengthIn: 12, widthIn: 10, heightIn: 3, weightOz: 40 },
            manual: { carrier: 'UPS', service: 'Ground', trackingNumber: '1Z999AA10123456784' },
        });
        [order] = await ctx.db.select().from(orders).where(eq(orders.id, orderId));
        expect(order.status).toBe('SHIPPED');

        // Buyer sees the shipment while in transit.
        const inTransit = await getOrderForBuyer(orderId, token);
        expect(inTransit?.shipment?.trackingNumber).toBe('1Z999AA10123456784');
        expect(inTransit?.milestones.map((m) => m.kind)).toEqual(['MATERIAL_STAGED', 'CUTTING', 'BENDING', 'FINISHING', 'PACKED']);

        const delivered = await markShipmentDelivered(shipment.id, { kind: 'admin', id: 'ops' });
        expect(delivered.status).toBe('DELIVERED');
        [order] = await ctx.db.select().from(orders).where(eq(orders.id, orderId));
        expect(order.status).toBe('COMPLETE');
        expect(order.deliveredAt).not.toBeNull();
        expect(order.completedAt).not.toBeNull();

        // Status history walked the whole machine.
        const history = await ctx.db.execute(sql`select to_status from order_status_history where order_id = ${orderId} order by created_at, id`);
        expect((history as unknown as { to_status: string }[]).map((r) => r.to_status)).toEqual([
            'PAID',
            'DISPATCHED',
            'ACCEPTED',
            'IN_PRODUCTION',
            'QA_PASSED',
            'SHIPPED',
            'DELIVERED',
            'COMPLETE',
        ]);

        // Payout = shop cost (subtotal minus platform fee), ledger balanced per txn.
        const outs = await ctx.db.select().from(payouts).where(eq(payouts.orderId, orderId));
        expect(outs).toHaveLength(1);
        expect(outs[0]).toMatchObject({ shopId: DEV_SHOP_ID, amountCents: order.shopCostCents, status: 'PENDING', jobId });
        const ledger = await getOrderLedger(orderId);
        const byTxn = new Map<string, number>();
        for (const l of ledger) byTxn.set(l.txnKey, (byTxn.get(l.txnKey) ?? 0) + (l.direction === 'DEBIT' ? l.amountCents : -l.amountCents));
        expect([...byTxn.keys()].sort()).toEqual([`payment:${orderId}`, `payout:${orderId}:${DEV_SHOP_ID}`].sort());
        for (const net of byTxn.values()) expect(net).toBe(0);
        const balances = ledgerBalances(ledger);
        expect(balances.SHOP_PAYABLE).toBe(0);
        expect(balances.PAYOUTS_IN_TRANSIT).toBe(-order.shopCostCents);

        // Passport: real records, signed, verifiable, public view has no buyer PII.
        const [pp] = await ctx.db.select().from(passports).where(eq(passports.orderId, orderId));
        expect(pp.status).toBe('ACTIVE');
        const view = PassportPublicView.parse(await getPublicPassport(pp.id));
        expect(view.verified).toBe(true);
        expect(view.verifyUrl).toBe(`http://localhost:3100/passport/${pp.id}`);
        const snap = PassportSnapshot.parse(view.snapshot);
        expect(snap.orderNumber).toBe(order.orderNumber);
        expect(snap.shop).toMatchObject({ id: DEV_SHOP_ID, name: 'Philadelphia Precision Works', city: 'Philadelphia' });
        expect(snap.part.fileSha256).toMatch(/^[0-9a-f]{64}$/);
        expect(snap.qa.outcome).toBe('PASS');
        expect(snap.qa.checks.every((c) => c.pass)).toBe(true);
        expect(snap.milestones.map((m) => m.kind)).toEqual(['MATERIAL_STAGED', 'CUTTING', 'BENDING', 'FINISHING', 'PACKED']);
        expect(snap.finish).toBe('Powder coat · Black');
        expect(snap.shipment.trackingNumber).toBe('••••6784');
        const serialized = JSON.stringify(view);
        expect(serialized).not.toContain('maker@example.com');
        expect(serialized).not.toContain('Ada Maker');
        expect(serialized).not.toContain('100 Market St');
        expect((await verifyPassport(pp.id))?.valid).toBe(true);

        // Buyer tracker shows the passport and a COMPLETE universal status.
        const final = await getOrderForBuyer(orderId, token);
        expect(final?.universalStatus).toBe('COMPLETE');
        expect(final?.passport?.id).toBe(pp.id);

        // Every meaningful step is in the outbox with the same correlation id.
        const events = await ctx.db.select().from(domainEvents).where(eq(domainEvents.orderId, orderId)).orderBy(asc(domainEvents.timestamp));
        const types = new Set(events.map((e) => e.eventType));
        for (const t of [
            'order.created',
            'payment.completed',
            'production.authorized',
            'job.offered',
            'job.accepted',
            'production.started',
            'production.milestone',
            'inspection.passed',
            'production.completed',
            'shipment.created',
            'shipment.updated',
            'product.delivered',
            'passport.activated',
            'payout.created',
            'order.completed',
        ]) {
            expect(types, t).toContain(t);
        }
        expect(new Set(events.map((e) => e.correlationId)).size).toBe(1);

        // Idempotent: delivering again changes nothing.
        await markShipmentDelivered(shipment.id, { kind: 'admin', id: 'ops' });
        expect(await ctx.db.select().from(payouts).where(eq(payouts.orderId, orderId))).toHaveLength(1);
        expect(await ctx.db.select().from(passports).where(eq(passports.orderId, orderId))).toHaveLength(1);
        expect((await activatePassport(orderId)).passportId).toBe(pp.id);
        const [job] = await ctx.db.select().from(manufacturingJobs).where(eq(manufacturingJobs.id, jobId));
        expect(job.status).toBe('DELIVERED');
        expect((await getJob(DEV_SHOP_ID, jobId))?.shipment?.status).toBe('DELIVERED');
    });

    it('passport verification fails when the stored snapshot is tampered with', async () => {
        const job = await createQaPassedJob(ctx.db);
        const s = await createShipment(job.shopId, job.jobId, {
            parcel: { lengthIn: 10, widthIn: 8, heightIn: 2, weightOz: 20 },
            manual: { carrier: 'USPS', service: 'Priority', trackingNumber: '9400111899223856' },
        });
        await markShipmentDelivered(s.id, { kind: 'admin', id: 'ops' });
        const [pp] = await ctx.db.select().from(passports).where(eq(passports.orderId, job.order.id));
        expect((await verifyPassport(pp.id))?.valid).toBe(true);

        // Change the quantity inside the stored snapshot (hash + signature untouched).
        await ctx.db
            .update(passports)
            .set({ snapshot: { ...pp.snapshot, quantity: pp.snapshot.quantity + 100 } })
            .where(eq(passports.id, pp.id));
        const tampered = await verifyPassport(pp.id);
        expect(tampered?.valid).toBe(false);
        expect(tampered?.computedHash).not.toBe(tampered?.snapshotHash);
        expect((await getPublicPassport(pp.id))?.verified).toBe(false);

        // Recomputing the hash without the signing key is still caught by the signature.
        const { hashSnapshot } = await import('@/server/passport');
        const forged = { ...pp.snapshot, quantity: pp.snapshot.quantity + 100 };
        await ctx.db.update(passports).set({ snapshot: forged, snapshotHash: hashSnapshot(forged) }).where(eq(passports.id, pp.id));
        const forgedCheck = await verifyPassport(pp.id);
        expect(forgedCheck?.computedHash).toBe(forgedCheck?.snapshotHash);
        expect(forgedCheck?.signatureValid).toBe(false);
        expect(forgedCheck?.valid).toBe(false);
    });

    it('refuses to activate a passport without a delivered shipment', async () => {
        const job = await createQaPassedJob(ctx.db);
        await expect(activatePassport(job.order.id)).rejects.toThrow(/DELIVERED|delivery/i);
        expect(await ctx.db.select().from(passports).where(eq(passports.orderId, job.order.id))).toHaveLength(0);
        expect(await ctx.db.select().from(shipments).where(eq(shipments.orderId, job.order.id))).toHaveLength(0);
        expect(await ctx.db.select().from(ledgerEntries).where(eq(ledgerEntries.txnKey, `payout:${job.order.id}:${job.shopId}`))).toHaveLength(0);
    });
});
