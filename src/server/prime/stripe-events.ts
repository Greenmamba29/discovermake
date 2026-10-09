/**
 * R3 Stripe events on the existing signature-verified webhook (POST /api/webhooks/stripe):
 *   customer.subscription.created / updated / deleted  → Prime membership lifecycle
 *   invoice.paid / invoice.overdue / invoice.voided      → B2B invoices (metadata.dm_invoice_id)
 * Everything else (orders) continues through the payment pipeline. Each event is processed
 * exactly once (webhook_events) by its handler.
 */
import type Stripe from 'stripe';
import { env } from '../env';
import { findInvoiceByProviderId, markInvoiceOverdue, settleInvoice, voidInvoice } from '../invoices';
import { processOnce } from '../r3/webhook-dedupe';
import { snapshotFromStripeSubscription } from './billing';
import { processMembershipEvent } from './membership';

function appHost(): string | null {
    try {
        return new URL(env().APP_URL).host;
    } catch {
        return null;
    }
}

/** Route a VERIFIED Stripe event. Returns true when an R3 handler owned it. */
export async function routeStripeExtensionEvent(event: Stripe.Event): Promise<boolean> {
    const obj = event.data.object as { metadata?: Record<string, string> | null };
    const host = appHost();
    if (host && obj.metadata?.dm_app && obj.metadata.dm_app !== host) return false;

    switch (event.type) {
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted': {
            const sub = event.data.object as Stripe.Subscription;
            if (!sub.metadata?.dm_membership_id && !sub.metadata?.dm_user_id) return false;
            const snap = snapshotFromStripeSubscription(sub, event);
            if (event.type === 'customer.subscription.deleted') snap.status = 'canceled';
            await processMembershipEvent(snap);
            return true;
        }
        case 'invoice.paid':
        case 'invoice.overdue':
        case 'invoice.voided':
        case 'invoice.marked_uncollectible': {
            const inv = event.data.object as Stripe.Invoice;
            if (!inv.metadata?.dm_invoice_id || !inv.id) return false;
            const row = await findInvoiceByProviderId('stripe', inv.id);
            if (!row) return false;
            if (event.type === 'invoice.paid') {
                const raw = inv as unknown as { payment_intent?: string | { id: string } | null };
                const pi = typeof raw.payment_intent === 'string' ? raw.payment_intent : (raw.payment_intent?.id ?? null);
                await settleInvoice(row, { eventId: event.id, method: 'provider', amountCents: inv.amount_paid, currency: inv.currency, providerPaymentId: pi, actor: { kind: 'payment_provider', id: 'stripe' } });
            } else if (event.type === 'invoice.overdue') {
                await processOnce('stripe', event.id, event.type, { invoiceId: row.id }, () => markInvoiceOverdue(row, { kind: 'payment_provider', id: 'stripe' }));
            } else {
                await voidInvoice(row, event.id);
            }
            return true;
        }
        default:
            return false;
    }
}
