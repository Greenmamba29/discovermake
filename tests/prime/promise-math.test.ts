/**
 * Delivery Promise math: priors from the existing lead-time logic, learned P90 slips, the
 * "show the date only when P90 <= date" rule, remaining-leg rechecks, responsibility for a
 * miss, training, and the holdout hit rate on synthetic data.
 */
import { describe, expect, it } from 'vitest';
import {
    bufferDays,
    businessDaysBetween,
    predictLegs,
    promiseDates,
    remainingLegs,
    remainingP90Date,
    responsibleLeg,
    shouldShowArrival,
    zoneFor,
    type LegPriors,
} from '@/server/promise/math';
import { evaluateHoldout, indexModels, isHoldout, quantile, resolveSlip, resolveSlips, scopesFor, syntheticObservations, trainModels, type Observation } from '@/server/promise/training';
import { computeLeadTime } from '@/server/quote/leadtime';
import { shippingOptions } from '@/server/quote/shipping';
import { creditAmountCents } from '@/server/promise/credits';

const shopPriors = (o: Partial<LegPriors> = {}): LegPriors => ({ materialArrivalDays: [0], shopQueueDays: 2, processDays: 1, qaDays: 1, packDays: 0, transitDays: 5, ...o });

describe('promise formula with priors', () => {
    it('with no data, P90 = the existing lead-time logic (same ship and delivery dates as the quote)', () => {
        const now = new Date('2026-10-05T14:00:00Z'); // Mon 10:00 New York, before the cutoff
        const lead = computeLeadTime({ now, timeZone: 'America/New_York', queueDays: 2, machineHours: 3, serviceDays: 0 });
        const option = shippingOptions({ shipDate: lead.shipDate, unitMassG: 40, quantity: 10, bboxWidthMm: 100, bboxHeightMm: 80, thicknessMm: 1.6 }).find((o) => o.method === 'STANDARD')!;
        const legs = predictLegs(shopPriors({ processDays: lead.leadTimeDays - 2 - 1, transitDays: option.transitDays }));
        expect(legs.every((l) => l.source === 'prior' && l.slipDays === 0)).toBe(true);
        const d = promiseDates({ startDate: lead.startDate, legs, bufferDays: 0 });
        expect(d.shipDate).toBe(lead.shipDate);
        expect(d.arrivalP90Date).toBe(option.deliveryDate);
        expect(d.promiseDate).toBe(option.deliveryDate);
        expect(shouldShowArrival(d.promiseDate, option.deliveryDate)).toBe(true);
    });

    it('material arrival is the max across the BOM in calendar days, then business days to ship', () => {
        const legs = predictLegs(shopPriors({ materialArrivalDays: [3, 10, 6], shopQueueDays: 1, processDays: 0, qaDays: 1, transitDays: 2 }));
        expect(legs.find((l) => l.leg === 'MATERIAL_ARRIVAL')!.p90Days).toBe(10);
        const d = promiseDates({ startDate: '2026-10-05', legs, bufferDays: 0 });
        expect(d.materialReadyDate).toBe('2026-10-15'); // Thu
        expect(d.shipDate).toBe('2026-10-19'); // +2 business days (Fri, Mon)
        expect(d.arrivalP90Date).toBe('2026-10-21');
    });

    it('a risk buffer pushes the P90 past the committed date, so the date is hidden', () => {
        expect([bufferDays(0), bufferDays(0.33), bufferDays(0.34), bufferDays(0.66), bufferDays(0.9)]).toEqual([0, 0, 1, 1, 2]);
        const legs = predictLegs(shopPriors());
        const committed = promiseDates({ startDate: '2026-10-05', legs, bufferDays: 0 }).promiseDate;
        const risky = promiseDates({ startDate: '2026-10-05', legs, bufferDays: bufferDays(0.5) }).promiseDate;
        expect(risky > committed).toBe(true);
        expect(shouldShowArrival(risky, committed)).toBe(false);
        expect(shouldShowArrival(committed, committed)).toBe(true);
    });

    it('with observations, learned slips raise the P90 and can hide a date the priors would show', () => {
        const obs: Observation[] = Array.from({ length: 20 }, (_, i) => ({
            id: `o${i}`,
            group: `g${i}`,
            leg: 'CARRIER_TRANSIT' as const,
            predictedDays: 5,
            actualDays: i < 15 ? 5 : 7,
            carrierService: 'STANDARD',
            zone: 'Z3',
        }));
        const index = indexModels(trainModels(obs));
        const slips = resolveSlips(index, { carrierService: 'STANDARD', zone: 'Z3', shopId: 'shop_x' });
        expect(slips.CARRIER_TRANSIT).toMatchObject({ slipDays: 2, sampleCount: 20, scope: 'carrier:STANDARD:Z3' });
        const legs = predictLegs(shopPriors(), slips);
        expect(legs.find((l) => l.leg === 'CARRIER_TRANSIT')).toMatchObject({ priorDays: 5, slipDays: 2, p90Days: 7, source: 'model' });
        const committed = promiseDates({ startDate: '2026-10-05', legs: predictLegs(shopPriors()), bufferDays: 0 }).promiseDate;
        const learned = promiseDates({ startDate: '2026-10-05', legs, bufferDays: 0 }).promiseDate;
        expect(shouldShowArrival(learned, committed)).toBe(false);
    });

    it('remaining legs from where the order is; P90 of what is left', () => {
        expect(remainingLegs('SHIPPED')).toEqual(['CARRIER_TRANSIT']);
        expect(remainingLegs('QA_PASSED')).toEqual(['PACK', 'CARRIER_TRANSIT']);
        const legs = predictLegs(shopPriors());
        expect(remainingP90Date({ today: '2026-10-05', legs, remaining: ['CARRIER_TRANSIT'] })).toBe('2026-10-12');
        expect(remainingP90Date({ today: '2026-10-10', legs, remaining: ['CARRIER_TRANSIT'] })).toBe('2026-10-19'); // Saturday counts from Monday
    });

    it('business days, responsible leg and zones', () => {
        expect(businessDaysBetween('2026-10-09', '2026-10-12')).toBe(1); // Fri -> Mon
        expect(businessDaysBetween('2026-10-12', '2026-10-12')).toBe(0);
        const legs = predictLegs(shopPriors());
        expect(responsibleLeg(legs, { SHOP_QUEUE: 2, PROCESS: 1, QA: 1, PACK: 0, CARRIER_TRANSIT: 9 })).toBe('CARRIER_TRANSIT');
        expect(responsibleLeg(legs, { SHOP_QUEUE: 6, PROCESS: 1, QA: 1, PACK: 0, CARRIER_TRANSIT: 5 })).toBe('SHOP_QUEUE');
        expect([zoneFor('PA', 'PA'), zoneFor('PA', 'NY'), zoneFor('PA', 'CA')]).toEqual(['Z1', 'Z2', 'Z3']);
    });

    it('credit policy: 10% of the subtotal, capped', () => {
        expect(creditAmountCents(50_000, { creditPct: 0.1, creditCapCents: 25_000 })).toBe(5_000);
        expect(creditAmountCents(10_000_000, { creditPct: 0.1, creditCapCents: 25_000 })).toBe(25_000);
        expect(creditAmountCents(3, { creditPct: 0.1, creditCapCents: 25_000 })).toBe(1);
    });
});

