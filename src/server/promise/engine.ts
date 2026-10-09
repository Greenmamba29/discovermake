/**
 * Delivery Promise engine (DB side). Pure math lives in ./math.ts and ./training.ts.
 *
 * - `quotePromises(quote)`: per shipping method, the committed date and whether "Arrives <date>"
 *   may be shown (P90 with buffer <= committed). Shown on checkout and the Manufacturing Route.
 * - `setOrderPromise(tx, ...)`: at checkout, stores the per-leg P90 predictions on the order
 *   (`order_promises`) and emits `promise.set`.
 * - `recheckOrderPromise(orderId)`: on milestones; the remaining legs' P90 crossing the promised
 *   date marks the promise AT_RISK once (`promise.at_risk` + an ops alert).
 * - `onOrderDelivered(tx, ...)`: records predicted vs actual per leg (`promise_observations`), and
 *   a delivery after a shown promise emits `promise.missed` and auto-credits the buyer, charged to
 *   the leg that overran the most; otherwise `promise.kept`.
 */
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import { SYSTEM_ACTOR } from '../../contracts/common';
import type { PromiseLeg, ShippingMethod } from '../../contracts/enums';
import type { OrderPromiseView, PromiseLegPrediction, QuotePromiseView } from '../../contracts/promise';
import type { ShippingOption } from '../../contracts/quotes';
import { getDb, withTx, type DbOrTx } from '../db';
import {
    buyerCredits,
    manufacturingJobs,
    materials,
    orderPromises,
    orders,
    productionMilestones,
    promiseModels,
    promiseObservations,
    quotes,
    shopStock,
    shops,
    supplierLegs,
    supplierOffers,
    supplierQuotes,
    thicknessOptions,
} from '../db/schema';
import { emitEvent } from '../events/outbox';
import { addBusinessDays, localDateTime, orderStartDate, QA_PACK_DAYS } from '../quote/leadtime';
import { issuePromiseCredit } from './credits';
import {
    bufferDays,
    businessDaysBetween,
    calendarDaysBetween,
    predictLegs,
    promiseDates,
    remainingLegs,
    remainingP90Date,
    responsibleLeg,
    shouldShowArrival,
    zoneFor,
    type LegPriors,
} from './math';
import { indexModels, resolveSlips, type ModelIndex, type ObservationKeys } from './training';

type QuoteRow = typeof quotes.$inferSelect;
type ShopRow = typeof shops.$inferSelect;
type OrderRow = typeof orders.$inferSelect;

/** Days to restock sheet that a shop tracks in `shop_stock` but does not have enough of (calendar). */
export const SHEET_RESTOCK_DAYS = 3;
/** Stock sheet used when a material has no sheet size (4 x 8 ft). */
const DEFAULT_SHEET_MM = { w: 1219, h: 2438 } as const;
/** Receiving slot at the partner before inspection (business days). */
export const RECEIVING_QUEUE_DAYS = 1;

export async function loadModelIndex(db: DbOrTx = getDb()): Promise<ModelIndex> {
    const rows = await db.select().from(promiseModels);
    return indexModels(rows.map((r) => ({ leg: r.leg, scope: r.scope, slipP90Days: r.slipP90Days, sampleCount: r.sampleCount })));
}

/** Shop-route risk: unrated / low-rated shops and long queues widen the buffer. */
export function shopRiskScore(shop: Pick<ShopRow, 'rating' | 'queueDays'>, quantity: number): number {
    let s = 0;
    if (shop.rating == null) s += 0.15;
    else if (shop.rating < 4) s += 0.25;
    if (shop.queueDays > 5) s += 0.15;
    if (quantity > 1000) s += 0.1;
    return Math.min(1, Math.round(s * 100) / 100);
}

/** Sheets of stock a quote needs (bbox area x qty, 15% nesting loss). */
export function sheetsNeeded(summary: QuoteRow['summary'], sheet: { w: number; h: number }): number {
    const area = summary.bboxWidthMm * summary.bboxHeightMm * summary.quantity * 1.15;
    return Math.max(1, Math.ceil(area / (sheet.w * sheet.h)));
}

/**
 * Material arrival for a shop-route quote from `shop_stock`: 0 when the shop has enough sheet
 * on hand (or does not track this thickness: the R1 assumption that catalog sheet is stocked),
 * SHEET_RESTOCK_DAYS when it tracks the sheet and is short.
 */
