/**
 * R3 "Prime" core: supplier-route ordering (docs/architecture/r3-prime.md).
 *
 *   config.ts           owner inputs: deposit %, margin %, risk reserve tiers, credit policy
 *   pricing.ts          offer -> BINDING quote composition, deposit split (pure)
 *   quotes.ts           create the BINDING supplier quote from an approved offer
 *   quote-view.ts       QuoteView additions (route kind, supplier route, promise)
 *   payments.ts         payment plans: deposit at checkout, balance at shipment, refunds
 *   ledger.ts           deposit / balance / recognition / supplier deposit / refund postings
 *   purchase-orders.ts  PO + supplier deposit approvals; the leg is born from an approved PO
 *   legs.ts             supplier leg state machine (pure)
 *   fulfilment.ts       ops leg updates, partner receiving (QA at receipt), delivery hook
 *   views.ts            buyer + ops views
 *   events.ts           outbox subscriber
 */
export { DEFAULT_PRIME_POLICY, primePolicy, type PrimePolicy, type RiskTier } from './config';
export { assessRisk, depositSplit, firstChargeCents, priceSupplierQuote, MIN_CHARGE_CENTS, DUTY_RATE_ESTIMATE } from './pricing';
export { activeReceivingSite, createSupplierBindingQuote, SUPPLIER_PRICING_VERSION } from './quotes';
export {
    applyBalancePaid,
    applyDepositPaid,
    applyFullPaymentCredit,
    assertShippable,
    createPaymentPlan,
    expectedChargeCents,
    getPlan,
    isSupplierRouteOrder,
    paymentPurpose,
    refundSupplierOrder,
    requestBalancePayment,
    requestBalancePaymentSafely,
    PAYMENT_PURPOSE_KEY,
    type PaymentPurpose,
} from './payments';
export { applyPurchaseOrderDecision, requestPurchaseOrderApprovals, approvalOrderId } from './purchase-orders';
export { LEG_TRANSITIONS, assertLegTransition, canLegTransition, legSentence, opsAllowedNext, orderStepsForLeg, IllegalLegTransitionError } from './legs';
export { advanceSupplierLeg, afterReceivingInspection, onOrderDeliveredPrime, onReceivingInspection, receiveFreight } from './fulfilment';
export { buildSupplierSteps, legOpsView, legsForJob, orderSupplierRouteView } from './views';
export { handlePrimeEvent } from './events';
