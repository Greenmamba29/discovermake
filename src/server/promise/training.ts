/**
 * P90 models for the Delivery Promise (pure, no I/O).
 *
 * Model: for each leg and scope, the empirical 90th percentile of the slip
 * (actual days - prior days) over its observations, floored at 0 (we never promise faster
 * than the existing lead-time logic). Prediction picks the most specific scope with at least
 * MIN_SAMPLES observations, then coarser scopes, then the prior alone.
 *
 * Holdout: every observation whose id hashes to 0 mod 5 is held out; the models are trained
 * on the rest and the hit rate (actual <= predicted P90) is reported per leg and per order
 * (sum of the order's legs vs. sum of their P90s).
 */
import { PROMISE_LEGS, type PromiseLeg } from '../../contracts/enums';
import type { LegSlip, LegSlips } from './math';

export const MIN_SAMPLES = 5;
export const TARGET_QUANTILE = 0.9;

export type ObservationKeys = {
    shopId?: string | null;
    process?: string | null;
    carrierService?: string | null;
    zone?: string | null;
    supplierId?: string | null;
    incoterm?: string | null;
};

export type Observation = ObservationKeys & {
    id: string;
    /** Order id, or a synthetic group id: legs of one delivery share it. */
    group: string;
    leg: PromiseLeg;
    predictedDays: number;
    actualDays: number;
};

export type TrainedModel = { leg: PromiseLeg; scope: string; slipP90Days: number; sampleCount: number };

/** Scopes from most to least specific. */
export function scopesFor(leg: PromiseLeg, k: ObservationKeys): string[] {
    const out: string[] = [];
    switch (leg) {
        case 'MATERIAL_ARRIVAL':
            if (k.supplierId) out.push(`supplier:${k.supplierId}`);
            if (k.incoterm) out.push(`incoterm:${k.incoterm}`);
            if (!k.supplierId && k.shopId) out.push(`stock:${k.shopId}`);
            break;
        case 'SHOP_QUEUE':
        case 'QA':
        case 'PACK':
            if (k.shopId) out.push(`shop:${k.shopId}`);
            break;
        case 'PROCESS':
            if (k.shopId && k.process) out.push(`shop:${k.shopId}:${k.process}`);
            if (k.shopId) out.push(`shop:${k.shopId}`);
            if (k.process) out.push(`process:${k.process}`);
            break;
        case 'CARRIER_TRANSIT':
            if (k.carrierService && k.zone) out.push(`carrier:${k.carrierService}:${k.zone}`);
            if (k.carrierService) out.push(`carrier:${k.carrierService}`);
            break;
        default: {
            const never: never = leg;
            throw new Error(`Unknown leg ${String(never)}`);
        }
    }
    out.push('*');
    return out;
}

/** Nearest-rank quantile (q in (0, 1]). */
export function quantile(values: readonly number[], q: number = TARGET_QUANTILE): number {
    if (!values.length) throw new Error('quantile of an empty sample');
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
    return sorted[idx];
}

/** Train slip P90s for every (leg, scope) with at least one observation. Deterministic (sorted output). */
export function trainModels(observations: readonly Observation[]): TrainedModel[] {
    const buckets = new Map<string, { leg: PromiseLeg; scope: string; slips: number[] }>();
    for (const o of observations) {
        if (!Number.isFinite(o.actualDays) || !Number.isFinite(o.predictedDays)) continue;
        const slip = o.actualDays - o.predictedDays;
        for (const scope of scopesFor(o.leg, o)) {
            const key = `${o.leg}|${scope}`;
            let b = buckets.get(key);
            if (!b) buckets.set(key, (b = { leg: o.leg, scope, slips: [] }));
            b.slips.push(slip);
        }
    }
    return [...buckets.values()]
        .map((b) => ({ leg: b.leg, scope: b.scope, slipP90Days: Math.max(0, quantile(b.slips)), sampleCount: b.slips.length }))
        .sort((a, b) => a.leg.localeCompare(b.leg) || a.scope.localeCompare(b.scope));
}

export type ModelIndex = Map<string, TrainedModel>;

export function indexModels(models: readonly TrainedModel[]): ModelIndex {
    return new Map(models.map((m) => [`${m.leg}|${m.scope}`, m]));
}

/** Most specific scope with >= MIN_SAMPLES observations; otherwise the prior (slip 0). */
export function resolveSlip(index: ModelIndex, leg: PromiseLeg, keys: ObservationKeys): LegSlip {
    for (const scope of scopesFor(leg, keys)) {
        const m = index.get(`${leg}|${scope}`);
        if (m && m.sampleCount >= MIN_SAMPLES) return { slipDays: m.slipP90Days, sampleCount: m.sampleCount, scope };
    }
    return { slipDays: 0, sampleCount: 0, scope: 'prior' };
}

/** Slips for every leg of one order (keys apply to the legs they matter for). */
export function resolveSlips(index: ModelIndex, keys: ObservationKeys): LegSlips {
    return Object.fromEntries(PROMISE_LEGS.map((leg) => [leg, resolveSlip(index, leg, keys)])) as LegSlips;
}

/** FNV-1a 32-bit. */
export function fnv1a(s: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
}

/** Holdout membership is by delivery (group), so a whole order is either trained on or held out. */
export function isHoldout(group: string): boolean {
    return fnv1a(group) % 5 === 0;
}

