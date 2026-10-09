/**
 * Buyer order view (screens 05 + 06). Everything comes from real rows:
 * the order, its status history, domain_events (timeline), milestones,
 * inspection results, shipments and the passport. Nothing is fabricated.
 */
import { asc, desc, eq, inArray } from 'drizzle-orm';
import type { MilestoneKind, OrderStatus } from '../../contracts/enums';
import { OrderView, TRACKING_STEPS, type TimelineEntry, type TrackingStep, type TrackingStepKey } from '../../contracts/orders';
import type { MilestoneView } from '../../contracts/shop';
import type { ShipmentView } from '../../contracts/shipments';
import { verifyOrderAccessToken } from '../auth/order-link';
import { getDb } from '../db';
import {
    builds,
    domainEvents,
    inspectionResults,
    orderStatusHistory,
    orders,
    parts,
    passports,
    productionMilestones,
    quotes,
    shipments,
    shops,
} from '../db/schema';
import { env } from '../env';
import { formatMoney } from '../notify/templates';
import { ORDER_STATUS_DISPLAY, toUniversalStatus } from './state';
import { orderPromiseView } from '../promise/engine';
import { orderSupplierRouteView } from '../prime/views';

export const MILESTONE_LABELS: Readonly<Record<MilestoneKind, string>> = {
    MATERIAL_STAGED: 'Material staged',
    CUTTING: 'Cutting',
    BENDING: 'Bending',
    FINISHING: 'Finishing',
    QA: 'Quality check',
    PACKED: 'Packed',
};

const MILESTONE_TIMELINE: Readonly<Record<MilestoneKind, string>> = {
    MATERIAL_STAGED: 'Material staged',
    CUTTING: 'Cutting started',
    BENDING: 'Bending started',
    FINISHING: 'Finishing started',
    QA: 'Quality check started',
    PACKED: 'Packed and ready to ship',
};

const STEP_LABELS: Readonly<Record<TrackingStepKey, string>> = {
    DESIGN: 'Design',
    MATERIALS: 'Materials',
    PRODUCTION: 'Production',
    QA: 'QA',
    SHIPPING: 'Shipping',
    DELIVERED: 'Delivered',
};

const iso = (d: Date) => d.toISOString();

function safeUrl(value: string | null | undefined): string | null {
    if (!value) return null;
    try {
        return new URL(value).toString();
    } catch {
        return null;
    }
}

/** "Thu, Oct 9" from a YYYY-MM-DD calendar date. */
export function shortDate(ymd: string): string {
    const d = new Date(`${ymd}T12:00:00Z`);
    return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d);
}

/** Step the order has reached when it enters `status` (null for off-path statuses). */
function stepForStatus(status: OrderStatus): TrackingStepKey | null {
    if (status === 'PAYMENT_FAILED' || status === 'CANCELLED' || status === 'REFUNDED') return null;
    return ORDER_STATUS_DISPLAY[status].step;
}

/** Stepper (Design -> ... -> Delivered) derived from current status + status history. */
export function buildTrackingSteps(
    status: OrderStatus,
    createdAt: Date,
    history: { toStatus: OrderStatus; createdAt: Date }[],
): TrackingStep[] {
    const reachedAt = new Map<TrackingStepKey, Date>([['DESIGN', createdAt]]);
    for (const h of history) {
        const step = stepForStatus(h.toStatus);
        if (step && !reachedAt.has(step)) reachedAt.set(step, h.createdAt);
    }
    const index = (k: TrackingStepKey) => TRACKING_STEPS.indexOf(k);
    let furthest = 0;
    for (const k of reachedAt.keys()) furthest = Math.max(furthest, index(k));

    let currentIdx: number;
    let currentState: TrackingStep['state'];
    if (status === 'DELIVERED' || status === 'COMPLETE') {
        currentIdx = TRACKING_STEPS.length; // everything done
        currentState = 'done';
    } else if (status === 'PAYMENT_FAILED') {
        currentIdx = 0;
        currentState = 'failed';
    } else if (status === 'CANCELLED' || status === 'REFUNDED') {
        currentIdx = furthest;
        currentState = 'failed';
    } else if (status === 'QA_FAILED') {
        currentIdx = index('QA');
        currentState = 'failed';
    } else {
        currentIdx = index(ORDER_STATUS_DISPLAY[status].step);
        currentState = 'current';
    }

    return TRACKING_STEPS.map((key, i) => {
        const at = reachedAt.get(key) ?? null;
        if (i < currentIdx) return { key, label: STEP_LABELS[key], state: 'done', at: at ? iso(at) : null };
        if (i === currentIdx) return { key, label: STEP_LABELS[key], state: currentState, at: at ? iso(at) : null };
        return { key, label: STEP_LABELS[key], state: 'upcoming', at: null };
    });
}

