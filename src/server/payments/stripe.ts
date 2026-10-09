/**
 * Stripe payment provider: hosted Stripe Checkout Session (card, ACH Direct Debit,
 * Apple Pay / Google Pay via dynamic payment methods configured in the Dashboard).
 *
 * - Amount comes from the order row (server-priced); the session carries one line
 *   item for the order total, `client_reference_id = orderId` and `metadata.dm_order_id`.
 * - Session creation uses idempotency key `checkout:<orderId>`; refunds `refund:<orderId>`;
 *   Connect transfers `payout:<payoutId>`.
 * - Webhooks are verified with STRIPE_WEBHOOK_SECRET over the RAW body.
 */
import Stripe from 'stripe';
import { env } from '../env';
import type { CancelAuthorizationInput, CaptureInput, CreatePaymentInput, CreatePaymentResult, PaymentProvider, PaymentWebhookEvent } from './types';

/** Metadata key identifying DiscoverMake objects in a shared Stripe account. */
export const STRIPE_ORDER_METADATA_KEY = 'dm_order_id';
/** Metadata marking an authorize-only (manual capture) session, e.g. a Build Slot claim. */
export const STRIPE_CAPTURE_METADATA_KEY = 'dm_capture';

const MIN_SESSION_SECONDS = 30 * 60 + 60; // Stripe minimum is 30 min
const MAX_SESSION_SECONDS = 24 * 60 * 60 - 60; // Stripe maximum is 24 h

let client: Stripe | null = null;
let clientKey: string | null = null;

/** Stripe API client (STRIPE_SECRET_KEY). Throws when the key is missing. */
export function getStripeClient(): Stripe {
    const key = env().STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
    if (!client || clientKey !== key) {
        client = new Stripe(key, { appInfo: { name: 'DiscoverMake', url: 'https://discovermake.com' }, maxNetworkRetries: 2 });
        clientKey = key;
    }
    return client;
}

/** Test seam: inject a Stripe client (e.g. built with `Stripe.createFetchHttpClient(mockFetch)`). Pass null to reset. */
export function setStripeClientForTests(c: Stripe | null): void {
    client = c;
    clientKey = c ? (env().STRIPE_SECRET_KEY ?? null) : null;
}

export function isStripeConfigured(): boolean {
    return !!env().STRIPE_SECRET_KEY;
}

/** Clamp a session expiry to Stripe's allowed window (30 min .. 24 h from now). */
export function sessionExpiry(validUntil: Date | undefined, now: Date = new Date()): number {
    const nowS = Math.floor(now.getTime() / 1000);
    const target = validUntil ? Math.floor(validUntil.getTime() / 1000) : nowS + MAX_SESSION_SECONDS;
    return Math.min(Math.max(target, nowS + MIN_SESSION_SECONDS), nowS + MAX_SESSION_SECONDS);
}

function idOf(value: string | { id: string } | null | undefined): string | null {
    if (!value) return null;
    return typeof value === 'string' ? value : value.id;
}

export class StripePaymentProvider implements PaymentProvider {
    readonly name = 'stripe' as const;

