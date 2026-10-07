/**
 * Payment providers.
 *
 * OWNER: orders agent. Signatures FINAL.
 *
 * - `stripe`: Stripe Checkout Session (hosted, card/ACH/Apple Pay/Google Pay),
 *   webhook verified with STRIPE_WEBHOOK_SECRET. Amount comes from the order row.
 * - `dev`: test double, ONLY when PAYMENT_PROVIDER=dev and NODE_ENV !== 'production'
 *   (`assertNotProduction('dev payment provider')`). Its redirectUrl is the UI page
 *   `/checkout/dev-pay?ref=<providerRef>` which calls POST /api/webhooks/dev-payment.
 */
import type { PaymentProviderName } from '../../contracts/enums';
import { env } from '../env';
import { DevPaymentProvider } from './dev';
import { StripePaymentProvider } from './stripe';
import type { PaymentProvider } from './types';

export type { CreatePaymentInput, CreatePaymentResult, PaymentProvider, PaymentWebhookEvent } from './types';
export { DevPaymentProvider, DevPaymentNotFoundError, isDevPaymentEnabled } from './dev';
export { StripePaymentProvider, STRIPE_ORDER_METADATA_KEY, createConnectTransfer, isStripeConfigured, normalizeStripeEvent } from './stripe';

/** Provider by name (webhooks are routed per provider regardless of PAYMENT_PROVIDER). */
export function getPaymentProviderByName(name: PaymentProviderName): PaymentProvider {
    switch (name) {
        case 'stripe':
            return new StripePaymentProvider();
        case 'dev':
            return new DevPaymentProvider();
        default: {
            // A stored or configured name we do not know must never fall through to real money.
            const unknown: never = name;
            throw new Error(`Unknown payment provider: ${String(unknown)}`);
        }
    }
}

/** The configured provider (PAYMENT_PROVIDER=stripe|dev). */
export function getPaymentProvider(): PaymentProvider {
    return getPaymentProviderByName(env().PAYMENT_PROVIDER);
}