describe('P90 models and holdout evaluation', () => {
    it('nearest-rank quantile and scope fallback (min samples)', () => {
        expect(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(9);
        expect(quantile([0])).toBe(0);
        expect(scopesFor('PROCESS', { shopId: 's', process: 'Fiber' })).toEqual(['shop:s:Fiber', 'shop:s', 'process:Fiber', '*']);
        const few: Observation[] = [1, 2, 3].map((i) => ({ id: `a${i}`, group: `a${i}`, leg: 'SHOP_QUEUE' as const, predictedDays: 2, actualDays: 6, shopId: 'shop_a' }));
        const many: Observation[] = Array.from({ length: 10 }, (_, i) => ({ id: `b${i}`, group: `b${i}`, leg: 'SHOP_QUEUE' as const, predictedDays: 2, actualDays: 3, shopId: 'shop_b' }));
        const index = indexModels(trainModels([...few, ...many]));
        // shop_a has 3 samples (< 5): falls back to the global scope over all 13.
        expect(resolveSlip(index, 'SHOP_QUEUE', { shopId: 'shop_a' }).scope).toBe('*');
        expect(resolveSlip(index, 'SHOP_QUEUE', { shopId: 'shop_b' })).toMatchObject({ scope: 'shop:shop_b', slipDays: 1 });
        // Faster than the prior never makes a negative slip.
        const fast = trainModels(Array.from({ length: 6 }, (_, i) => ({ id: `f${i}`, group: `f${i}`, leg: 'PACK' as const, predictedDays: 2, actualDays: 0 })));
        expect(fast.find((m) => m.scope === '*')!.slipP90Days).toBe(0);
    });

    it('training is deterministic', () => {
        const obs = syntheticObservations(7, 300);
        expect(trainModels(obs)).toEqual(trainModels([...obs].reverse()));
    });

    it('holdout hit rate >= 95% per order on the synthetic data (and >= 90% per leg)', () => {
        const obs = syntheticObservations(2026, 2000);
        const report = evaluateHoldout(obs);
        expect(report.holdoutOrders).toBeGreaterThan(300);
        expect(report.trainObservations + report.holdoutObservations).toBe(obs.length);
        expect(report.orderHitRate!).toBeGreaterThanOrEqual(0.95);
        expect(report.legHitRate!).toBeGreaterThanOrEqual(0.9);
        // Holdout is by delivery: no order is split between train and test.
        const groups = new Map<string, boolean>();
        for (const o of obs) {
            const h = isHoldout(o.group);
            expect(groups.get(o.group) ?? h).toBe(h);
            groups.set(o.group, h);
        }
    });

    it('without training data the priors alone miss: the model is what earns the hit rate', () => {
        const obs = syntheticObservations(99, 1000).filter((o) => isHoldout(o.group));
        const groups = new Map<string, { actual: number; prior: number }>();
        for (const o of obs) {
            const g = groups.get(o.group) ?? { actual: 0, prior: 0 };
            g.actual += o.actualDays;
            g.prior += o.predictedDays;
            groups.set(o.group, g);
        }
        const priorHit = [...groups.values()].filter((g) => g.actual <= g.prior).length / groups.size;
        expect(priorHit).toBeLessThan(evaluateHoldout(syntheticObservations(99, 1000)).orderHitRate!);
    });
});
