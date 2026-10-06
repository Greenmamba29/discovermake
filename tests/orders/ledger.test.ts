import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@/contracts/common';
import { DEV_SHOP_ID } from '@/server/db/seed';
import { domainEvents, ledgerEntries, orders, payments, payouts, shops } from '@/server/db/schema';
import { assertBalanced, getOrderLedger, ledgerBalances, markPayoutPaid, recordPaymentSplit, recordPayouts, UnbalancedLedgerError } from '@/server/ledger';
import { advanceOrder, confirmDevPayment, createCheckout, IllegalTransitionError, refundOrder } from '@/server/orders';
import { DevPaymentProvider } from '@/server/payments';
import { useTestDb } from '../support/db';
import { checkoutBody, createQuoteFixture, quietConsole } from './fixtures';

const { dispatchOrderMock } = vi.hoisted(() => ({ dispatchOrderMock: vi.fn(async (_id: string) => null) }));
// Dispatch is a spy so order suites stay deterministic (tests/shop covers dispatch); the rest is real.
vi.mock('@/server/dispatch', async (orig) => ({ ...(await orig<typeof import('@/server/dispatch')>()), dispatchOrder: (id: string) => dispatchOrderMock(id), expireStaleOffers: async () => 0 }));

const SHOP: Actor = { kind: 'shop', id: DEV_SHOP_ID };
const OPS: Actor = { kind: 'admin', id: 'ops' };

function expectEveryTxnBalanced(rows: { txnKey: string; direction: string; amountCents: number }[]) {
    const byTxn = new Map<string, number>();
    for (const r of rows) byTxn.set(r.txnKey, (byTxn.get(r.txnKey) ?? 0) + (r.direction === 'DEBIT' ? r.amountCents : -r.amountCents));
    for (const [key, net] of byTxn) expect({ key, net }).toEqual({ key, net: 0 });
}

