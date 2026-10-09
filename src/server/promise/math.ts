/**
 * Delivery Promise math (pure, no I/O). Workflow 03:
 *
 *   promise = max(material_arrival_P90 across BOM) + shop_queue_P90 + process_time + QA + pack
 *           + carrier_transit_P90(zone, service) + buffer(risk_score)
 *
 * Units: MATERIAL_ARRIVAL is in calendar days (supplier production + freight run on calendar
 * time); every other leg is in business days in the shop's calendar (src/server/quote/leadtime.ts),
 * which is also where the priors come from. Each leg's P90 = prior + learned P90 slip (>= 0).
 *
 * Display rule: the buyer sees "Arrives <date>" (one date, never a range) only when the
 * engine's P90 arrival, buffer included, is on or before the committed date.
 */
import { PROMISE_LEGS, type PromiseLeg } from '../../contracts/enums';
import type { PromiseLegPrediction } from '../../contracts/promise';
import { addBusinessDays, isBusinessDay, nextBusinessDay } from '../quote/leadtime';

export type LegPriors = {
    /** Calendar days until each BOM line's material is at the shop (0 = in stock). The max counts. */
    materialArrivalDays: number[];
    shopQueueDays: number;
    processDays: number;
    qaDays: number;
    packDays: number;
    transitDays: number;
};

export type LegSlip = { slipDays: number; sampleCount: number; scope: string };
export type LegSlips = Partial<Record<PromiseLeg, LegSlip>>;

const PRIOR_SLIP: LegSlip = { slipDays: 0, sampleCount: 0, scope: 'prior' };

export function priorFor(leg: PromiseLeg, p: LegPriors): number {
    switch (leg) {
        case 'MATERIAL_ARRIVAL':
            return p.materialArrivalDays.length ? Math.max(0, ...p.materialArrivalDays) : 0;
        case 'SHOP_QUEUE':
            return p.shopQueueDays;
        case 'PROCESS':
            return p.processDays;
        case 'QA':
            return p.qaDays;
        case 'PACK':
            return p.packDays;
        case 'CARRIER_TRANSIT':
            return p.transitDays;
        default: {
            const never: never = leg;
            throw new Error(`Unknown leg ${String(never)}`);
        }
    }
}

/** Per-leg P90 = prior + slip (slip from the trained model for the leg's scope, else 0). */
export function predictLegs(priors: LegPriors, slips: LegSlips = {}): PromiseLegPrediction[] {
    return PROMISE_LEGS.map((leg) => {
        const prior = Math.max(0, priorFor(leg, priors));
        const s = slips[leg] ?? PRIOR_SLIP;
        const slip = Math.max(0, s.slipDays);
        return {
            leg,
            priorDays: prior,
            slipDays: slip,
            p90Days: prior + slip,
            source: s.sampleCount > 0 ? 'model' : 'prior',
            sampleCount: s.sampleCount,
            scope: s.scope,
        };
    });
}

/** Risk buffer in business days: 0 below 0.34, 1 below 0.67, else 2. */
export function bufferDays(riskScore: number): number {
    if (!(riskScore >= 0)) return 0;
    if (riskScore < 0.34) return 0;
    if (riskScore < 0.67) return 1;
    return 2;
}

function addCalendarDays(iso: string, days: number): string {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + days));
    return dt.toISOString().slice(0, 10);
}

const legDays = (legs: readonly PromiseLegPrediction[], leg: PromiseLeg) => Math.ceil(legs.find((l) => l.leg === leg)?.p90Days ?? 0);

export type PromiseDates = {
    /** Material at the shop (start when everything is in stock). */
    materialReadyDate: string;
    /** P90 ship date. */
    shipDate: string;
    /** P90 arrival without the buffer. */
    arrivalP90Date: string;
    /** P90 arrival + risk buffer: what the promise must fit inside. */
    promiseDate: string;
};

/** Walk the legs from `startDate` (the first business day work can start). */
export function promiseDates(input: { startDate: string; legs: readonly PromiseLegPrediction[]; bufferDays: number; skipLegs?: readonly PromiseLeg[] }): PromiseDates {
    const skip = new Set(input.skipLegs ?? []);
    const days = (leg: PromiseLeg) => (skip.has(leg) ? 0 : legDays(input.legs, leg));
    const material = days('MATERIAL_ARRIVAL');
    let materialReadyDate = input.startDate;
    if (material > 0) {
        materialReadyDate = addCalendarDays(input.startDate, material);
        if (!isBusinessDay(materialReadyDate)) materialReadyDate = nextBusinessDay(materialReadyDate);
    }
    const shopDays = days('SHOP_QUEUE') + days('PROCESS') + days('QA') + days('PACK');
    const shipDate = addBusinessDays(materialReadyDate, shopDays);
    const arrivalP90Date = addBusinessDays(shipDate, days('CARRIER_TRANSIT'));
    const promiseDate = addBusinessDays(arrivalP90Date, Math.max(0, Math.round(input.bufferDays)));
    return { materialReadyDate, shipDate, arrivalP90Date, promiseDate };
}

