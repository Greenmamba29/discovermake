/**
 * Delivery Promise engine (workflow 03, docs/architecture/r3-prime.md).
 *
 *   math.ts      the promise formula, business-day walking, display rule, zones (pure)
 *   training.ts  P90 slip models, scope resolution, holdout evaluation, synthetic data (pure)
 *   engine.ts    quote promises, promise.set at checkout, at-risk rechecks, delivery outcomes
 *   credits.ts   missed-promise credits: issue (ledger + row), reserve/redeem at checkout
 *   retrain.ts   weekly retraining (cron) + holdout report
 */
export * from './math';
export * from './training';
export {
    computePromise,
    committedDateFor,
    loadModelIndex,
    materialDaysFromStock,
    onOrderDelivered,
    orderPromiseView,
    quotePromises,
    recheckActivePromises,
    recheckOrderPromise,
    recheckOrderPromiseSafely,
    setOrderPromise,
    shopRiskScore,
    shopRoutePriors,
    supplierRoutePriors,
    sheetsNeeded,
    SHEET_RESTOCK_DAYS,
    RECEIVING_QUEUE_DAYS,
} from './engine';
export { availableCreditCents, creditAmountCents, issuePromiseCredit, redeemReservedCredit, reserveCreditForCheckout, restoreCredit, toCreditView } from './credits';
export { loadObservations, retrainPromiseModels, toObservation } from './retrain';
