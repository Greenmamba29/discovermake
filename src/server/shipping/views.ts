import type { ShipmentView } from '../../contracts/shipments';
import type { shipments } from '../db/schema';

export type ShipmentRow = typeof shipments.$inferSelect;

function safeUrl(value: string | null | undefined): string | null {
    if (!value) return null;
    try {
        return new URL(value).toString();
    } catch {
        return null;
    }
}

/** Shipment row -> contract view. `includeLabel` only for the shop + ops views (never buyers). */
export function toShipmentView(row: ShipmentRow, opts: { includeLabel: boolean }): ShipmentView {
    return {
        id: row.id,
        orderId: row.orderId,
        jobId: row.jobId,
        provider: row.provider,
        carrier: row.carrier,
        service: row.service,
        trackingNumber: row.trackingNumber,
        trackingUrl: safeUrl(row.trackingUrl),
        labelUrl: opts.includeLabel ? safeUrl(row.labelUrl) : null,
        status: row.status,
        events: row.events,
        estimatedDeliveryDate: row.estimatedDeliveryDate,
        shippedAt: row.shippedAt ? row.shippedAt.toISOString() : null,
        deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
    };
}
