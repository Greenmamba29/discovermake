/**
 * Dev payment provider: a TEST DOUBLE for local development and e2e.
 *
 * Only usable when PAYMENT_PROVIDER=dev AND NODE_ENV !== 'production'
 * (`assertNotProduction` on construction and on every call). Its "hosted page" is
 * the UI route `/checkout/dev-pay?ref=<providerRef>`, which posts to
 * POST /api/webhooks/dev-payment. That route runs the SAME webhook pipeline
 * (webhook_events dedupe -> handlePaymentSucceeded / handlePaymentFailed) as Stripe.
 */
import { and, eq } from 'drizzle-orm';
import { DevPaymentConfirmRequest } from '../../contracts/checkout';
import { getDb } from '../db';
import { payments } from '../db/schema';
import { assertNotProduction, env } from '../env';
import { randomBase32 } from '../ids';
import type { CancelAuthorizationInput, CaptureInput, CreatePaymentInput, CreatePaymentResult, PaymentProvider, PaymentWebhookEvent } from './types';

/** payments.metadata key set by callers that created a manual-capture (authorize-only) payment. */
export const CAPTURE_METHOD_METADATA_KEY = 'captureMethod';

const FEATURE = 'dev payment provider';

export class DevPaymentProvider implements PaymentProvider {
    readonly name = 'dev' as const;

    constructor() {
        assertNotProduction(FEATURE);
    }

    async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
        assertNotProduction(FEATURE);
        void input;
        const providerRef = `devpay_${randomBase32(24).toLowerCase()}`;
        const url = new URL('/checkout/dev-pay', env().APP_URL);
        url.searchParams.set('ref', providerRef);
        return { providerRef, redirectUrl: url.toString() };
    }

    /**
     * The dev "webhook" body is a DevPaymentConfirmRequest. There is no signature; the
     * route itself is disabled unless PAYMENT_PROVIDER=dev outside production. The
     * amount is the amount the payment session was created for (like a real provider).
     */
    async parseWebhook(rawBody: string, headers: Headers): Promise<PaymentWebhookEvent> {
        assertNotProduction(FEATURE);
        void headers;
        let raw: unknown;
        try {
            raw = JSON.parse(rawBody);
        } catch {
            throw new Error('Dev payment webhook body must be JSON');
        }
        const body = DevPaymentConfirmRequest.parse(raw);
        const [payment] = await getDb()
            .select()
            .from(payments)
            .where(and(eq(payments.provider, 'dev'), eq(payments.providerRef, body.providerRef)))
            .limit(1);
        // R3: a cart checkout / invoice pays several orders under one group reference.
        const group = payment ? null : await (await import('../cart/payment-group')).findGroupByRef('dev', body.providerRef);
        if (!payment && !group) throw new DevPaymentNotFoundError(body.providerRef);
        const amount = payment ? { amountCents: payment.amountCents, currency: payment.currency } : { amountCents: group!.amountCents, currency: group!.currency };
        const eventId = `dev:${body.providerRef}:${body.outcome}`;
        const manual = (payment?.metadata as Record<string, unknown> | null | undefined)?.[CAPTURE_METHOD_METADATA_KEY] === 'manual';
        if (body.outcome === 'succeeded' && manual && payment) {
            // Authorize-only session (Build Slots): funds are "held"; capture happens at drop close.
            return {
                kind: 'payment.authorized',
                eventId: `dev:${body.providerRef}:authorized`,
                providerRef: body.providerRef,
                providerPaymentId: `devpi_${body.providerRef.slice('devpay_'.length)}`,
                amountCents: payment.amountCents,
                currency: payment.currency,
            };
        }
        if (body.outcome === 'succeeded') {
            return {
                kind: 'payment.succeeded',
                eventId,
                providerRef: body.providerRef,
                providerPaymentId: `devpi_${body.providerRef.replace(/^dev[a-z]+_/, '')}`,
                ...amount,
            };
        }
        return { kind: 'payment.failed', eventId, providerRef: body.providerRef, reason: 'Declined in dev payment page' };
    }

    async refund(input: { providerRef: string; providerPaymentId: string | null; amountCents: number; reason?: string }): Promise<{ refundRef: string }> {
        assertNotProduction(FEATURE);
        void input;
        return { refundRef: `devrefund_${randomBase32(20).toLowerCase()}` };
    }

    async capture(input: CaptureInput): Promise<{ providerPaymentId: string }> {
        assertNotProduction(FEATURE);
        return { providerPaymentId: input.providerPaymentId ?? `devpi_${input.providerRef.slice('devpay_'.length)}` };
    }

    async cancelAuthorization(input: CancelAuthorizationInput): Promise<{ released: boolean }> {
        assertNotProduction(FEATURE);
        void input;
        return { released: true };
    }
}

export class DevPaymentNotFoundError extends Error {
    constructor(public readonly providerRef: string) {
        super(`No dev payment session ${providerRef}`);
        this.name = 'DevPaymentNotFoundError';
    }
}

/** True when the dev payment double may run (PAYMENT_PROVIDER=dev and not production). */
export function isDevPaymentEnabled(): boolean {
    return env().PAYMENT_PROVIDER === 'dev' && process.env.NODE_ENV !== 'production';
}