export async function materialDaysFromStock(db: DbOrTx, shopId: string, quote: Pick<QuoteRow, 'config' | 'summary'>): Promise<{ days: number; fromStock: boolean; tracked: boolean }> {
    const rows = await db
        .select({ quantity: shopStock.quantity })
        .from(shopStock)
        .where(and(eq(shopStock.shopId, shopId), eq(shopStock.thicknessOptionId, quote.config.thicknessOptionId), eq(shopStock.kind, 'SHEET')));
    if (!rows.length) return { days: 0, fromStock: false, tracked: false };
    const [mat] = await db
        .select({ w: materials.sheetWidthMm, h: materials.sheetHeightMm })
        .from(thicknessOptions)
        .innerJoin(materials, eq(materials.id, thicknessOptions.materialId))
        .where(eq(thicknessOptions.id, quote.config.thicknessOptionId));
    const sheet = mat?.w && mat?.h ? { w: mat.w, h: mat.h } : DEFAULT_SHEET_MM;
    const onHand = rows.reduce((s, r) => s + r.quantity, 0);
    const enough = onHand >= sheetsNeeded(quote.summary, sheet);
    return { days: enough ? 0 : SHEET_RESTOCK_DAYS, fromStock: enough, tracked: true };
}

export type SupplierContext = {
    offer: Pick<typeof supplierOffers.$inferSelect, 'productionLeadDays' | 'shippingLeadDays' | 'incoterm' | 'supplierId'>;
    riskScore: number;
    directShip: boolean;
};

async function supplierContextFor(db: DbOrTx, quoteId: string): Promise<SupplierContext | null> {
    const [row] = await db
        .select({ sq: supplierQuotes, offer: supplierOffers })
        .from(supplierQuotes)
        .innerJoin(supplierOffers, eq(supplierOffers.id, supplierQuotes.offerId))
        .where(eq(supplierQuotes.quoteId, quoteId));
    if (!row) return null;
    return { offer: row.offer, riskScore: row.sq.riskScore, directShip: row.sq.receivingShopId === null };
}

/** Priors from the existing lead-time logic for one quote + shipping option. */
export function shopRoutePriors(quote: Pick<QuoteRow, 'leadTimeDays'>, shop: Pick<ShopRow, 'queueDays'>, option: Pick<ShippingOption, 'transitDays'>, materialDays: number): LegPriors {
    // leadTimeDays = queue + production + services + QA/pack (src/server/quote/leadtime.ts).
    const processDays = Math.max(0, quote.leadTimeDays - Math.round(shop.queueDays) - QA_PACK_DAYS);
    return { materialArrivalDays: [materialDays], shopQueueDays: Math.round(shop.queueDays), processDays, qaDays: QA_PACK_DAYS, packDays: 0, transitDays: option.transitDays };
}

export function supplierRoutePriors(ctx: Pick<SupplierContext, 'offer' | 'directShip'>, option: Pick<ShippingOption, 'transitDays'>): LegPriors {
    const material = ctx.offer.productionLeadDays + ctx.offer.shippingLeadDays;
    if (ctx.directShip) return { materialArrivalDays: [material], shopQueueDays: 0, processDays: 0, qaDays: 0, packDays: 0, transitDays: 0 };
    return { materialArrivalDays: [material], shopQueueDays: RECEIVING_QUEUE_DAYS, processDays: 0, qaDays: QA_PACK_DAYS, packDays: 0, transitDays: option.transitDays };
}

export type PromiseComputation = {
    startDate: string;
    legs: PromiseLegPrediction[];
    bufferDays: number;
    riskScore: number;
    p90Date: string;
    shipDate: string;
};

type PromiseInputs = {
    quote: Pick<QuoteRow, 'summary' | 'quantity' | 'leadTimeDays'>;
    shop: ShopRow;
    option: ShippingOption;
    zone: string | null;
    now: Date;
    index: ModelIndex;
    supplier: SupplierContext | null;
    materialDays: number;
};

