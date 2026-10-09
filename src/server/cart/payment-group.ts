/**
 * Payment groups: one provider payment (Stripe Checkout Session / dev session / invoice)
 * that pays for several orders (cart checkout, B2B invoice).
 *
 * Every order keeps its own `payments` row with provider_ref `<group ref>#<n>` and its own
 * amount (= the order total), so refunds, the ledger and the order state machine work per
 * order exactly as for single checkout. A provider event for the GROUP reference is fanned
 * out here into one `handlePaymentSucceeded` / `handlePaymentFailed` per order, after the
 * group amount is verified against the sum of its orders.
 *
 * Hooked into the shared webhook pipeline (src/server/orders/webhooks.ts) and the dev
 * payment double (src/server/payments/dev.ts, src/server/orders/dev-payment.ts).
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { PaymentProviderName } from '../../contracts/enums';
import { buildOrderUrl, verifyOrderAccessToken } from '../auth/order-link';
import { getDb } from '../db';
import { cartCheckouts, orders, payments } from '../db/schema';
import { env } from '../env';
import { notify } from '../notify';
import { openOrderToken } from '../orders/link-vault';
import type { PaymentWebhookEvent } from '../payments/types';

export type CartCheckoutRow = typeof cartCheckouts.$inferSelect;

export const GROUP_ID_PREFIX = 'cco_';

export function subRef(groupRef: string, index: number): string {
    return `${groupRef}#${index + 1}`;
}

export async function findGroupByRef(provider: PaymentProviderName, providerRef: string): Promise<CartCheckoutRow | null> {
    const [row] = await getDb()
        .select()
        .from(cartCheckouts)
        .where(and(eq(cartCheckouts.provider, provider), eq(cartCheckouts.providerRef, providerRef)))
        .limit(1);
    return row ?? null;
}

export async function findGroupById(id: string): Promise<CartCheckoutRow | null> {
    const [row] = await getDb().select().from(cartCheckouts).where(eq(cartCheckouts.id, id)).limit(1);
    return row ?? null;
}

/** Signed confirmation page for a checkout group: /cart/done/<id>?t=<token>. */
export function groupConfirmationUrl(groupId: string, token: string): string {
    const u = new URL(`/cart/done/${encodeURIComponent(groupId)}`, env().APP_URL);
    u.searchParams.set('t', token);
    return u.toString();
}

export function groupUrlFromRow(row: CartCheckoutRow): string | null {
    const token = openOrderToken(row.id, row.sealedToken);
    return token ? groupConfirmationUrl(row.id, token) : null;
}

export function verifyGroupToken(row: CartCheckoutRow, token: string | null | undefined): boolean {
    return verifyOrderAccessToken(row.id, token, row.accessTokenHash);
}

async function orderPayments(group: CartCheckoutRow) {
    const refs = group.orderIds.map((_, i) => subRef(group.providerRef, i));
    const rows = await getDb()
        .select()
        .from(payments)
        .where(and(eq(payments.provider, group.provider), inArray(payments.providerRef, refs)));
    const byRef = new Map(rows.map((r) => [r.providerRef, r]));
    return refs.map((ref) => byRef.get(ref)).filter((p): p is NonNullable<typeof p> => Boolean(p));
}

/**
 * Handle a normalized payment event when it belongs to a group. Returns undefined when it
 * does not (the caller continues with the single-order pipeline), else the first order id.
 */
export async function dispatchGroupPaymentEvent(provider: PaymentProviderName, event: PaymentWebhookEvent): Promise<string | null | undefined> {
    let group: CartCheckoutRow | null = null;
    if (event.kind === 'payment.succeeded' || event.kind === 'payment.failed') group = await findGroupByRef(provider, event.providerRef);
    else if (event.kind === 'payment_intent.succeeded' && event.orderId.startsWith(GROUP_ID_PREFIX)) group = await findGroupById(event.orderId);
    if (!group) return undefined;

    const { handlePaymentFailed, handlePaymentSucceeded } = await import('../orders/payment-events');
    const rows = await orderPayments(group);
    const first = group.orderIds[0] ?? null;
    if (rows.length !== group.orderIds.length) throw new Error(`Payment group ${group.id} is missing order payments`);

    if (event.kind === 'payment.failed') {
        for (const p of rows) await handlePaymentFailed({ provider, providerRef: p.providerRef, reason: event.reason, eventId: `${event.eventId}#${p.orderId}` });
        await getDb().update(cartCheckouts).set({ status: 'FAILED', failureReason: event.reason, updatedAt: new Date() }).where(and(eq(cartCheckouts.id, group.id), eq(cartCheckouts.status, 'PENDING')));
        return first;
    }

    const amountCents = event.kind === 'payment.succeeded' || event.kind === 'payment_intent.succeeded' ? event.amountCents : 0;
    const currency = (event as { currency: string }).currency.toLowerCase();
    const providerPaymentId = event.kind === 'payment.succeeded' ? event.providerPaymentId : (event as { providerPaymentId: string }).providerPaymentId;
    const sum = rows.reduce((s, p) => s + p.amountCents, 0);
    if (amountCents !== group.amountCents || currency !== group.currency || sum !== group.amountCents) {
        await getDb().update(cartCheckouts).set({ failureReason: 'AMOUNT_MISMATCH', updatedAt: new Date() }).where(eq(cartCheckouts.id, group.id));
        await notify('ops.alert', {
            subject: `Cart payment amount mismatch on ${group.id}`,
            message: `Provider reported ${amountCents} ${currency} for checkout ${group.id} but its ${rows.length} orders total ${sum} ${group.currency} (group ${group.amountCents}). No order was advanced.`,
            ...(first ? { orderId: first } : {}),
        });
        return first;
    }
    for (const p of rows) {
        await handlePaymentSucceeded({ provider, providerRef: p.providerRef, providerPaymentId, amountCents: p.amountCents, currency: p.currency, eventId: `${event.eventId}#${p.orderId}` });
    }
    await getDb().update(cartCheckouts).set({ status: 'SUCCEEDED', failureReason: null, updatedAt: new Date() }).where(eq(cartCheckouts.id, group.id));
    return first;
}

/** Orders of a group for the confirmation page (only with a valid group token). */
export async function groupOrders(group: CartCheckoutRow) {
    const rows = await getDb()
        .select({ order: orders, payment: payments })
        .from(orders)
        .innerJoin(payments, eq(payments.orderId, orders.id))
        .where(and(inArray(orders.id, group.orderIds), eq(payments.provider, group.provider)));
    const appUrl = env().APP_URL;
    return group.orderIds
        .map((id) => rows.find((r) => r.order.id === id && r.payment.providerRef.startsWith(`${group.providerRef}#`)))
        .filter((r): r is NonNullable<typeof r> => Boolean(r))
        .map(({ order, payment }) => {
            const token = openOrderToken(order.id, (payment.metadata as Record<string, unknown>)?.orderLinkSealed);
            return {
                orderId: order.id,
                orderNumber: order.orderNumber,
                status: order.status,
                totalCents: order.totalCents,
                currency: order.currency,
                orderUrl: token ? buildOrderUrl(order.id, token, appUrl) : null,
            };
        });
}
