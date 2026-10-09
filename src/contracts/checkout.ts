/**
 * Checkout contracts.
 *
 * POST /api/checkout                 CheckoutRequest          -> CheckoutResponse (201)
 * POST /api/webhooks/stripe          raw Stripe event (signature-verified)  -> { received: true }
 * POST /api/webhooks/dev-payment     DevPaymentConfirmRequest -> DevPaymentConfirmResponse
 *        (only when PAYMENT_PROVIDER=dev AND NODE_ENV !== 'production')
 *
 * Server-side pricing only: the request carries ids + buyer details, never amounts.
 * The server reads unit price, subtotal and the chosen shipping price from the
 * immutable quote snapshot, derives order_type from quantity, and creates the
 * order in PENDING_PAYMENT with a payment session at the provider.
 */
import { z } from 'zod';
import { OrderStatus, OrderType, PaymentProviderName, ShippingMethod } from './enums';
import { Address, Cents, Email, IsoDate, OrderId, QuoteId } from './common';

export const CheckoutRequest = z.object({
    quoteId: QuoteId,
    shippingMethod: ShippingMethod,
    buyer: z.object({
        email: Email,
        name: z.string().trim().min(1).max(120),
        phone: z.string().trim().max(32).optional(),
    }),
    shippingAddress: Address,
    /** Terms · Production Policy · Quality Guarantee acknowledgement. Must be literally true. */
    acceptTerms: z.literal(true),
    /** Optional note to the shop, max 1000 chars. */
    notes: z.string().trim().max(1000).optional(),
});
export type CheckoutRequest = z.infer<typeof CheckoutRequest>;

export const CheckoutTotals = z.object({
    subtotalCents: Cents,
    shippingCents: Cents,
    /** R1: 0 (Stripe Tax arrives in R2). */
    taxCents: Cents,
    totalCents: Cents,
    currency: z.string(),
});
export type CheckoutTotals = z.infer<typeof CheckoutTotals>;

export const CheckoutResponse = z.object({
    orderId: OrderId,
    orderNumber: z.string(),
    status: OrderStatus,
    orderType: OrderType,
    totals: CheckoutTotals,
    promisedShipDate: IsoDate,
    payment: z.object({
        provider: PaymentProviderName,
        /**
         * R3: what is charged now (order total minus any promise credit, or the deposit for a
         * supplier-route order). Absent on R1 responses, where it equals totals.totalCents.
         */
        amountCents: Cents.optional(),
        /** R3: 'deposit' for supplier-route orders (balance due at shipment), else 'full'. */
        purpose: z.enum(['full', 'deposit']).optional(),
        /** Opaque provider session/intent reference (Stripe Checkout Session id, or dev session id). */
        providerRef: z.string(),
        /** Where the browser goes next: Stripe-hosted Checkout, or the dev pay page. */
        redirectUrl: z.string().url(),
    }),
    /**
     * Signed buyer link to the order tracker (`/orders/:orderId?t=<token>`).
     * The token is shown ONCE here and in the confirmation email; only its HMAC is stored.
     */
    orderUrl: z.string().url(),
    /** R3: promise credit applied to this checkout (cents), when the buyer had one. */
    creditAppliedCents: Cents.optional(),
    /** R3: supplier-route balance charged at shipment. */
    balanceDueCents: Cents.optional(),
});
export type CheckoutResponse = z.infer<typeof CheckoutResponse>;

export const DevPaymentConfirmRequest = z.object({
    providerRef: z.string().min(1).max(200),
    outcome: z.enum(['succeeded', 'failed']),
});
export type DevPaymentConfirmRequest = z.infer<typeof DevPaymentConfirmRequest>;

export const DevPaymentConfirmResponse = z.object({
    orderId: OrderId,
    status: OrderStatus,
    /** Where the dev pay page should send the browser (the signed order URL on success). */
    redirectUrl: z.string().url(),
});
export type DevPaymentConfirmResponse = z.infer<typeof DevPaymentConfirmResponse>;

/** Derive the commerce order type for a catalog part order from quantity (ADR-0004). */
export function orderTypeForQuantity(quantity: number): Extract<OrderType, 'PROTOTYPE' | 'SMALL_BATCH' | 'PRODUCTION_RUN'> {
    if (quantity < 10) return 'PROTOTYPE';
    if (quantity < 250) return 'SMALL_BATCH';
    return 'PRODUCTION_RUN';
}