export function computePromise(i: PromiseInputs): PromiseComputation {
    const startDate = orderStartDate(i.now, i.shop.timezone);
    const keys: ObservationKeys = {
        shopId: i.shop.id,
        process: i.supplier ? 'receiving' : i.quote.summary.processName,
        carrierService: i.option.method,
        zone: i.zone,
        supplierId: i.supplier?.offer.supplierId ?? null,
        incoterm: i.supplier?.offer.incoterm ?? null,
    };
    const priors = i.supplier ? supplierRoutePriors(i.supplier, i.option) : shopRoutePriors(i.quote, i.shop, i.option, i.materialDays);
    const legs = predictLegs(priors, resolveSlips(i.index, keys));
    const riskScore = i.supplier ? i.supplier.riskScore : shopRiskScore(i.shop, i.quote.quantity);
    const buffer = bufferDays(riskScore);
    const dates = promiseDates({ startDate, legs, bufferDays: buffer });
    return { startDate, legs, bufferDays: buffer, riskScore, p90Date: dates.promiseDate, shipDate: dates.shipDate };
}

/** The date a shop-route quote commits to for a method, rolled forward from today like checkout does. */
export function committedDateFor(quote: Pick<QuoteRow, 'shipDate' | 'leadTimeDays'>, option: ShippingOption, shop: Pick<ShopRow, 'timezone'>, now: Date, supplier: boolean): string {
    if (supplier) return option.deliveryDate;
    const rolledShip = addBusinessDays(orderStartDate(now, shop.timezone), Math.max(1, quote.leadTimeDays));
    const ship = rolledShip > quote.shipDate ? rolledShip : quote.shipDate;
    const rolled = addBusinessDays(ship, option.transitDays);
    return rolled > option.deliveryDate ? rolled : option.deliveryDate;
}

/** Promise per shipping method for a quote (buyer zone unknown yet: worst zone Z3). */
export async function quotePromises(quote: QuoteRow, opts: { now?: Date; db?: DbOrTx } = {}): Promise<QuotePromiseView[]> {
    const db = opts.db ?? getDb();
    const now = opts.now ?? new Date();
    const [shop] = await db.select().from(shops).where(eq(shops.id, quote.shopId));
    if (!shop) return [];
    const [index, supplier] = await Promise.all([loadModelIndex(db), supplierContextFor(db, quote.id)]);
    const material = supplier ? { days: 0 } : await materialDaysFromStock(db, shop.id, quote);
    return quote.shippingOptions.map((option) => {
        const p = computePromise({ quote, shop, option, zone: 'Z3', now, index, supplier, materialDays: material.days });
        const date = committedDateFor(quote, option, shop, now, Boolean(supplier));
        return { method: option.method, date, p90Date: p.p90Date, show: shouldShowArrival(p.p90Date, date) };
    });
}

/** At checkout (inside the checkout transaction): store the promise and emit `promise.set`. */
export async function setOrderPromise(
    tx: DbOrTx,
    input: { order: Pick<OrderRow, 'id' | 'correlationId' | 'buildId' | 'promisedShipDate'>; quote: QuoteRow; method: ShippingMethod; shipToRegion: string; now: Date },
): Promise<{ promisedDate: string; shown: boolean; p90Date: string }> {
    const [shop] = await tx.select().from(shops).where(eq(shops.id, input.quote.shopId));
    const option = input.quote.shippingOptions.find((o) => o.method === input.method);
    if (!shop || !option) throw new Error(`Cannot set a promise for order ${input.order.id}: shop or shipping option missing`);
    const [index, supplier] = await Promise.all([loadModelIndex(tx), supplierContextFor(tx, input.quote.id)]);
    const material = supplier ? { days: 0 } : await materialDaysFromStock(tx, shop.id, input.quote);
    const zone = zoneFor(shop.region, input.shipToRegion);
    const p = computePromise({ quote: input.quote, shop, option, zone, now: input.now, index, supplier, materialDays: material.days });
    const promisedDate = supplier ? option.deliveryDate : (() => {
        const fromShip = addBusinessDays(input.order.promisedShipDate, option.transitDays);
        return fromShip > option.deliveryDate ? fromShip : option.deliveryDate;
    })();
    const shown = shouldShowArrival(p.p90Date, promisedDate);
    await tx.insert(orderPromises).values({
        orderId: input.order.id,
        promisedDate,
        p90Date: p.p90Date,
        shown,
        startDate: p.startDate,
        legs: p.legs,
        bufferDays: p.bufferDays,
        riskScore: p.riskScore,
        zone,
        carrierService: input.method,
        status: 'ON_TRACK',
        lastP90Date: p.p90Date,
        createdAt: input.now,
        updatedAt: input.now,
    });
    await emitEvent(tx, {
        type: 'promise.set',
        payload: { orderId: input.order.id, promisedDate, p90Date: p.p90Date, shown, bufferDays: p.bufferDays, riskScore: p.riskScore },
        actor: SYSTEM_ACTOR,
        correlationId: input.order.correlationId,
        buildId: input.order.buildId,
        orderId: input.order.id,
        timestamp: input.now,
    });
    return { promisedDate, shown, p90Date: p.p90Date };
}

