/**
 * Payment provider types (shared by the stripe + dev adapters and the orders module).
 */
import type { PaymentProviderName } from '../../contracts/enums';

export type CreatePaymentInput = {
    orderId: string;
    orderNumber: string;
    amountCents: number;
    currency: string;
    buyerEmail: string;
    /** Line shown on the provider's checkout page, e.g. "DMO-7K3QX · 10 x bracket.dxf". */
    description: string;
    successUrl: string;
    cancelUrl: string;
    metadata: Record<string, string>;
    /** Optional: when the hosted session should stop accepting payment (clamped to provider limits). */
    expiresAt?: Date;
    /**
     * R4 Build Slots: `manual` authorizes only (Stripe `capture_method: 'manual'`, card only);
     * the money moves later with `capture()` or is released with `cancelAuthorization()`.
     * Default `automatic`.
     */
    captureMethod?: 'automatic' | 'manual';
    /**
     * Optional provider idempotency key. Default `checkout:<orderId>` (one session per order);
     * R3 balance payments pass `balance:<orderId>:<n>` so they never collide with the deposit session.
     */
    idempotencyKey?: string;
};

export type CaptureInput = { providerRef: string; providerPaymentId: string | null; amountCents: number };
export type CancelAuthorizationInput = { providerRef: string; providerPaymentId: string | null; reason?: string };

export type CreatePaymentResult = {
    /** Unique per provider; stored as payments.provider_ref (Stripe: Checkout Session id). */
    providerRef: string;
    redirectUrl: string;
};

/** Normalized, signature-verified webhook event. */
export type PaymentWebhookEvent =
    | {
          kind: 'payment.succeeded';
          /** Provider event id, used for webhook_events idempotency. */
          eventId: string;
          providerRef: string;
          providerPaymentId: string | null;
          amountCents: number;
          currency: string;
      }
    | {
          kind: 'payment.failed';
          eventId: string;
          providerRef: string;
          reason: string | null;
      }
    | {
          /**
           * Stripe backup path: a PaymentIntent succeeded and only the order id is known
           * (from metadata). The webhook route resolves the provider_ref from `payments`.
           */
          kind: 'payment_intent.succeeded';
          eventId: string;
          orderId: string;
          providerPaymentId: string;
          amountCents: number;
          currency: string;
      }
    | {
          /** A refund happened at the provider (ours via refundOrder, or one issued in the Stripe Dashboard). */
          kind: 'payment.refunded';
          eventId: string;
          providerPaymentId: string;
          amountRefundedCents: number;
          fullyRefunded: boolean;
          refundRef: string | null;
      }
    | {
          /** Manual-capture session completed: funds are held, not captured (R4 Build Slots). */
          kind: 'payment.authorized';
          eventId: string;
          providerRef: string;
          providerPaymentId: string | null;
          amountCents: number;
          currency: string;
      }
    | {
          /** Stripe backup path for a manual-capture PaymentIntent (`amount_capturable_updated`), by order id. */
          kind: 'payment_intent.authorized';
          eventId: string;
          orderId: string;
          providerPaymentId: string;
          amountCents: number;
          currency: string;
      }
    | { kind: 'ignored'; eventId: string; type: string };

export interface PaymentProvider {
    readonly name: PaymentProviderName;
    /** Create a hosted payment session for an order. */
    createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
    /**
     * Verify the webhook signature and normalize the event.
     * @throws Error on signature failure (route answers 400).
     */
    parseWebhook(rawBody: string, headers: Headers): Promise<PaymentWebhookEvent>;
    /** Refund all or part of a succeeded payment. */
    refund(input: { providerRef: string; providerPaymentId: string | null; amountCents: number; reason?: string }): Promise<{ refundRef: string }>;
    /** Capture an authorized (manual-capture) payment. Idempotent per payment at the provider. */
    capture(input: CaptureInput): Promise<{ providerPaymentId: string }>;
    /** Release an authorization, or expire an unpaid session, so nothing is charged. Idempotent. */
    cancelAuthorization(input: CancelAuthorizationInput): Promise<{ released: boolean }>;
}
