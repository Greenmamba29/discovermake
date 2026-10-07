/**
 * Orders: checkout, payment confirmation, buyer view, and the order state machine.
 *
 * OWNER: orders agent. Owns src/server/{orders,payments,ledger,notify}/**,
 * src/app/api/checkout/**, src/app/api/orders/**, src/app/api/webhooks/{stripe,dev-payment}/**, tests/orders/**.
 * Signatures FINAL. `advanceOrder` and `state.ts` are already implemented by the foundation.
 *
 * Lifecycle orchestration (who calls what):
 *   createCheckout          -> order PENDING_PAYMENT + payments row PENDING + `order.created`
 *   handlePaymentSucceeded  -> (one tx) payment SUCCEEDED, advanceOrder PAID, `payment.completed`,
 *                              `production.authorized`, markQuoteOrdered, recordPaymentSplit;
 *                              then (after commit) dispatchOrder(orderId) + notify('order.confirmed')
 *   handlePaymentFailed     -> payment FAILED, advanceOrder PAYMENT_FAILED, `payment.failed`
 *   refundOrder             -> provider refund, then (one tx) payment REFUNDED, advanceOrder REFUNDED,
 *                              `order.refunded`, ledger reversal
 *   shop module             -> DISPATCHED / ACCEPTED / IN_PRODUCTION / QA_* / SHIPPED / DELIVERED / COMPLETE
 *                              via advanceOrder (see src/server/shops, src/server/shipping)
 */
export { advanceOrder, OrderNotFoundError, type AdvanceMeta, type OrderRow } from './advance';
export {
    assertTransition,
    canTransition,
    IllegalTransitionError,
    isTerminal,
    ORDER_STATUS_DISPLAY,
    ORDER_TRANSITIONS,
    ORDER_UNIVERSAL_STATUS,
    toUniversalStatus,
} from './state';

/**
 * Server-priced checkout. Loads the quote snapshot, requires `orderable`
 * (READY + BINDING + not expired + not stale, else ApiError CONFLICT), takes subtotal and
 * the chosen shipping price from the snapshot, derives order_type from quantity,
 * creates the order (PENDING_PAYMENT, HMAC'd access token) + a provider payment
 * session, and emits `order.created` in the same transaction.
 */
export { createCheckout, priceQuoteForCheckout, guestBuyerActor, type CheckoutPricing } from './checkout';

/**
 * handlePaymentSucceeded: idempotent payment confirmation. Verifies amount/currency equal the order
 * total (mismatch -> payment flagged, order NOT advanced, ops notified). Returns `alreadyProcessed: true` on replays.
 * handlePaymentFailed: idempotent payment failure: payment FAILED, order -> PAYMENT_FAILED (if PENDING_PAYMENT).
 */
export {
    handlePaymentSucceeded,
    handlePaymentFailed,
    handleProviderRefund,
    PaymentNotFoundError,
    type PaymentSucceededInput,
    type PaymentFailedInput,
} from './payment-events';

/**
 * Buyer view of an order. Returns null when the order does not exist OR the
 * token does not verify (never reveal which). Timeline comes from domain_events.
 */
export { getOrderForBuyer, buildOrderView, MILESTONE_LABELS } from './buyer-view';

/**
 * Refund a paid order before shipping (ops action / no shop accepted / QA unrecoverable):
 * provider refund + advanceOrder REFUNDED + `order.refunded` + ledger reversal.
 */
export { refundOrder } from './refund';

/** Webhook pipeline (webhook_events dedupe -> handlers). */
export { processPaymentWebhook, type WebhookOutcome } from './webhooks';

/** Signed buyer URL recovery for redirects / emails (sealed token in payments.metadata). */
export { orderUrlFromPaymentMetadata } from './link-vault';

/** Dev payment double confirmation (PAYMENT_PROVIDER=dev only). */
export { confirmDevPayment } from './dev-payment';
