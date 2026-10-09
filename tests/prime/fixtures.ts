/**
 * Fixtures for the R3 suites: a supplier-confirmed offer submitted over a real lease, the buyer's
 * selection approved by ops, the binding quote, checkout and the dev deposit payment.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '@/server/db';
import { approvals, payments } from '@/server/db/schema';
import { createCheckout, handlePaymentSucceeded } from '@/server/orders';
import { createSupplierBindingQuote } from '@/server/prime/quotes';
import { buyerActor } from '@/server/quote/parts';
import { decideApproval, requestOfferSelection } from '@/server/sourcing/approvals';
import { submitOffer, type SubmitOfferArgs } from '@/server/sourcing/offers';
import { checkoutBody } from '../orders/fixtures';
import { ADMIN, createJobFixture, leaseJob, newClient, offerInput, supplierFor } from '../sourcing/fixtures';

export { ADMIN };
export const PARCEL = { lengthIn: 12, widthIn: 10, heightIn: 3, weightOz: 40 };
export const MANUAL = { carrier: 'UPS', service: 'Ground', trackingNumber: '1Z999AA10123456784' };

export async function approvedOffer(db: Db, opts: { quantity?: number; offer?: Partial<SubmitOfferArgs>; supplier?: { name?: string; country?: string; verified?: boolean } } = {}) {
    const quantity = opts.quantity ?? 250;
    const f = await createJobFixture(db, { quantity });
    const client = await newClient();
    const lease = await leaseJob(db, f.job.id, client.clientId);
    const supplier = await supplierFor(f.job.id, lease.writer, { name: opts.supplier?.name ?? 'Da Nang Precision Sheet Metal', country: opts.supplier?.country ?? 'VN', verified: opts.supplier?.verified ?? true });
    const { offer } = await submitOffer(
        offerInput(f.job.id, supplier.id, {
            quantity,
            moq: Math.min(100, quantity),
            unit_price_cents: 640,
            shipping_cents: 18_000,
            production_lead_days: 12,
            shipping_lead_days: 9,
            idempotency_key: `${supplier.id}-binding`,
            ...opts.offer,
        }),
        lease.writer,
    );
    const { approval } = await requestOfferSelection({ buildId: f.build.id, offerId: offer.id, actor: buyerActor(f.build.id) });
    await decideApproval(approval.id, { decision: 'APPROVED' }, ADMIN);
    return { ...f, client, lease, supplier, offer, selectionApprovalId: approval.id };
}

export async function bindingSupplierQuote(db: Db, opts: Parameters<typeof approvedOffer>[1] = {}) {
    const a = await approvedOffer(db, opts);
    const { quote } = await createSupplierBindingQuote(a.build.id, a.offer.id);
    return { ...a, supplierQuote: quote };
}

/** Binding quote -> checkout -> dev deposit payment (PO approvals requested by the outbox subscriber). */
export async function depositPaidOrder(db: Db, opts: Parameters<typeof approvedOffer>[1] & { email?: string } = {}) {
    const b = await bindingSupplierQuote(db, opts);
    const checkout = await createCheckout(checkoutBody(b.supplierQuote.id, { buyer: { email: opts.email ?? 'prime-buyer@example.com', name: 'Prime Buyer' } }));
    const pay = await handlePaymentSucceeded({
        provider: 'dev',
        providerRef: checkout.payment.providerRef,
        providerPaymentId: `devpi_${checkout.payment.providerRef}`,
        amountCents: checkout.payment.amountCents!,
        currency: 'usd',
        eventId: `dev:${checkout.payment.providerRef}:succeeded`,
    });
    return { ...b, checkout, pay, orderId: checkout.orderId };
}

export async function poApprovals(db: Db, orderId: string) {
    const rows = await db.select().from(approvals).where(and(eq(approvals.status, 'PENDING')));
    const mine = rows.filter((a) => a.details?.orderId === orderId);
    return { po: mine.find((a) => a.kind === 'PLACE_PURCHASE_ORDER')!, deposit: mine.find((a) => a.kind === 'PAY_DEPOSIT')!, all: mine };
}

export async function pendingBalance(db: Db, orderId: string) {
    const rows = await db.select().from(payments).where(and(eq(payments.orderId, orderId), eq(payments.status, 'PENDING')));
    return rows.find((p) => p.metadata?.purpose === 'balance') ?? null;
}

export async function payPending(payment: { providerRef: string; amountCents: number }) {
    return handlePaymentSucceeded({
        provider: 'dev',
        providerRef: payment.providerRef,
        providerPaymentId: `devpi_${payment.providerRef}`,
        amountCents: payment.amountCents,
        currency: 'usd',
        eventId: `dev:${payment.providerRef}:succeeded`,
    });
}
