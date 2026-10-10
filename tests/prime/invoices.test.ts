import { and, eq, inArray } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { CartCheckoutResponse, InvoiceView } from '@/contracts/prime';
import { domainEvents, invoices, orders, payments } from '@/server/db/schema';
import { POST as invoiceCheckout } from '@/app/api/checkout/invoice/route';
import { POST as devInvoice } from '@/app/api/admin/prime/invoices/[invoiceId]/dev/route';
import { POST as wireRoute } from '@/app/api/admin/prime/invoices/[invoiceId]/wire/route';
import { settleInvoice } from '@/server/invoices';
import { useTestDb as withTestDb } from '../support/db';
import { createQuoteFixture, quietConsole } from '../orders/fixtures';
import { params, req } from '../accounts/helpers';

const { dispatched } = vi.hoisted(() => ({ dispatched: [] as string[] }));
vi.mock('@/server/dispatch', async (orig) => ({ ...(await orig<typeof import('@/server/dispatch')>()), dispatchOrder: async (id: string) => (dispatched.push(id), null), expireStaleOffers: async () => 0 }));

const ctx = withTestDb({ seed: true });
beforeAll(() => quietConsole());

const ADMIN = { authorization: 'Bearer test-admin-token' };
const body = (quoteId: string, overrides: Record<string, unknown> = {}) => ({
    quoteId,
    shippingMethod: 'STANDARD',
    buyer: { email: 'buyer@acme.example', name: 'Grace Buyer' },
    shippingAddress: { name: 'Grace Buyer', company: 'Acme Robotics', line1: '1 Dock Rd', city: 'Camden', region: 'NJ', postalCode: '08102', country: 'US' },
    acceptTerms: true,
    netDays: 30,
    poNumber: 'PO-7781',
    ...overrides,
});

async function productionEvents(orderId: string) {
    return ctx.db.select().from(domainEvents).where(and(eq(domainEvents.orderId, orderId), eq(domainEvents.eventType, 'production.authorized')));
}

describe('B2B invoices (dev provider)', () => {
    it('requires a company (business buyers only)', async () => {
        const { quote } = await createQuoteFixture(ctx.db);
        const b = body(quote.id);
        const res = await invoiceCheckout(req('POST', '/api/checkout/invoice', null, { ...b, shippingAddress: { ...b.shippingAddress, company: undefined } }), params({}));
        expect(res.status).toBe(400);
    });

    it('creates an open net-30 invoice; production stays blocked until it is paid', async () => {
        const { quote } = await createQuoteFixture(ctx.db, { quantity: 10, unitPriceCents: 500 });
        const res = await invoiceCheckout(req('POST', '/api/checkout/invoice', null, body(quote.id)), params({}));
        expect(res.status).toBe(201);
        const out = CartCheckoutResponse.parse(await res.json());
        expect(out.invoice).toMatchObject({ status: 'open', netDays: 30, company: 'Acme Robotics', poNumber: 'PO-7781', amountCents: 5000 + 1500 });
        const orderId = out.orders[0].orderId;
        const [order] = await ctx.db.select().from(orders).where(eq(orders.id, orderId));
        expect(order.status).toBe('PENDING_PAYMENT');
        expect(await productionEvents(orderId)).toHaveLength(0);
        expect(dispatched).not.toContain(orderId);

        // Overdue: flagged + ops alerted, still not produced.
        const overdue = InvoiceView.parse(await (await devInvoice(req('POST', `/api/admin/prime/invoices/${out.invoice!.id}/dev`, null, { outcome: 'overdue' }, ADMIN), params({ invoiceId: out.invoice!.id }))).json());
        expect(overdue.status).toBe('overdue');
        expect((await ctx.db.select().from(orders).where(eq(orders.id, orderId)))[0].status).toBe('PENDING_PAYMENT');

        // Paid: the order becomes PAID and production is authorized (dispatch runs).
        const paid = InvoiceView.parse(await (await devInvoice(req('POST', `/api/admin/prime/invoices/${out.invoice!.id}/dev`, null, { outcome: 'paid' }, ADMIN), params({ invoiceId: out.invoice!.id }))).json());
        expect(paid.status).toBe('paid');
        expect((await ctx.db.select().from(orders).where(eq(orders.id, orderId)))[0].status).toBe('PAID');
        expect(await productionEvents(orderId)).toHaveLength(1);
        expect(dispatched).toContain(orderId);
        // Replays never double-pay.
        await devInvoice(req('POST', `/api/admin/prime/invoices/${out.invoice!.id}/dev`, null, { outcome: 'paid' }, ADMIN), params({ invoiceId: out.invoice!.id }));
        expect(await productionEvents(orderId)).toHaveLength(1);
    });

    it('lets ops mark a wire received manually (audited)', async () => {
        const { quote } = await createQuoteFixture(ctx.db);
        const out = CartCheckoutResponse.parse(await (await invoiceCheckout(req('POST', '/api/checkout/invoice', null, body(quote.id, { netDays: 15 })), params({}))).json());
        const id = out.invoice!.id;
        expect((await wireRoute(req('POST', `/api/admin/prime/invoices/${id}/wire`, null, { reference: 'FED-REF-0042' }), params({ invoiceId: id }))).status).toBe(401);
        const res = await wireRoute(req('POST', `/api/admin/prime/invoices/${id}/wire`, null, { reference: 'FED-REF-0042' }, ADMIN), params({ invoiceId: id }));
        expect(res.status).toBe(200);
        expect(InvoiceView.parse(await res.json())).toMatchObject({ status: 'paid', paidReference: 'FED-REF-0042' });
        const [row] = await ctx.db.select().from(invoices).where(eq(invoices.id, id));
        expect(row.markedPaidBy).toBe('admin:ops');
        const evts = await ctx.db.select().from(domainEvents).where(eq(domainEvents.eventType, 'invoice.paid'));
        expect(evts.some((e) => (e.payload as { invoiceId: string; method: string }).invoiceId === id && (e.payload as { method: string }).method === 'manual_wire')).toBe(true);
        const pays = await ctx.db.select().from(payments).where(inArray(payments.orderId, out.orders.map((o) => o.orderId)));
        expect(pays.every((p) => p.status === 'SUCCEEDED')).toBe(true);
        expect((await wireRoute(req('POST', `/api/admin/prime/invoices/${id}/wire`, null, { reference: 'again' }, ADMIN), params({ invoiceId: id }))).status).toBe(409);
    });

    it('a payment that does not match the invoice leaves it open and the orders unpaid', async () => {
        const { quote } = await createQuoteFixture(ctx.db);
        const out = CartCheckoutResponse.parse(await (await invoiceCheckout(req('POST', '/api/checkout/invoice', null, body(quote.id)), params({}))).json());
        const [row] = await ctx.db.select().from(invoices).where(eq(invoices.id, out.invoice!.id));
        const settled = await settleInvoice(row, { eventId: `short:${row.id}`, method: 'provider', amountCents: row.amountCents - 100, currency: row.currency, actor: { kind: 'payment_provider', id: 'dev' } });
        expect(settled.status).toBe('open');
        expect((await ctx.db.select().from(invoices).where(eq(invoices.id, row.id)))[0].status).toBe('open');
        const [order] = await ctx.db.select().from(orders).where(eq(orders.id, out.orders[0].orderId));
        expect(order.status).toBe('PENDING_PAYMENT');
        expect(await productionEvents(order.id)).toHaveLength(0);
    });
});
