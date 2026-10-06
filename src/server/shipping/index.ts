/**
 * Carriers + tracking.
 *
 * OWNER: shop agent. Signatures FINAL.
 *
 * - `easypost`: EasyPost REST via fetch (EASYPOST_API_KEY), webhook HMAC with EASYPOST_WEBHOOK_SECRET.
 * - `manual`: test double; the shop enters carrier + tracking number. ONLY when CARRIER=manual and
 *   NODE_ENV !== 'production' (`assertNotProduction('manual carrier')`). Delivery is confirmed by
 *   ops via POST /api/admin/shipments/:id/delivered.
 *
 * Delivery orchestration (markShipmentDelivered):
 *   tx 1: shipment DELIVERED -> advanceOrder SHIPPED -> DELIVERED, `product.delivered`
 *   tx 2: activatePassport(orderId) -> recordPayouts(orderId) -> advanceOrder DELIVERED -> COMPLETE, `order.completed`
 *   after commit: execute Stripe Connect payouts (if configured) + notify the buyer.
 * tx 2 is separate so a delivery is never lost; if it fails the order stays DELIVERED,
 * ops are alerted, and calling markShipmentDelivered again (or the carrier retrying) finishes it.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { Actor } from '../../contracts/common';
import { SYSTEM_ACTOR } from '../../contracts/common';
import type { ShipmentView, TrackingEvent } from '../../contracts/shipments';
import { getDb, withTx } from '../db';
import { manufacturingJobs, orders, shipments, webhookEvents } from '../db/schema';
import { env } from '../env';
import { emitEvent } from '../events/outbox';
import { ApiError } from '../http';
import { executePendingPayouts, recordPayouts } from '../ledger';
import { notify } from '../notify';
import { advanceOrder } from '../orders';
import { activatePassport, passportUrl } from '../passport';
import { EasyPostCarrier } from './easypost';
import { ManualCarrier } from './manual';
import type { CarrierAdapter, TrackingUpdate } from './types';
import { toShipmentView } from './views';

export type { BuyLabelInput, BuyLabelResult, CarrierAdapter, TrackingUpdate } from './types';
export { WebhookSignatureError } from './types';
export { EasyPostCarrier, selectRate, easyPostSignature, EASYPOST_API_URL } from './easypost';
export { ManualCarrier, publicTrackingUrl } from './manual';
export { toShipmentView, type ShipmentRow } from './views';

/** The configured carrier adapter (CARRIER=easypost|manual). */
export function getCarrier(): CarrierAdapter {
    const e = env();
    if (e.CARRIER === 'manual') return new ManualCarrier();
    return new EasyPostCarrier({ apiKey: e.EASYPOST_API_KEY, webhookSecret: e.EASYPOST_WEBHOOK_SECRET });
}

const TERMINAL_SHIPMENT = new Set(['DELIVERED', 'RETURNED', 'CANCELLED']);

function sameEvent(a: TrackingEvent, b: TrackingEvent): boolean {
    return a.status === b.status && a.occurredAt === b.occurredAt && a.message === b.message;
}

