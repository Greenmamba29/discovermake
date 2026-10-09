/**
 * B2B "Pay by invoice (ACH / wire)".
 *
 * - `stripe`: a Stripe Invoice (collection_method `send_invoice`, `days_until_due` = net 15/30,
 *   `payment_settings.payment_method_types: ['us_bank_account', 'customer_balance']` so the
 *   buyer pays by ACH debit or bank transfer). Stripe emails it; `invoice.paid` /
 *   `invoice.overdue` / `invoice.voided` arrive through POST /api/webhooks/stripe.
 * - `dev`: test double; POST /api/admin/prime/invoices/:id/dev simulates paid / overdue.
 *
 * The invoice pays a payment group (src/server/cart/payment-group.ts): its orders stay
 * PENDING_PAYMENT, so nothing is dispatched or produced until the invoice is paid (order
 * state machine, ADR-0007). Ops can mark a wire received manually (audited: who, reference,
 * domain event).
 */
import { desc, eq, inArray } from 'drizzle-orm';
import type { Actor } from '../../contracts/common';
import type { InvoiceView } from '../../contracts/prime';
import { getDb, withTx, type DbOrTx } from '../db';
import { cartCheckouts, invoices, orders } from '../db/schema';
import { assertNotProduction, env } from '../env';
import { emitEvent } from '../events/outbox';
import { ApiError } from '../http';
import { randomBase32 } from '../ids';
import { notify } from '../notify';
import { processPaymentWebhook } from '../orders/webhooks';
import { getStripeClient } from '../payments/stripe';

export type InvoiceRow = typeof invoices.$inferSelect;

export type CreateInvoiceInput = {
    invoiceId: string;
    checkoutId: string;
    email: string;
    name: string;
    company: string;
    amountCents: number;
    currency: string;
    netDays: 15 | 30;
    poNumber?: string;
    lines: { description: string; amountCents: number }[];
};

export type CreatedInvoice = { providerInvoiceId: string; hostedUrl: string | null };

export interface InvoiceProvider {
    readonly name: 'stripe' | 'dev';
    create(input: CreateInvoiceInput): Promise<CreatedInvoice>;
    markPaidOutOfBand(providerInvoiceId: string): Promise<void>;
}

export class StripeInvoiceProvider implements InvoiceProvider {
    readonly name = 'stripe' as const;

    async create(input: CreateInvoiceInput): Promise<CreatedInvoice> {
        const stripe = getStripeClient();
        const metadata = { dm_invoice_id: input.invoiceId, dm_checkout_id: input.checkoutId, dm_app: new URL(env().APP_URL).host };
        const found = await stripe.customers.list({ email: input.email, limit: 1 });
        const customer =
            found.data[0] ?? (await stripe.customers.create({ email: input.email, name: input.company, description: input.name, metadata: { dm_buyer_name: input.name } }, { idempotencyKey: `customer:${input.invoiceId}` }));
        const invoice = await stripe.invoices.create(
            {
                customer: customer.id,
                collection_method: 'send_invoice',
                days_until_due: input.netDays,
                auto_advance: false,
                currency: input.currency,
                payment_settings: { payment_method_types: ['us_bank_account', 'customer_balance'] },
                metadata,
                ...(input.poNumber ? { custom_fields: [{ name: 'PO number', value: input.poNumber.slice(0, 30) }] } : {}),
            },
            { idempotencyKey: `invoice:${input.invoiceId}` },
        );
        for (const [i, line] of input.lines.entries()) {
            await stripe.invoiceItems.create(
                { customer: customer.id, invoice: invoice.id, amount: line.amountCents, currency: input.currency, description: line.description.slice(0, 250), metadata },
                { idempotencyKey: `invoice:${input.invoiceId}:line:${i}` },
            );
        }
        const finalized = await stripe.invoices.finalizeInvoice(invoice.id!, {}, { idempotencyKey: `invoice:${input.invoiceId}:finalize` });
        if (finalized.amount_due !== input.amountCents) throw new Error(`Stripe invoice total ${finalized.amount_due} does not match ${input.amountCents}`);
        await stripe.invoices.sendInvoice(finalized.id!, {}, { idempotencyKey: `invoice:${input.invoiceId}:send` });
        return { providerInvoiceId: finalized.id!, hostedUrl: finalized.hosted_invoice_url ?? null };
    }