type EventRow = typeof domainEvents.$inferSelect;

/** Buyer-safe, plain-language timeline label; null = not shown to buyers (internal events). */
export function timelineLabel(row: Pick<EventRow, 'eventType' | 'payload'>, shopNames: Map<string, string>): string | null {
    const p = (row.payload ?? {}) as Record<string, unknown>;
    const shop = typeof p.shopId === 'string' ? shopNames.get(p.shopId) ?? 'the partner shop' : 'the partner shop';
    switch (row.eventType) {
        case 'order.created':
            return 'Order placed';
        case 'payment.completed':
            return 'Payment received';
        case 'payment.failed':
            return p.reason ? `Payment failed · ${String(p.reason)}` : 'Payment failed';
        case 'payment.authorized':
            return 'Payment authorized · charged only when the drop reaches its goal';
        case 'payment.authorization_released':
            return 'Payment hold released · nothing was charged';
        case 'production.authorized':
            return 'Production authorized';
        case 'job.offered':
            return p.isRework ? 'Rework job opened' : 'Sent to a partner shop for acceptance';
        case 'job.declined':
        case 'job.expired':
            return 'Finding another partner shop';
        case 'dispatch.unmatched':
            return 'Our team is matching your order with a partner shop';
        case 'job.accepted':
            return `${shop} accepted your job`;
        case 'production.started':
            return `Production started at ${shop}`;
        case 'production.milestone': {
            const kind = p.kind as MilestoneKind;
            const label = MILESTONE_TIMELINE[kind] ?? 'Production update';
            return `${label} at ${shop}`;
        }
        case 'inspection.passed':
            return 'Passed quality inspection';
        case 'inspection.failed':
            return 'Inspection found an issue · rework started';
        case 'production.completed':
            return 'Production complete';
        case 'shipment.created':
            return typeof p.trackingNumber === 'string' && p.trackingNumber.trim()
                ? `Shipped with ${String(p.carrier ?? 'carrier')} · tracking ${p.trackingNumber.trim()}`
                : `Shipped with ${String(p.carrier ?? 'carrier')}`;
        case 'shipment.updated':
            return typeof p.message === 'string' && p.message ? p.message : `Shipment ${String(p.status ?? 'updated').toLowerCase().replace(/_/g, ' ')}`;
        case 'product.delivered':
            return 'Delivered';
        case 'passport.activated':
            return 'Product Passport activated';
        case 'order.completed':
            return 'Order complete';
        case 'order.refunded':
            return `Refunded${typeof p.amountCents === 'number' ? ` ${formatMoney(p.amountCents, 'usd')}` : ''}`;
        case 'order.cancelled':
            return 'Order cancelled';
        // ---- R3 Prime ----
        case 'promise.set':
            return null; // the promised date is in the status line ("Arrives Thu, Oct 23"), not the feed
        case 'promise.missed':
            return typeof p.creditCents === 'number' && p.creditCents > 0
                ? `We missed your delivery date · ${formatMoney(p.creditCents, 'usd')} credit added to your next order`
                : 'Arrived after the estimated date';
        case 'promise.kept':
            return 'Arrived on the promised date';
        case 'credit.redeemed':
            return typeof p.amountCents === 'number' ? `Promise credit of ${formatMoney(p.amountCents, 'usd')} applied` : 'Promise credit applied';
        case 'po.approval_requested':
            return 'Deposit received · DiscoverMake is approving the purchase order';
        case 'po.placed':
            return 'Purchase order placed with a verified manufacturing partner';
        case 'supplier_leg.status_changed':
            switch (p.to) {
                case 'IN_PRODUCTION_AT_SUPPLIER':
                    return 'Production started at our manufacturing partner';
                case 'SHIPPED_INBOUND':
                    return 'Shipped from our manufacturing partner';
                case 'RECEIVED_AT_PARTNER':
                    return 'Received by our receiving partner · inspecting';
                case 'QA_FAILED':
                    return 'Did not pass receiving inspection · being fixed at no cost to you';
                case 'CANCELLED':
                    return 'Purchase order cancelled';
                default:
                    return null;
            }
        case 'order.balance_due':
            return typeof p.amountCents === 'number' ? `Passed inspection · balance of ${formatMoney(p.amountCents, 'usd')} due before shipping` : 'Balance due before shipping';
        default:
            return null; // order.status_changed, job.cancelled, ledger.*, payout.*, quote/part events
    }
}