/** Apply a tracking update: append event, update status, `shipment.updated`; DELIVERED triggers markShipmentDelivered. Idempotent. */
export async function applyTrackingUpdate(update: TrackingUpdate): Promise<void> {
    const db = getDb();
    const [found] = update.providerShipmentId
        ? await db.select().from(shipments).where(eq(shipments.providerShipmentId, update.providerShipmentId)).limit(1)
        : await db.select().from(shipments).where(eq(shipments.trackingNumber, update.trackingNumber)).orderBy(desc(shipments.createdAt)).limit(1);
    if (!found) {
        console.warn(`[shipping] tracking update ${update.eventId} matches no shipment (${update.trackingNumber})`);
        return;
    }
    const carrierActor: Actor = { kind: 'carrier', id: found.provider };

    if (update.event.status === 'DELIVERED') {
        try {
            await markShipmentDelivered(found.id, carrierActor, new Date(update.event.occurredAt));
        } catch (err) {
            // A state conflict will never succeed on retry: alert ops instead of letting the carrier retry forever.
            // Anything else (e.g. passport activation failed) propagates so the webhook is retried.
            if (!(err instanceof ApiError && err.code === 'CONFLICT')) throw err;
            await notify('ops.alert', {
                subject: `Carrier reported delivery for shipment ${found.id} that cannot be applied`,
                message: `${err.message}. Tracking ${found.trackingNumber}. Review the order and confirm delivery manually.`,
                orderId: found.orderId,
            });
        }
        return;
    }

    const changed = await withTx(async (t) => {
        const [order] = await t.select().from(orders).where(eq(orders.id, found.orderId)).for('update');
        const [s] = await t.select().from(shipments).where(eq(shipments.id, found.id)).for('update');
        if (!order || !s || TERMINAL_SHIPMENT.has(s.status)) return null;
        if (s.events.some((e) => sameEvent(e, update.event))) return null;
        const events = [...s.events, update.event].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
        await t.update(shipments).set({ status: update.event.status, events, updatedAt: new Date() }).where(eq(shipments.id, s.id));
        await emitEvent(t, {
            type: 'shipment.updated',
            payload: { shipmentId: s.id, orderId: s.orderId, status: update.event.status, message: update.event.message },
            actor: carrierActor,
            correlationId: order.correlationId,
            buildId: order.buildId,
            orderId: order.id,
        });
        return { orderNumber: order.orderNumber, orderId: order.id, trackingNumber: s.trackingNumber };
    });

    if (changed && (update.event.status === 'EXCEPTION' || update.event.status === 'RETURNED' || update.event.status === 'CANCELLED')) {
        await notify('ops.alert', {
            subject: `Shipment ${update.event.status.toLowerCase()} for ${changed.orderNumber}`,
            message: `Carrier reported ${update.event.status} on ${changed.trackingNumber}: ${update.event.message}`,
            orderId: changed.orderId,
        });
    }
}