    async markPaidOutOfBand(providerInvoiceId: string): Promise<void> {
        await getStripeClient().invoices.pay(providerInvoiceId, { paid_out_of_band: true });
    }
}

export class DevInvoiceProvider implements InvoiceProvider {
    readonly name = 'dev' as const;

    constructor() {
        assertNotProduction('dev invoice provider');
    }

    async create(): Promise<CreatedInvoice> {
        assertNotProduction('dev invoice provider');
        return { providerInvoiceId: `devinv_${randomBase32(20).toLowerCase()}`, hostedUrl: null };
    }

    async markPaidOutOfBand(): Promise<void> {
        assertNotProduction('dev invoice provider');
    }
}

export function getInvoiceProvider(): InvoiceProvider {
    return env().PAYMENT_PROVIDER === 'dev' ? new DevInvoiceProvider() : new StripeInvoiceProvider();
}

export function dueDateFor(netDays: number, now: Date = new Date()): string {
    return new Date(now.getTime() + netDays * 86_400_000).toISOString().slice(0, 10);
}

export async function toInvoiceView(row: InvoiceRow, db: DbOrTx = getDb()): Promise<InvoiceView> {
    const [group] = await db.select({ orderIds: cartCheckouts.orderIds }).from(cartCheckouts).where(eq(cartCheckouts.id, row.checkoutId));
    const ids = group?.orderIds ?? [];
    const numbers = ids.length ? await db.select({ id: orders.id, orderNumber: orders.orderNumber }).from(orders).where(inArray(orders.id, ids)) : [];
    return {
        id: row.id,
        status: row.status,
        provider: row.provider,
        amountCents: row.amountCents,
        currency: row.currency,
        netDays: row.netDays,
        dueDate: row.dueDate,
        hostedUrl: row.hostedUrl,
        orderIds: ids,
        orderNumbers: ids.map((id) => numbers.find((n) => n.id === id)?.orderNumber ?? id),
        company: row.company,
        buyerEmail: row.buyerEmail,
        poNumber: row.poNumber,
        paidAt: row.paidAt ? row.paidAt.toISOString() : null,
        paidReference: row.paidReference,
        createdAt: row.createdAt.toISOString(),
    };
}

export async function getInvoice(invoiceId: string): Promise<InvoiceRow | null> {
    const [row] = await getDb().select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
    return row ?? null;
}

export async function findInvoiceByProviderId(provider: 'stripe' | 'dev', providerInvoiceId: string): Promise<InvoiceRow | null> {
    const [row] = await getDb().select().from(invoices).where(eq(invoices.providerInvoiceId, providerInvoiceId)).limit(1);
    return row && row.provider === provider ? row : null;
}

export async function listInvoices(limit = 50): Promise<InvoiceView[]> {
    const rows = await getDb().select().from(invoices).orderBy(desc(invoices.createdAt)).limit(limit);
    return Promise.all(rows.map((r) => toInvoiceView(r)));
}

/**
 * The invoice was paid (provider event, dev simulation or manual wire). Pays the group's
 * orders through the shared payment pipeline (exactly once per `eventId`), then records the
 * invoice as paid with an `invoice.paid` event. Idempotent.
 */