    async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
        const stripe = getStripeClient();
        const manual = input.captureMethod === 'manual';
        const metadata = {
            ...input.metadata,
            [STRIPE_ORDER_METADATA_KEY]: input.orderId,
            dm_order_number: input.orderNumber,
            ...(manual ? { [STRIPE_CAPTURE_METADATA_KEY]: 'manual' } : {}),
        };
        const session = await stripe.checkout.sessions.create(
            {
                mode: 'payment',
                // Authorize-only holds need a card (delayed methods like ACH cannot be captured later).
                ...(manual ? { payment_method_types: ['card'] as Stripe.Checkout.SessionCreateParams.PaymentMethodType[] } : {}),
                client_reference_id: input.orderId,
                customer_email: input.buyerEmail,
                line_items: [
                    {
                        quantity: 1,
                        price_data: {
                            currency: input.currency,
                            unit_amount: input.amountCents,
                            product_data: { name: input.description.slice(0, 250) },
                        },
                    },
                ],
                metadata,
                payment_intent_data: { metadata, description: input.description.slice(0, 1000), ...(manual ? { capture_method: 'manual' as const } : {}) },
                success_url: input.successUrl,
                cancel_url: input.cancelUrl,
                expires_at: sessionExpiry(input.expiresAt),
            },
            { idempotencyKey: `checkout:${input.orderId}` },
        );
        if (!session.url) throw new Error('Stripe did not return a Checkout URL');
        return { providerRef: session.id, redirectUrl: session.url };
    }

    async parseWebhook(rawBody: string, headers: Headers): Promise<PaymentWebhookEvent> {
        const secret = env().STRIPE_WEBHOOK_SECRET;
        if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
        const signature = headers.get('stripe-signature');
        if (!signature) throw new Error('Missing stripe-signature header');
        // Static verifier: no API key needed, constant-time HMAC compare, 5 min tolerance.
        const event = await Stripe.webhooks.constructEventAsync(rawBody, signature, secret);
        return normalizeStripeEvent(event, new URL(env().APP_URL).host);
    }

    async refund(input: { providerRef: string; providerPaymentId: string | null; amountCents: number; reason?: string }): Promise<{ refundRef: string }> {
        const stripe = getStripeClient();
        let paymentIntent = input.providerPaymentId;
        if (!paymentIntent) {
            const session = await stripe.checkout.sessions.retrieve(input.providerRef);
            paymentIntent = idOf(session.payment_intent);
        }
        if (!paymentIntent) throw new Error(`No PaymentIntent for Checkout Session ${input.providerRef}`);
        const refund = await stripe.refunds.create(
            {
                payment_intent: paymentIntent,
                amount: input.amountCents,
                reason: 'requested_by_customer',
                metadata: { dm_provider_ref: input.providerRef, ...(input.reason ? { dm_reason: input.reason.slice(0, 450) } : {}) },
            },
            { idempotencyKey: `refund:${input.providerRef}:${input.amountCents}` },
        );
        return { refundRef: refund.id };
    }

    /** Capture a manual-capture PaymentIntent (idempotency key `capture:<pi>`). */
    async capture(input: CaptureInput): Promise<{ providerPaymentId: string }> {
        const stripe = getStripeClient();
        const pi = input.providerPaymentId ?? (await this.paymentIntentOf(input.providerRef));
        if (!pi) throw new Error(`No PaymentIntent to capture for Checkout Session ${input.providerRef}`);
        const intent = await stripe.paymentIntents.retrieve(pi);
        if (intent.status === 'succeeded') return { providerPaymentId: pi };
        await stripe.paymentIntents.capture(pi, { amount_to_capture: input.amountCents }, { idempotencyKey: `capture:${pi}` });
        return { providerPaymentId: pi };
    }

    /** Release a hold (cancel the PaymentIntent) or expire a still-open Checkout Session. */
    async cancelAuthorization(input: CancelAuthorizationInput): Promise<{ released: boolean }> {
        const stripe = getStripeClient();
        const pi = input.providerPaymentId ?? (await this.paymentIntentOf(input.providerRef));
        if (pi) {
            const intent = await stripe.paymentIntents.retrieve(pi);
            if (intent.status === 'canceled') return { released: true };
            if (intent.status === 'succeeded') return { released: false };
            await stripe.paymentIntents.cancel(pi, { cancellation_reason: 'abandoned' }, { idempotencyKey: `cancel:${pi}` });
            return { released: true };
        }
        const session = await stripe.checkout.sessions.retrieve(input.providerRef);
        if (session.status === 'open') await stripe.checkout.sessions.expire(input.providerRef);
        return { released: true };
    }

    private async paymentIntentOf(sessionId: string): Promise<string | null> {
        const session = await getStripeClient().checkout.sessions.retrieve(sessionId);
        return idOf(session.payment_intent);
    }
}

/**
 * Pure mapping of a verified Stripe event to our normalized event. Exported for tests.
 * Objects created by another DiscoverMake deployment sharing the Stripe account
 * (metadata.dm_app !== appHost) are ignored so environments never cross-process.
 */