/** "Arrives <committedDate>" is shown only when the P90 (with buffer) fits inside it. */
export function shouldShowArrival(p90WithBufferDate: string, committedDate: string): boolean {
    return p90WithBufferDate <= committedDate;
}

/** Legs still ahead of an order, by where it is now. */
export function remainingLegs(stage: 'PAID' | 'AT_SUPPLIER' | 'QUEUED_AT_SHOP' | 'IN_PRODUCTION' | 'QA_PASSED' | 'SHIPPED' | 'DELIVERED'): PromiseLeg[] {
    switch (stage) {
        case 'PAID':
        case 'AT_SUPPLIER':
            return [...PROMISE_LEGS];
        case 'QUEUED_AT_SHOP':
            return ['SHOP_QUEUE', 'PROCESS', 'QA', 'PACK', 'CARRIER_TRANSIT'];
        case 'IN_PRODUCTION':
            return ['PROCESS', 'QA', 'PACK', 'CARRIER_TRANSIT'];
        case 'QA_PASSED':
            return ['PACK', 'CARRIER_TRANSIT'];
        case 'SHIPPED':
            return ['CARRIER_TRANSIT'];
        case 'DELIVERED':
            return [];
        default: {
            const never: never = stage;
            throw new Error(`Unknown stage ${String(never)}`);
        }
    }
}

/** P90 arrival of the legs still ahead, starting today (no buffer: the buffer was for the initial promise). */
export function remainingP90Date(input: { today: string; legs: readonly PromiseLegPrediction[]; remaining: readonly PromiseLeg[] }): string {
    const skip = PROMISE_LEGS.filter((l) => !input.remaining.includes(l));
    const start = isBusinessDay(input.today) ? input.today : nextBusinessDay(input.today);
    return promiseDates({ startDate: start, legs: input.legs, bufferDays: 0, skipLegs: skip }).arrivalP90Date;
}

// ---------------------------------------------------------------------------
// Actuals
// ---------------------------------------------------------------------------

/** Business days after `from` up to and including `to` (0 when `to <= from`). Dates are YYYY-MM-DD. */
export function businessDaysBetween(from: string, to: string): number {
    if (to <= from) return 0;
    let n = 0;
    let cur = from;
    while (cur < to) {
        cur = nextBusinessDay(cur);
        if (cur <= to) n++;
    }
    return n;
}

export function calendarDaysBetween(from: string, to: string): number {
    const a = Date.parse(`${from}T00:00:00Z`);
    const b = Date.parse(`${to}T00:00:00Z`);
    return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** The leg that overran its P90 the most (ties: the latest leg). Used to charge a missed promise. */
export function responsibleLeg(predicted: readonly PromiseLegPrediction[], actual: Partial<Record<PromiseLeg, number>>): PromiseLeg {
    let worst: PromiseLeg = 'CARRIER_TRANSIT';
    let worstOver = -Infinity;
    for (const p of predicted) {
        const a = actual[p.leg];
        if (a === undefined) continue;
        const over = a - p.p90Days;
        if (over >= worstOver) {
            worstOver = over;
            worst = p.leg;
        }
    }
    return worst;
}

// ---------------------------------------------------------------------------
// Zones (carrier transit model key)
// ---------------------------------------------------------------------------

/** US Census regions by state code. */
const CENSUS_REGION: Readonly<Record<string, 'NE' | 'MW' | 'S' | 'W'>> = {
    CT: 'NE', ME: 'NE', MA: 'NE', NH: 'NE', RI: 'NE', VT: 'NE', NJ: 'NE', NY: 'NE', PA: 'NE',
    IL: 'MW', IN: 'MW', MI: 'MW', OH: 'MW', WI: 'MW', IA: 'MW', KS: 'MW', MN: 'MW', MO: 'MW', NE: 'MW', ND: 'MW', SD: 'MW',
    DE: 'S', DC: 'S', FL: 'S', GA: 'S', MD: 'S', NC: 'S', SC: 'S', VA: 'S', WV: 'S', AL: 'S', KY: 'S', MS: 'S', TN: 'S', AR: 'S', LA: 'S', OK: 'S', TX: 'S',
    AZ: 'W', CO: 'W', ID: 'W', MT: 'W', NV: 'W', NM: 'W', UT: 'W', WY: 'W', AK: 'W', CA: 'W', HI: 'W', OR: 'W', WA: 'W',
};

/** Z1 same state, Z2 same census region, Z3 cross-country. */
export function zoneFor(fromRegion: string, toRegion: string): 'Z1' | 'Z2' | 'Z3' {
    const a = fromRegion.toUpperCase();
    const b = toRegion.toUpperCase();
    if (a === b) return 'Z1';
    if (CENSUS_REGION[a] && CENSUS_REGION[a] === CENSUS_REGION[b]) return 'Z2';
    return 'Z3';
}
