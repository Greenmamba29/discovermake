/**
 * Weekly retraining of the Delivery Promise P90 models (cron: GET /api/admin/promise/retrain).
 * Reads every `promise_observations` row from real deliveries, retrains the slip P90 per leg and
 * scope, replaces `promise_models` in one transaction, reports the holdout hit rate, and rechecks
 * every active promise against the new models' view of the remaining legs.
 */
import { eq } from 'drizzle-orm';
import type { RetrainPromiseResponse } from '../../contracts/promise';
import { getDb, withTx, type DbOrTx } from '../db';
import { promiseModels, promiseObservations } from '../db/schema';
import { recheckActivePromises } from './engine';
import { evaluateHoldout, trainModels, type Observation } from './training';

type ObservationRow = typeof promiseObservations.$inferSelect;

export function toObservation(r: ObservationRow): Observation {
    return {
        id: r.id,
        group: r.orderId ?? r.id,
        leg: r.leg,
        predictedDays: r.predictedDays,
        actualDays: r.actualDays,
        shopId: r.shopId,
        process: r.process,
        carrierService: r.carrierService,
        zone: r.zone,
        supplierId: r.supplierId,
        incoterm: r.incoterm,
    };
}

/** Load the training set: real deliveries only (synthetic rows are for evaluation, never for live promises). */
export async function loadObservations(db: DbOrTx = getDb(), opts: { includeSynthetic?: boolean } = {}): Promise<Observation[]> {
    const rows = opts.includeSynthetic ? await db.select().from(promiseObservations) : await db.select().from(promiseObservations).where(eq(promiseObservations.source, 'order'));
    return rows.map(toObservation);
}

/** Retrain from observations and replace the model table. Returns the response for the cron route. */
export async function retrainPromiseModels(opts: { now?: Date; recheck?: boolean } = {}): Promise<RetrainPromiseResponse> {
    const now = opts.now ?? new Date();
    const observations = await loadObservations();
    const models = trainModels(observations);
    await withTx(async (tx) => {
        await tx.delete(promiseModels);
        if (models.length) {
            await tx.insert(promiseModels).values(models.map((m) => ({ leg: m.leg, scope: m.scope, slipP90Days: m.slipP90Days, sampleCount: m.sampleCount, trainedAt: now })));
        }
    });
    const report = evaluateHoldout(observations);
    const recheck = opts.recheck === false ? { checked: 0, atRisk: 0 } : await recheckActivePromises(now);
    return {
        trainedAt: now.toISOString(),
        observationCount: observations.length,
        modelCount: models.length,
        holdout: { observations: report.holdoutObservations, orders: report.holdoutOrders, legHitRate: report.legHitRate, orderHitRate: report.orderHitRate },
        recheck,
    };
}