/** Where an order is in its legs, for the remaining-P90 recheck. */
async function stageOf(db: DbOrTx, order: OrderRow): Promise<Parameters<typeof remainingLegs>[0] | null> {
    const [leg] = await db.select({ status: supplierLegs.status }).from(supplierLegs).where(eq(supplierLegs.orderId, order.id));
    switch (order.status) {
        case 'PAID':
        case 'DISPATCHED':
        case 'ACCEPTED':
            if (leg && (leg.status === 'PO_PLACED' || leg.status === 'IN_PRODUCTION_AT_SUPPLIER' || leg.status === 'SHIPPED_INBOUND')) return 'AT_SUPPLIER';
            return 'QUEUED_AT_SHOP';
        case 'IN_PRODUCTION':
        case 'QA_FAILED':
            return 'IN_PRODUCTION';
        case 'QA_PASSED':
            return 'QA_PASSED';
        case 'SHIPPED':
            return 'SHIPPED';
        default:
            return null;
    }
}

/**
 * Recompute the remaining legs' P90 from today. Crossing the promised date marks the promise
 * AT_RISK (once) with `promise.at_risk` and an ops alert. Returns whether it is at risk now.
 */
export async function recheckOrderPromise(orderId: string, opts: { now?: Date } = {}): Promise<{ atRisk: boolean; p90Date: string | null }> {
    const now = opts.now ?? new Date();
    return withTx(async (tx) => {
        const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
        const [promise] = order ? await tx.select().from(orderPromises).where(eq(orderPromises.orderId, orderId)).for('update') : [];
        if (!order || !promise || promise.status === 'MET' || promise.status === 'MISSED') return { atRisk: promise?.status === 'AT_RISK', p90Date: promise?.lastP90Date ?? null };
        const stage = await stageOf(tx, order);
        if (!stage) return { atRisk: promise.status === 'AT_RISK', p90Date: promise.lastP90Date };
        const [shop] = order.shopId ? await tx.select({ timezone: shops.timezone }).from(shops).where(eq(shops.id, order.shopId)) : [];
        const today = localDateTime(now, shop?.timezone ?? 'America/New_York').date;
        const remaining = remainingLegs(stage);
        // Material already in flight: only what is left of its P90 counts.
        const elapsed = calendarDaysBetween(promise.startDate, today);
        const legs = promise.legs.map((l) => (l.leg === 'MATERIAL_ARRIVAL' ? { ...l, p90Days: Math.max(0, l.p90Days - elapsed) } : l));
        const p90Date = remainingP90Date({ today, legs, remaining });
        const crossed = p90Date > promise.promisedDate;
        await tx.update(orderPromises).set({ lastP90Date: p90Date, updatedAt: now }).where(eq(orderPromises.orderId, orderId));
        if (crossed && promise.status === 'ON_TRACK') {
            await tx.update(orderPromises).set({ status: 'AT_RISK', atRiskAt: now, updatedAt: now }).where(eq(orderPromises.orderId, orderId));
            const currentLeg: PromiseLeg | null = remaining[0] ?? null;
            await emitEvent(tx, {
                type: 'promise.at_risk',
                payload: { orderId, promisedDate: promise.promisedDate, p90Date, currentLeg },
                actor: SYSTEM_ACTOR,
                correlationId: order.correlationId,
                buildId: order.buildId,
                orderId,
                timestamp: now,
            });
            await emitEvent(tx, {
                type: 'ops.alert_requested',
                payload: {
                    subject: `Delivery promise at risk for ${order.orderNumber}`,
                    message: `The remaining legs' P90 arrival is ${p90Date}, after the promised ${promise.promisedDate} (current leg ${currentLeg ?? 'unknown'}). Expedite or contact the buyer.`,
                    orderId,
                },
                actor: SYSTEM_ACTOR,
                correlationId: order.correlationId,
                buildId: order.buildId,
                orderId: null,
                timestamp: now,
            });
        }
        return { atRisk: crossed || promise.status === 'AT_RISK', p90Date };
    });
}