export type HoldoutReport = {
    trainObservations: number;
    holdoutObservations: number;
    holdoutOrders: number;
    legHitRate: number | null;
    orderHitRate: number | null;
    perLeg: Partial<Record<PromiseLeg, { n: number; hitRate: number }>>;
};

/** Train on the non-holdout groups and score the holdout groups. */
export function evaluateHoldout(observations: readonly Observation[]): HoldoutReport {
    const train = observations.filter((o) => !isHoldout(o.group));
    const test = observations.filter((o) => isHoldout(o.group));
    const index = indexModels(trainModels(train));
    let hits = 0;
    const perLeg: Partial<Record<PromiseLeg, { n: number; hits: number }>> = {};
    const groups = new Map<string, { actual: number; p90: number }>();
    for (const o of test) {
        const p90 = o.predictedDays + resolveSlip(index, o.leg, o).slipDays;
        const hit = o.actualDays <= p90;
        if (hit) hits++;
        const pl = (perLeg[o.leg] ??= { n: 0, hits: 0 });
        pl.n++;
        if (hit) pl.hits++;
        const g = groups.get(o.group) ?? { actual: 0, p90: 0 };
        g.actual += o.actualDays;
        g.p90 += p90;
        groups.set(o.group, g);
    }
    const orderHits = [...groups.values()].filter((g) => g.actual <= g.p90).length;
    return {
        trainObservations: train.length,
        holdoutObservations: test.length,
        holdoutOrders: groups.size,
        legHitRate: test.length ? hits / test.length : null,
        orderHitRate: groups.size ? orderHits / groups.size : null,
        perLeg: Object.fromEntries(Object.entries(perLeg).map(([leg, v]) => [leg, { n: v.n, hitRate: v.hits / v.n }])),
    };
}

// ---------------------------------------------------------------------------
// Synthetic data (evaluation only; real promises need real deliveries)
// ---------------------------------------------------------------------------

/** mulberry32 PRNG: deterministic for a seed. */
export function prng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Draw a slip in days from a discrete distribution [[days, weight], ...]. */
function draw(rand: () => number, dist: readonly (readonly [number, number])[]): number {
    const total = dist.reduce((s, [, w]) => s + w, 0);
    let r = rand() * total;
    for (const [days, w] of dist) {
        r -= w;
        if (r <= 0) return days;
    }
    return dist[dist.length - 1][0];
}

/**
 * Synthetic deliveries for the holdout check: three shops with different reliability,
 * two carrier services over three zones, and some supplier-route orders. Slips are
 * heavy-tailed (mostly on time, occasionally late), which is what the P90 slip model is for.
 */
export function syntheticObservations(seed: number, orders: number): Observation[] {
    const rand = prng(seed);
    const shops = [
        { id: 'shop_syn_reliable', queue: [[0, 85], [1, 12], [2, 3]] as const },
        { id: 'shop_syn_busy', queue: [[0, 50], [1, 30], [2, 15], [4, 5]] as const },
        { id: 'shop_syn_new', queue: [[0, 60], [1, 25], [3, 15]] as const },
    ];
    const carriers = [
        { service: 'STANDARD', prior: 5, zones: { Z1: [[-3, 40], [-2, 30], [0, 25], [1, 5]], Z2: [[-2, 30], [-1, 30], [0, 30], [1, 10]], Z3: [[-1, 25], [0, 45], [1, 20], [2, 10]] } },
        { service: 'EXPEDITED', prior: 2, zones: { Z1: [[0, 90], [1, 10]], Z2: [[0, 85], [1, 15]], Z3: [[0, 75], [1, 20], [2, 5]] } },
    ] as const;
    const out: Observation[] = [];
    for (let i = 0; i < orders; i++) {
        const group = `syn_order_${seed}_${i}`;
        const shop = shops[Math.floor(rand() * shops.length)];
        const carrier = carriers[Math.floor(rand() * carriers.length)];
        const zone = (['Z1', 'Z2', 'Z3'] as const)[Math.floor(rand() * 3)];
        const supplierRoute = rand() < 0.2;
        const process = rand() < 0.5 ? 'Fiber laser cutting' : 'Press brake bending';
        const keys = { shopId: shop.id, process, carrierService: carrier.service, zone };
        const push = (leg: PromiseLeg, prior: number, slip: number, extra: ObservationKeys = {}) =>
            out.push({ id: `${group}_${leg}`, group, leg, predictedDays: prior, actualDays: Math.max(0, prior + slip), ...keys, ...extra });
        if (supplierRoute) {
            const prior = 21 + Math.floor(rand() * 10);
            push('MATERIAL_ARRIVAL', prior, draw(rand, [[-2, 20], [0, 50], [3, 20], [7, 10]]), { supplierId: 'sup_syn_vn', incoterm: 'DDP' });
        }
        push('SHOP_QUEUE', supplierRoute ? 1 : 2, draw(rand, shop.queue));
        push('PROCESS', supplierRoute ? 0 : 1 + Math.floor(rand() * 3), draw(rand, [[0, 80], [1, 17], [2, 3]]));
        push('QA', 1, draw(rand, [[0, 92], [1, 8]]));
        push('PACK', 0, draw(rand, [[0, 90], [1, 10]]));
        push('CARRIER_TRANSIT', carrier.prior, draw(rand, carrier.zones[zone]));
    }
    return out;
}