function statusSentence(
    status: OrderStatus,
    ctx: { promisedShipDate: string; shopName: string | null; latestMilestone: MilestoneKind | null; shipment: ShipmentView | null },
): string {
    const ships = `Ships ${shortDate(ctx.promisedShipDate)}`;
    switch (status) {
        case 'ACCEPTED':
            return ctx.shopName ? `${ctx.shopName} accepted · staging material · ${ships}` : `${ORDER_STATUS_DISPLAY.ACCEPTED.label} · ${ships}`;
        case 'IN_PRODUCTION':
            return ctx.latestMilestone ? `${MILESTONE_LABELS[ctx.latestMilestone]} now · ${ships}` : `In production · ${ships}`;
        case 'PAID':
        case 'DISPATCHED':
            return `${ORDER_STATUS_DISPLAY[status].label} · ${ships}`;
        case 'SHIPPED':
            if (ctx.shipment) {
                const eta = ctx.shipment.estimatedDeliveryDate ? ` · arrives ${shortDate(ctx.shipment.estimatedDeliveryDate)}` : '';
                return `Shipped with ${ctx.shipment.carrier}${eta}`;
            }
            return ORDER_STATUS_DISPLAY.SHIPPED.label;
        default:
            return ORDER_STATUS_DISPLAY[status].label;
    }
}

/**
 * Buyer view of an order. Returns null when the order does not exist OR the
 * token does not verify (never reveal which). Timeline comes from domain_events.
 */
export async function getOrderForBuyer(orderId: string, token: string | null): Promise<OrderView | null> {
    const db = getDb();
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    if (!order || !verifyOrderAccessToken(order.id, token, order.accessTokenHash)) return null;
    return buildOrderView(order);
}