/** Never let a promise recheck break the caller (a milestone, a shipment). */
export async function recheckOrderPromiseSafely(orderId: string): Promise<void> {
    try {
        await recheckOrderPromise(orderId);
    } catch (err) {
        console.error(`[promise] recheck for ${orderId} failed`, err);
    }
}

/** Recheck every active promise (cron). */
export async function recheckActivePromises(now: Date = new Date()): Promise<{ checked: number; atRisk: number }> {
    const rows = await getDb()
        .select({ orderId: orderPromises.orderId })
        .from(orderPromises)
        .innerJoin(orders, eq(orders.id, orderPromises.orderId))
        .where(and(inArray(orderPromises.status, ['ON_TRACK', 'AT_RISK']), inArray(orders.status, ['PAID', 'DISPATCHED', 'ACCEPTED', 'IN_PRODUCTION', 'QA_FAILED', 'QA_PASSED', 'SHIPPED'])));
    let atRisk = 0;
    for (const r of rows) {
        const res = await recheckOrderPromise(r.orderId, { now });
        if (res.atRisk) atRisk++;
    }
    return { checked: rows.length, atRisk };
}

const dayOf = (d: Date, tz: string) => localDateTime(d, tz).date;

/** Actual days per leg from the order's real timestamps. Legs without both ends are omitted. */
async function actualLegDays(tx: DbOrTx, order: OrderRow, startDate: string, deliveredOn: string, tz: string): Promise<Partial<Record<PromiseLeg, number>>> {
    const jobs = await tx
        .select()
        .from(manufacturingJobs)
        .where(and(eq(manufacturingJobs.orderId, order.id), ne(manufacturingJobs.status, 'CANCELLED')))
        .orderBy(asc(manufacturingJobs.createdAt));
    const started = jobs.find((j) => j.startedAt)?.startedAt ?? null;
    const final = [...jobs].reverse().find((j) => j.shippedAt) ?? null;
    const qaPassed = final?.qaPassedAt ?? null;
    const shipped = final?.shippedAt ?? order.shippedAt ?? null;
    const [qaMilestone] = await tx
        .select({ at: productionMilestones.occurredAt })
        .from(productionMilestones)
        .where(and(eq(productionMilestones.orderId, order.id), eq(productionMilestones.kind, 'QA')))
        .orderBy(desc(productionMilestones.occurredAt))
        .limit(1);
    const [leg] = await tx.select().from(supplierLegs).where(eq(supplierLegs.orderId, order.id));
    const out: Partial<Record<PromiseLeg, number>> = {};
    if (leg) {
        if (leg.receivedAt) out.MATERIAL_ARRIVAL = calendarDaysBetween(startDate, dayOf(leg.receivedAt, tz));
        else if (leg.directShip && leg.deliveredAt) out.MATERIAL_ARRIVAL = calendarDaysBetween(startDate, dayOf(leg.deliveredAt, tz));
        if (leg.receivedAt && started) out.SHOP_QUEUE = businessDaysBetween(dayOf(leg.receivedAt, tz), dayOf(started, tz));
        if (started) out.PROCESS = 0;
        if (leg.receivedAt && qaPassed) out.QA = businessDaysBetween(dayOf(started ?? leg.receivedAt, tz), dayOf(qaPassed, tz));
    } else {
        out.MATERIAL_ARRIVAL = 0;
        if (started) out.SHOP_QUEUE = businessDaysBetween(startDate, dayOf(started, tz));
        const processEnd = qaMilestone?.at ?? qaPassed;
        if (started && processEnd) out.PROCESS = businessDaysBetween(dayOf(started, tz), dayOf(processEnd, tz));
        if (processEnd && qaPassed) out.QA = businessDaysBetween(dayOf(processEnd, tz), dayOf(qaPassed, tz));
    }
    if (qaPassed && shipped) out.PACK = businessDaysBetween(dayOf(qaPassed, tz), dayOf(shipped, tz));
    if (shipped) out.CARRIER_TRANSIT = businessDaysBetween(dayOf(shipped, tz), deliveredOn);
    return out;
}