describe('ledger + payouts + refunds', () => {
    const ctx = useTestDb({ seed: true });
    beforeAll(() => {
        quietConsole();
    });

    async function paidOrder() {
        const { quote } = await createQuoteFixture(ctx.db, { quantity: 10, unitPriceCents: 640 });
        const res = await createCheckout(checkoutBody(quote.id));
        await confirmDevPayment(JSON.stringify({ providerRef: res.payment.providerRef, outcome: 'succeeded' }), new Headers());
        const [order] = await ctx.db.select().from(orders).where(eq(orders.id, res.orderId));
        expect(order.status).toBe('PAID');
        return order;
    }

    /** What the shop module does, compressed: dispatch -> accept -> produce -> QA -> ship -> deliver. */
    async function runToDelivered(orderId: string) {
        await advanceOrder(orderId, 'DISPATCHED', SHOP);
        await advanceOrder(orderId, 'ACCEPTED', SHOP, { shopId: DEV_SHOP_ID });
        await advanceOrder(orderId, 'IN_PRODUCTION', SHOP);
        await advanceOrder(orderId, 'QA_PASSED', SHOP);
        await advanceOrder(orderId, 'SHIPPED', SHOP);
        await advanceOrder(orderId, 'DELIVERED', { kind: 'carrier', id: 'manual' });
    }

    it('asserts balance before posting', () => {
        expect(() => assertBalanced('t', [{ account: 'CASH', direction: 'DEBIT', amountCents: 10 }, { account: 'PLATFORM_REVENUE', direction: 'CREDIT', amountCents: 9 }])).toThrow(UnbalancedLedgerError);
        expect(() => assertBalanced('t', [{ account: 'CASH', direction: 'DEBIT', amountCents: 10 }])).toThrow(UnbalancedLedgerError);
        expect(() => assertBalanced('t', [{ account: 'CASH', direction: 'DEBIT', amountCents: 10 }, { account: 'PLATFORM_REVENUE', direction: 'CREDIT', amountCents: 10 }])).not.toThrow();
    });

    it('payment split: DEBIT CASH total = CREDIT shop + platform + shipping; idempotent', async () => {
        const order = await paidOrder();
        await recordPaymentSplit(order.id);
        await recordPaymentSplit(order.id);
        const rows = await getOrderLedger(order.id);
        expect(rows.filter((r) => r.txnKey === `payment:${order.id}`)).toHaveLength(4);
        const b = ledgerBalances(rows);
        expect(b.CASH).toBe(order.totalCents);
        expect(b.SHOP_PAYABLE).toBe(-order.shopCostCents);
        expect(b.PLATFORM_REVENUE).toBe(-order.platformFeeCents);
        expect(b.SHIPPING_PAYABLE).toBe(-order.shippingCents);
        expect(b.TAX_PAYABLE).toBeUndefined(); // zero lines omitted
        expectEveryTxnBalanced(rows);
        const recorded = await ctx.db
            .select()
            .from(domainEvents)
            .where(and(eq(domainEvents.orderId, order.id), eq(domainEvents.eventType, 'ledger.payment_recorded')));
        expect(recorded).toHaveLength(1);
    });

    it('payout on delivery = shop cost (after platform fee); manual payout PENDING; balances to zero per order', async () => {
        const order = await paidOrder();
        await expect(recordPayouts(order.id)).rejects.toThrow(/delivery/);
        await runToDelivered(order.id);

        const first = await recordPayouts(order.id);
        const second = await recordPayouts(order.id);
        expect(first).toHaveLength(1);
        expect(second).toHaveLength(1);
        expect(first[0]).toMatchObject({ shopId: DEV_SHOP_ID, amountCents: order.shopCostCents, status: 'PENDING', method: 'manual' });
        expect(first[0].amountCents).toBe(order.subtotalCents - order.platformFeeCents);

        let rows = await getOrderLedger(order.id);
        expectEveryTxnBalanced(rows);
        expect(rows.filter((r) => r.txnKey === `payout:${order.id}:${DEV_SHOP_ID}`)).toHaveLength(2);
        let b = ledgerBalances(rows);
        expect(b.SHOP_PAYABLE).toBe(0);
        expect(b.PAYOUTS_IN_TRANSIT).toBe(-order.shopCostCents);
        expect(Object.values(b).reduce((s, v) => s + (v ?? 0), 0)).toBe(0);
        const created = await ctx.db
            .select()
            .from(domainEvents)
            .where(and(eq(domainEvents.orderId, order.id), eq(domainEvents.eventType, 'payout.created')));
        expect(created).toHaveLength(1);

        await markPayoutPaid(first[0].id, 'manual-ach-123');
        await markPayoutPaid(first[0].id, 'manual-ach-123');
        rows = await getOrderLedger(order.id);
        expectEveryTxnBalanced(rows);
        b = ledgerBalances(rows);
        expect(b.PAYOUTS_IN_TRANSIT).toBe(0);
        expect(b.CASH).toBe(order.totalCents - order.shopCostCents);
        const [p] = await ctx.db.select().from(payouts).where(eq(payouts.id, first[0].id));
        expect(p.status).toBe('PAID');
    });

    it('marks payouts stripe_connect when the shop has a Connect account and Stripe is configured', async () => {
        const order = await paidOrder();
        await runToDelivered(order.id);
        await ctx.db.update(shops).set({ stripeAccountId: 'acct_test_123' }).where(eq(shops.id, DEV_SHOP_ID));
        process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
        const { resetEnvCache } = await import('@/server/env');
        resetEnvCache();
        try {
            const { withTx } = await import('@/server/db');
            // Inside a caller transaction no money moves (that happens after commit).
            const rows = await withTx((tx) => recordPayouts(order.id, tx));
            expect(rows[0]).toMatchObject({ method: 'stripe_connect', status: 'PENDING' });
        } finally {
            delete process.env.STRIPE_SECRET_KEY;
            resetEnvCache();
            await ctx.db.update(shops).set({ stripeAccountId: null }).where(eq(shops.id, DEV_SHOP_ID));
        }
    });

    it('refundOrder (before shipping): provider refund, REFUNDED, ledger reversal nets every account to zero', async () => {
        const order = await paidOrder();
        await advanceOrder(order.id, 'DISPATCHED', SHOP);
        await refundOrder(order.id, OPS, 'No shop accepted within the window');
        await refundOrder(order.id, OPS, 'again'); // idempotent

        const [after] = await ctx.db.select().from(orders).where(eq(orders.id, order.id));
        expect(after.status).toBe('REFUNDED');
        expect(after.cancelReason).toBe('No shop accepted within the window');
        const [payment] = await ctx.db.select().from(payments).where(eq(payments.orderId, order.id));
        expect(payment.status).toBe('REFUNDED');
        expect(payment.refundedCents).toBe(order.totalCents);
        expect(String(payment.metadata.refundRef)).toMatch(/^devrefund_/);

        const rows = await getOrderLedger(order.id);
        expectEveryTxnBalanced(rows);
        const b = ledgerBalances(rows);
        expect(b.CASH).toBe(0);
        expect(b.SHOP_PAYABLE).toBe(0);
        expect(b.SHIPPING_PAYABLE).toBe(0);
        expect((b.PLATFORM_REVENUE ?? 0) + (b.REFUNDS ?? 0)).toBe(0);
        const refunded = await ctx.db
            .select()
            .from(domainEvents)
            .where(and(eq(domainEvents.orderId, order.id), eq(domainEvents.eventType, 'order.refunded')));
        expect(refunded).toHaveLength(1);
    });

    it('refunds a QA_PASSED order that has not shipped (ledger reversed)', async () => {
        const order = await paidOrder();
        await advanceOrder(order.id, 'DISPATCHED', SHOP);
        await advanceOrder(order.id, 'ACCEPTED', SHOP, { shopId: DEV_SHOP_ID });
        await advanceOrder(order.id, 'IN_PRODUCTION', SHOP);
        await advanceOrder(order.id, 'QA_PASSED', SHOP);
        await refundOrder(order.id, OPS, 'Shop never shipped');
        const [after] = await ctx.db.select().from(orders).where(eq(orders.id, order.id));
        expect(after.status).toBe('REFUNDED');
        const b = ledgerBalances(await getOrderLedger(order.id));
        expect(b.CASH).toBe(0);
        expect(b.SHOP_PAYABLE).toBe(0);
    });

    it('holds the order lock while the provider refund is in flight, so production cannot advance past refundable', async () => {
        const order = await paidOrder();
        await advanceOrder(order.id, 'DISPATCHED', SHOP);
        await advanceOrder(order.id, 'ACCEPTED', SHOP, { shopId: DEV_SHOP_ID });
        await advanceOrder(order.id, 'IN_PRODUCTION', SHOP);
        await advanceOrder(order.id, 'QA_PASSED', SHOP);
        let concurrent: Promise<unknown> | null = null;
        const original = DevPaymentProvider.prototype.refund;
        const spy = vi.spyOn(DevPaymentProvider.prototype, 'refund').mockImplementation(async function (this: DevPaymentProvider, input) {
            // The shop ships while the provider round trip is in flight.
            concurrent = advanceOrder(order.id, 'SHIPPED', SHOP).then(
                () => 'shipped',
                (err: unknown) => err,
            );
            await new Promise((r) => setTimeout(r, 150));
            return original.call(this, input);
        });
        try {
            await refundOrder(order.id, OPS, 'Buyer cancelled');
        } finally {
            spy.mockRestore();
        }
        expect(await concurrent).toBeInstanceOf(IllegalTransitionError); // REFUNDED -> SHIPPED is refused
        const [after] = await ctx.db.select().from(orders).where(eq(orders.id, order.id));
        expect(after.status).toBe('REFUNDED');
        const [payment] = await ctx.db.select().from(payments).where(eq(payments.orderId, order.id));
        expect(payment.status).toBe('REFUNDED');
        expect(ledgerBalances(await getOrderLedger(order.id)).CASH).toBe(0);
    });

    it('refuses to refund after shipping (state machine)', async () => {
        const order = await paidOrder();
        await runToDelivered(order.id);
        await expect(refundOrder(order.id, OPS, 'too late')).rejects.toBeInstanceOf(IllegalTransitionError);
        const refunds = await ctx.db.select().from(ledgerEntries).where(eq(ledgerEntries.txnKey, `refund:${order.id}`));
        expect(refunds).toHaveLength(0);
    });
});