/** Assemble the OrderView for an (already authorized) order row. */
export async function buildOrderView(order: typeof orders.$inferSelect): Promise<OrderView> {
    const db = getDb();
    const [[build], [quote], history, events, milestoneRows, [inspection], [shipmentRow], [passport]] = await Promise.all([
        db.select().from(builds).where(eq(builds.id, order.buildId)),
        db.select().from(quotes).where(eq(quotes.id, order.quoteId)),
        db.select().from(orderStatusHistory).where(eq(orderStatusHistory.orderId, order.id)).orderBy(asc(orderStatusHistory.createdAt)),
        db.select().from(domainEvents).where(eq(domainEvents.orderId, order.id)).orderBy(asc(domainEvents.timestamp), asc(domainEvents.eventId)),
        db.select().from(productionMilestones).where(eq(productionMilestones.orderId, order.id)).orderBy(asc(productionMilestones.occurredAt)),
        db.select().from(inspectionResults).where(eq(inspectionResults.orderId, order.id)).orderBy(desc(inspectionResults.createdAt)).limit(1),
        db.select().from(shipments).where(eq(shipments.orderId, order.id)).orderBy(desc(shipments.createdAt)).limit(1),
        db.select().from(passports).where(eq(passports.orderId, order.id)).limit(1),
    ]);
    if (!build || !quote) throw new Error(`Order ${order.id} references a missing build or quote`);
    const [part] = await db.select({ preview: parts.preview }).from(parts).where(eq(parts.id, quote.partId));

    const shopIds = new Set<string>();
    if (order.shopId) shopIds.add(order.shopId);
    for (const e of events) {
        const sid = (e.payload as { shopId?: unknown } | null)?.shopId;
        if (typeof sid === 'string') shopIds.add(sid);
    }
    const shopRows = shopIds.size ? await db.select().from(shops).where(inArray(shops.id, [...shopIds])) : [];
    const shopNames = new Map(shopRows.map((s) => [s.id, s.name]));
    const assignedShop = order.shopId ? shopRows.find((s) => s.id === order.shopId) ?? null : null;

    const timeline: TimelineEntry[] = [];
    for (const e of events) {
        const label = timelineLabel(e, shopNames);
        if (!label) continue;
        timeline.push({ eventId: e.eventId, eventType: e.eventType, label, actorKind: e.actorId.split(':')[0] ?? 'system', at: iso(e.timestamp) });
    }

    const milestones: MilestoneView[] = milestoneRows.map((m) => ({
        id: m.id,
        jobId: m.jobId,
        kind: m.kind,
        label: MILESTONE_LABELS[m.kind],
        note: m.note,
        occurredAt: iso(m.occurredAt),
    }));

    const shipment: ShipmentView | null = shipmentRow
        ? {
              id: shipmentRow.id,
              orderId: shipmentRow.orderId,
              jobId: shipmentRow.jobId,
              provider: shipmentRow.provider,
              carrier: shipmentRow.carrier,
              service: shipmentRow.service,
              trackingNumber: shipmentRow.trackingNumber,
              trackingUrl: safeUrl(shipmentRow.trackingUrl),
              labelUrl: null, // labels are for the shop + ops only
              status: shipmentRow.status,
              events: shipmentRow.events,
              estimatedDeliveryDate: shipmentRow.estimatedDeliveryDate,
              shippedAt: shipmentRow.shippedAt ? iso(shipmentRow.shippedAt) : null,
              deliveredAt: shipmentRow.deliveredAt ? iso(shipmentRow.deliveredAt) : null,
              createdAt: iso(shipmentRow.createdAt),
          }
        : null;

    const activePassport =
        passport && passport.status === 'ACTIVE' && passport.activatedAt
            ? { id: passport.id, url: new URL(`/passport/${encodeURIComponent(passport.id)}`, env().APP_URL).toString(), activatedAt: iso(passport.activatedAt) }
            : null;

    const latestMilestone = milestoneRows.length ? milestoneRows[milestoneRows.length - 1].kind : null;
    const display = ORDER_STATUS_DISPLAY[order.status];
    // R3: the Delivery Promise and, for supplier-route orders, the leg (one sentence per step).
    const [promise, supplierRoute] = await Promise.all([orderPromiseView(order.id, db), orderSupplierRouteView(order, db)]);
    let statusLabel = statusSentence(order.status, { promisedShipDate: order.promisedShipDate, shopName: assignedShop?.name ?? null, latestMilestone, shipment });
    if (supplierRoute && ['PAID', 'DISPATCHED', 'ACCEPTED', 'IN_PRODUCTION', 'QA_FAILED', 'QA_PASSED'].includes(order.status)) {
        const step = supplierRoute.steps.find((st) => st.state === 'current' || st.state === 'failed');
        if (step) statusLabel = step.sentence;
        if (order.status === 'QA_PASSED' && !supplierRoute.payment.balancePaid) statusLabel = 'Passed inspection · pay the balance to ship';
    }
    const arrives = promise?.show && !order.deliveredAt && !['CANCELLED', 'REFUNDED', 'PAYMENT_FAILED'].includes(order.status) ? ` · Arrives ${shortDate(promise.date)}` : '';
    if (arrives && !/\b(ships|arrives)\b/i.test(statusLabel) && order.status !== 'PENDING_PAYMENT') statusLabel += arrives;

    const view: OrderView = {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        universalStatus: toUniversalStatus(order.status),
        statusLabel,
        progressPct: display.progressPct,
        orderType: order.orderType,
        build: { id: build.id, displayId: build.displayId, name: build.name },
        quoteId: quote.id,
        designVersion: quote.designVersion,
        summary: quote.summary,
        preview: part?.preview ?? null,
        unitPriceCents: order.unitPriceCents,
        subtotalCents: order.subtotalCents,
        shippingCents: order.shippingCents,
        taxCents: order.taxCents,
        totalCents: order.totalCents,
        currency: order.currency,
        shippingMethod: order.shippingMethod,
        shippingAddress: order.shippingAddress,
        buyer: { name: order.buyerName, email: order.buyerEmail },
        promisedShipDate: order.promisedShipDate,
        steps: buildTrackingSteps(order.status, order.createdAt, history),
        timeline,
        shop: assignedShop ? { name: assignedShop.name, city: assignedShop.city, region: assignedShop.region, rating: assignedShop.rating } : null,
        milestones,
        inspection: inspection ? { outcome: inspection.outcome, at: iso(inspection.createdAt) } : null,
        shipment,
        passport: activePassport,
        createdAt: iso(order.createdAt),
        paidAt: order.paidAt ? iso(order.paidAt) : null,
        deliveredAt: order.deliveredAt ? iso(order.deliveredAt) : null,
        ...(promise ? { promise } : {}),
        ...(supplierRoute ? { supplierRoute } : {}),
    };
    return OrderView.parse(view);
}