export async function settleInvoice(
    row: InvoiceRow,
    input: { eventId: string; method: 'provider' | 'manual_wire'; amountCents: number; currency: string; providerPaymentId?: string | null; reference?: string | null; actor: Actor },
): Promise<InvoiceRow> {
    if (row.status === 'void') throw new ApiError('CONFLICT', 'This invoice was voided.');
    await processPaymentWebhook(
        row.provider,
        { kind: 'payment.succeeded', eventId: input.eventId, providerRef: row.providerInvoiceId, providerPaymentId: input.providerPaymentId ?? null, amountCents: input.amountCents, currency: input.currency },
        { invoiceId: row.id, method: input.method },
    );
    return withTx(async (tx) => {
        const [locked] = await tx.select().from(invoices).where(eq(invoices.id, row.id)).for('update');
        if (locked.status === 'paid') return locked;
        const now = new Date();
        const [updated] = await tx
            .update(invoices)
            .set({
                status: 'paid',
                paidAt: now,
                markedPaidBy: input.method === 'manual_wire' ? `${input.actor.kind}:${input.actor.id}` : null,
                paidReference: input.reference ?? null,
                updatedAt: now,
            })
            .where(eq(invoices.id, row.id))
            .returning();
        await emitEvent(tx, {
            type: 'invoice.paid',
            payload: { invoiceId: row.id, checkoutId: row.checkoutId, amountCents: input.amountCents, method: input.method, reference: input.reference ?? null },
            actor: input.actor,
            correlationId: row.checkoutId,
        });
        return updated;
    });
}

/** Ops: a wire / ACH arrived outside the provider. Audited (who + reference + event). */
export async function markWireReceived(invoiceId: string, reference: string, actor: Actor): Promise<InvoiceView> {
    const row = await getInvoice(invoiceId);
    if (!row) throw new ApiError('NOT_FOUND', 'Invoice not found');
    if (row.status === 'paid') throw new ApiError('CONFLICT', 'This invoice is already paid.');
    const provider = row.provider === 'dev' ? new DevInvoiceProvider() : new StripeInvoiceProvider();
    try {
        await provider.markPaidOutOfBand(row.providerInvoiceId);
    } catch (err) {
        console.error('[invoices] marking paid out of band at the provider failed; recording locally', err);
    }
    const settled = await settleInvoice(row, { eventId: `manual-wire:${row.id}`, method: 'manual_wire', amountCents: row.amountCents, currency: row.currency, reference, actor });
    return toInvoiceView(settled);
}

/** Invoice past due: flag it and tell ops (orders stay unpaid; nothing is produced). */
export async function markInvoiceOverdue(row: InvoiceRow, actor: Actor): Promise<InvoiceRow> {
    if (row.status !== 'open') return row;
    const updated = await withTx(async (tx) => {
        const [u] = await tx.update(invoices).set({ status: 'overdue', updatedAt: new Date() }).where(eq(invoices.id, row.id)).returning();
        await emitEvent(tx, { type: 'invoice.overdue', payload: { invoiceId: row.id, checkoutId: row.checkoutId, amountCents: row.amountCents, dueDate: row.dueDate }, actor, correlationId: row.checkoutId });
        return u;
    });
    await notify('ops.alert', {
        subject: `Invoice ${row.id} is overdue`,
        message: `${row.company} (${row.buyerEmail}) has not paid invoice ${row.id} for ${(row.amountCents / 100).toFixed(2)} ${row.currency.toUpperCase()}, due ${row.dueDate}. Its orders are still waiting for payment and have not been produced.`,
    });
    return updated;
}

/** Invoice voided at the provider: its orders' payments fail (orders stay unproduced). */
export async function voidInvoice(row: InvoiceRow, eventId: string): Promise<void> {
    if (row.status === 'paid' || row.status === 'void') return;
    await processPaymentWebhook(row.provider, { kind: 'payment.failed', eventId, providerRef: row.providerInvoiceId, reason: 'Invoice voided' }, { invoiceId: row.id });
    await getDb().update(invoices).set({ status: 'void', updatedAt: new Date() }).where(eq(invoices.id, row.id));
}