export function normalizeStripeEvent(event: Stripe.Event, appHost?: string): PaymentWebhookEvent {
    const meta = (event.data.object as { metadata?: Record<string, string> | null }).metadata;
    if (appHost && meta?.dm_app && meta.dm_app !== appHost) {
        return { kind: 'ignored', eventId: event.id, type: `${event.type}:other-app` };
    }
    switch (event.type) {
        case 'checkout.session.completed':
        case 'checkout.session.async_payment_succeeded': {
            const s = event.data.object;
            if (!s.metadata?.[STRIPE_ORDER_METADATA_KEY]) return { kind: 'ignored', eventId: event.id, type: event.type };
            // Authorize-only session: a completed session with `unpaid` status means the card is held.
            if (s.metadata?.[STRIPE_CAPTURE_METADATA_KEY] === 'manual' && event.type === 'checkout.session.completed' && s.status === 'complete' && s.payment_status === 'unpaid') {
                return {
                    kind: 'payment.authorized',
                    eventId: event.id,
                    providerRef: s.id,
                    providerPaymentId: idOf(s.payment_intent),
                    amountCents: s.amount_total ?? 0,
                    currency: (s.currency ?? 'usd').toLowerCase(),
                };
            }
            // `unpaid` = delayed method (ACH) still processing: wait for async_payment_succeeded/failed.
            if (s.payment_status !== 'paid' && s.payment_status !== 'no_payment_required') {
                return { kind: 'ignored', eventId: event.id, type: `${event.type}:${s.payment_status}` };
            }
            return {
                kind: 'payment.succeeded',
                eventId: event.id,
                providerRef: s.id,
                providerPaymentId: idOf(s.payment_intent),
                amountCents: s.amount_total ?? 0,
                currency: (s.currency ?? 'usd').toLowerCase(),
            };
        }
        case 'checkout.session.async_payment_failed':
        case 'checkout.session.expired': {
            const s = event.data.object;
            if (!s.metadata?.[STRIPE_ORDER_METADATA_KEY]) return { kind: 'ignored', eventId: event.id, type: event.type };
            return {
                kind: 'payment.failed',
                eventId: event.id,
                providerRef: s.id,
                reason: event.type === 'checkout.session.expired' ? 'Checkout session expired before payment' : 'Bank payment failed',
            };
        }
        case 'payment_intent.succeeded': {
            // Backup path (Checkout also sends checkout.session.completed). Resolved to the
            // Checkout Session through our payments table by order id.
            const pi = event.data.object;
            const orderId = pi.metadata?.[STRIPE_ORDER_METADATA_KEY];
            if (!orderId) return { kind: 'ignored', eventId: event.id, type: event.type };
            return {
                kind: 'payment_intent.succeeded',
                eventId: event.id,
                orderId,
                providerPaymentId: pi.id,
                amountCents: pi.amount_received || pi.amount,
                currency: pi.currency.toLowerCase(),
            };
        }
        case 'payment_intent.amount_capturable_updated': {
            // Backup path for authorize-only holds (Checkout also sends checkout.session.completed).
            const pi = event.data.object;
            const orderId = pi.metadata?.[STRIPE_ORDER_METADATA_KEY];
            if (!orderId || pi.metadata?.[STRIPE_CAPTURE_METADATA_KEY] !== 'manual' || pi.status !== 'requires_capture') {
                return { kind: 'ignored', eventId: event.id, type: event.type };
            }
            return { kind: 'payment_intent.authorized', eventId: event.id, orderId, providerPaymentId: pi.id, amountCents: pi.amount_capturable, currency: pi.currency.toLowerCase() };
        }
        case 'payment_intent.payment_failed': {
            // Inside Checkout a declined card is retried on the same page, so a single
            // failed attempt is NOT a terminal failure. Terminal failures arrive as
            // checkout.session.async_payment_failed / checkout.session.expired.
            return { kind: 'ignored', eventId: event.id, type: event.type };
        }
        case 'charge.refunded': {
            const ch = event.data.object;
            const pi = idOf(ch.payment_intent);
            if (!pi) return { kind: 'ignored', eventId: event.id, type: event.type };
            const latestRefund = ch.refunds?.data?.[0]?.id ?? null;
            return {
                kind: 'payment.refunded',
                eventId: event.id,
                providerPaymentId: pi,
                amountRefundedCents: ch.amount_refunded,
                fullyRefunded: ch.refunded,
                refundRef: latestRefund,
            };
        }
        default:
            return { kind: 'ignored', eventId: event.id, type: event.type };
    }
}

/** Create a Stripe Connect transfer for a shop payout (idempotent by payout id). */
export async function createConnectTransfer(input: {
    payoutId: string;
    orderId: string;
    destination: string;
    amountCents: number;
    currency: string;
    providerPaymentId: string | null;
}): Promise<{ transferId: string }> {
    const stripe = getStripeClient();
    let sourceTransaction: string | undefined;
    if (input.providerPaymentId) {
        const pi = await stripe.paymentIntents.retrieve(input.providerPaymentId);
        sourceTransaction = idOf(pi.latest_charge) ?? undefined;
    }
    const transfer = await stripe.transfers.create(
        {
            amount: input.amountCents,
            currency: input.currency,
            destination: input.destination,
            transfer_group: input.orderId,
            ...(sourceTransaction ? { source_transaction: sourceTransaction } : {}),
            metadata: { [STRIPE_ORDER_METADATA_KEY]: input.orderId, dm_payout_id: input.payoutId },
        },
        { idempotencyKey: `payout:${input.payoutId}` },
    );
    return { transferId: transfer.id };
}