/** Confirm delivery and run the delivery orchestration above. Idempotent. */
export async function markShipmentDelivered(shipmentId: string, actor: Actor, deliveredAt?: Date): Promise<ShipmentView> {
    const db = getDb();
    const [found] = await db.select().from(shipments).where(eq(shipments.id, shipmentId));
    if (!found) throw new ApiError('NOT_FOUND', 'Shipment not found');
    const now = new Date();
    const at = deliveredAt && deliveredAt.getTime() <= now.getTime() ? deliveredAt : now;

    // tx 1: record the delivery.
    await withTx(async (t) => {
        const [order] = await t.select().from(orders).where(eq(orders.id, found.orderId)).for('update');
        const [s] = await t.select().from(shipments).where(eq(shipments.id, shipmentId)).for('update');
        if (!order || !s) throw new ApiError('NOT_FOUND', 'Shipment not found');
        if (s.status === 'RETURNED' || s.status === 'CANCELLED') {
            throw new ApiError('CONFLICT', `Shipment is ${s.status}; it cannot be marked delivered`);
        }
        if (s.status !== 'DELIVERED') {
            if (order.status !== 'SHIPPED') {
                throw new ApiError('CONFLICT', `Order ${order.orderNumber} is ${order.status}; only SHIPPED orders can be delivered`);
            }
            const event: TrackingEvent = {
                status: 'DELIVERED',
                message: actor.kind === 'carrier' ? 'Delivered' : `Delivered (confirmed by ${actor.kind})`,
                location: null,
                occurredAt: at.toISOString(),
            };
            await t
                .update(shipments)
                .set({ status: 'DELIVERED', deliveredAt: at, events: [...s.events, event], updatedAt: now })
                .where(eq(shipments.id, s.id));
            await t.update(manufacturingJobs).set({ status: 'DELIVERED', updatedAt: now }).where(and(eq(manufacturingJobs.id, s.jobId), eq(manufacturingJobs.status, 'SHIPPED')));
            await emitEvent(t, {
                type: 'shipment.updated',
                payload: { shipmentId: s.id, orderId: order.id, status: 'DELIVERED', message: event.message },
                actor,
                correlationId: order.correlationId,
                buildId: order.buildId,
                orderId: order.id,
            });
            await advanceOrder(order.id, 'DELIVERED', actor, { reason: event.message, data: { shipmentId: s.id }, at }, t);
            await emitEvent(t, {
                type: 'product.delivered',
                payload: { orderId: order.id, shipmentId: s.id, deliveredAt: at.toISOString() },
                actor,
                correlationId: order.correlationId,
                buildId: order.buildId,
                orderId: order.id,
            });
        }
    });

    // tx 2: passport + payouts + COMPLETE.
    let completed: { orderId: string; orderNumber: string; buyerEmail: string; passportId: string } | null = null;
    try {
        completed = await withTx(async (t) => {
            const [order] = await t.select().from(orders).where(eq(orders.id, found.orderId)).for('update');
            if (!order || order.status !== 'DELIVERED') return null;
            const { passportId } = await activatePassport(order.id, t);
            await recordPayouts(order.id, t);
            await t.update(manufacturingJobs).set({ completedAt: now, updatedAt: now }).where(eq(manufacturingJobs.id, found.jobId));
            await advanceOrder(order.id, 'COMPLETE', SYSTEM_ACTOR, { reason: 'Delivered, passport activated, payout recorded', data: { passportId } }, t);
            await emitEvent(t, {
                type: 'order.completed',
                payload: { orderId: order.id },
                actor: SYSTEM_ACTOR,
                correlationId: order.correlationId,
                buildId: order.buildId,
                orderId: order.id,
            });
            return { orderId: order.id, orderNumber: order.orderNumber, buyerEmail: order.buyerEmail, passportId };
        });
    } catch (err) {
        await notify('ops.alert', {
            subject: `Delivery follow-up failed for order ${found.orderId}`,
            message: `The shipment was delivered but passport activation / payout recording failed: ${err instanceof Error ? err.message : String(err)}. The order stays DELIVERED; retry with POST /api/admin/shipments/${shipmentId}/delivered.`,
            orderId: found.orderId,
        });
        throw err;
    }

    if (completed) {
        await executePendingPayouts(completed.orderId).catch((err) => console.error('[shipping] payout execution failed', err));
        await notify('order.delivered', {
            to: completed.buyerEmail,
            orderId: completed.orderId,
            orderNumber: completed.orderNumber,
            passportUrl: passportUrl(completed.passportId),
        });
    }

    const [row] = await db.select().from(shipments).where(eq(shipments.id, shipmentId));
    return toShipmentView(row, { includeLabel: true });
}

/**
 * Carrier webhook pipeline: verify signature (throws WebhookSignatureError), dedupe on
 * (provider, event_id) in webhook_events, apply, mark processed. Safe to retry.
 */
export async function processCarrierWebhook(rawBody: string, headers: Headers): Promise<{ status: 'ignored' | 'duplicate' | 'processed' }> {
    const carrier = getCarrier();
    const update = await carrier.parseTrackingWebhook(rawBody, headers);
    if (!update) return { status: 'ignored' };
    const db = getDb();
    let payload: unknown;
    try {
        payload = JSON.parse(rawBody);
    } catch {
        payload = { raw: rawBody.slice(0, 2000) };
    }
    await db
        .insert(webhookEvents)
        .values({ provider: carrier.name, eventId: update.eventId, eventType: `tracker.${update.event.status.toLowerCase()}`, payload })
        .onConflictDoNothing({ target: [webhookEvents.provider, webhookEvents.eventId] });
    const [row] = await db
        .select()
        .from(webhookEvents)
        .where(and(eq(webhookEvents.provider, carrier.name), eq(webhookEvents.eventId, update.eventId)));
    if (row?.processedAt) return { status: 'duplicate' };
    try {
        await applyTrackingUpdate(update);
        await db.update(webhookEvents).set({ processedAt: new Date(), error: null }).where(eq(webhookEvents.id, row.id));
        return { status: 'processed' };
    } catch (err) {
        await db
            .update(webhookEvents)
            .set({ error: String(err instanceof Error ? err.message : err).slice(0, 1000) })
            .where(eq(webhookEvents.id, row.id));
        throw err;
    }
}