/**
 * On delivery (inside the delivery transaction, after the order is DELIVERED): record the
 * observations, then MET / MISSED. A missed promise that was shown credits the buyer.
 */
export async function onOrderDelivered(tx: DbOrTx, input: { orderId: string; deliveredAt: Date }): Promise<{ status: 'MET' | 'MISSED' | null; creditCents: number }> {
    const [promise] = await tx.select().from(orderPromises).where(eq(orderPromises.orderId, input.orderId)).for('update');
    if (!promise || promise.status === 'MET' || promise.status === 'MISSED') return { status: null, creditCents: 0 };
    const [order] = await tx.select().from(orders).where(eq(orders.id, input.orderId));
    if (!order) return { status: null, creditCents: 0 };
    const [shop] = order.shopId ? await tx.select().from(shops).where(eq(shops.id, order.shopId)) : [];
    const tz = shop?.timezone ?? 'America/New_York';
    const deliveredOn = dayOf(input.deliveredAt, tz);
    const actual = await actualLegDays(tx, order, promise.startDate, deliveredOn, tz);
    const [leg] = await tx.select({ supplierId: supplierLegs.supplierId, incoterm: supplierLegs.incoterm }).from(supplierLegs).where(eq(supplierLegs.orderId, order.id));
    const [quote] = await tx.select({ summary: quotes.summary }).from(quotes).where(eq(quotes.id, order.quoteId));

    const rows = promise.legs
        .filter((p) => actual[p.leg] !== undefined)
        .map((p) => ({
            orderId: order.id,
            leg: p.leg,
            shopId: order.shopId,
            process: leg ? 'receiving' : (quote?.summary.processName ?? null),
            carrierService: promise.carrierService,
            zone: promise.zone,
            supplierId: leg?.supplierId ?? null,
            incoterm: leg?.incoterm ?? null,
            predictedDays: p.priorDays,
            actualDays: actual[p.leg] as number,
            source: 'order',
            observedAt: input.deliveredAt,
        }));
    if (rows.length) await tx.insert(promiseObservations).values(rows).onConflictDoNothing();

    const missed = deliveredOn > promise.promisedDate;
    const now = new Date();
    const ctx = { actor: SYSTEM_ACTOR, correlationId: order.correlationId, buildId: order.buildId, orderId: order.id, timestamp: now };
    if (!missed) {
        await tx.update(orderPromises).set({ status: 'MET', resolvedAt: now, updatedAt: now }).where(eq(orderPromises.orderId, order.id));
        await emitEvent(tx, { type: 'promise.kept', payload: { orderId: order.id, promisedDate: promise.promisedDate, deliveredOn }, ...ctx });
        return { status: 'MET', creditCents: 0 };
    }
    const blamed = responsibleLeg(promise.legs, actual);
    let creditId: string | null = null;
    let creditCents = 0;
    // Only a date the buyer was shown is a promise; an unshown estimate earns no credit.
    if (promise.shown) {
        const credit = await issuePromiseCredit(tx, { order, leg: blamed, promisedDate: promise.promisedDate, deliveredOn, supplierId: leg?.supplierId ?? null, now });
        creditId = credit.id;
        creditCents = credit.amountCents;
    }
    await tx.update(orderPromises).set({ status: 'MISSED', resolvedAt: now, updatedAt: now }).where(eq(orderPromises.orderId, order.id));
    await emitEvent(tx, { type: 'promise.missed', payload: { orderId: order.id, promisedDate: promise.promisedDate, deliveredOn, responsibleLeg: blamed, creditId, creditCents }, ...ctx });
    return { status: 'MISSED', creditCents };
}

/** Buyer view of an order's promise. */
export async function orderPromiseView(orderId: string, db: DbOrTx = getDb()): Promise<OrderPromiseView | null> {
    const [promise] = await db.select().from(orderPromises).where(eq(orderPromises.orderId, orderId));
    if (!promise) return null;
    const [credit] = await db.select({ amountCents: buyerCredits.amountCents }).from(buyerCredits).where(eq(buyerCredits.sourceOrderId, orderId));
    return { date: promise.promisedDate, show: promise.shown, status: promise.status, creditCents: credit?.amountCents ?? null };
}
