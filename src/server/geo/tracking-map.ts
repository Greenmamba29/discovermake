/**
 * Tracking over a map (Shop "Arrives Jul 31" carrier card + Waymo one status line):
 * shop city → destination as a great-circle line, a progress estimate from carrier scans
 * and dates, the carrier card, and one plain status sentence. Geocoding is offline
 * (src/server/geo/us-geo.ts); tiles come from NEXT_PUBLIC_MAP_STYLE_URL when set, else
 * the client draws an offline SVG map.
 */
import { desc, eq } from 'drizzle-orm';
import type { TrackingMapView } from '../../contracts/prime';
import type { TrackingEvent } from '../../contracts/shipments';
import { getDb } from '../db';
import { shipments, shops } from '../db/schema';
import { env } from '../env';
import { ApiError } from '../http';
import type { OrderRow } from '../r3/order-access';
import { greatCirclePath, interpolate } from './great-circle';
import { geocodeUs } from './us-geo';

type ShipmentRow = typeof shipments.$inferSelect;

function shortDay(date: string | Date): string {
    const d = typeof date === 'string' ? new Date(`${date.slice(0, 10)}T12:00:00Z`) : date;
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Pure: progress 0..1 along the route from the shipment state and dates. */
export function routeProgress(s: Pick<ShipmentRow, 'status' | 'shippedAt' | 'estimatedDeliveryDate' | 'createdAt'>, now: Date = new Date()): number {
    switch (s.status) {
        case 'DELIVERED':
            return 1;
        case 'OUT_FOR_DELIVERY':
            return 0.94;
        case 'LABEL_CREATED':
            return 0.04;
        case 'IN_TRANSIT':
        case 'EXCEPTION': {
            const start = (s.shippedAt ?? s.createdAt).getTime();
            const end = s.estimatedDeliveryDate ? new Date(`${s.estimatedDeliveryDate}T17:00:00Z`).getTime() : start + 4 * 86_400_000;
            const f = end > start ? (now.getTime() - start) / (end - start) : 0.5;
            return Math.max(0.12, Math.min(0.88, f));
        }
        default:
            return 0;
    }
}

/** Pure: one plain sentence for the bottom sheet. */
export function statusSentence(s: Pick<ShipmentRow, 'status' | 'carrier' | 'estimatedDeliveryDate' | 'deliveredAt'>, destinationCity: string): string {
    const eta = s.estimatedDeliveryDate ? ` · arrives ${shortDay(s.estimatedDeliveryDate)}` : '';
    switch (s.status) {
        case 'DELIVERED':
            return `Delivered to ${destinationCity}${s.deliveredAt ? ` on ${shortDay(s.deliveredAt)}` : ''}`;
        case 'OUT_FOR_DELIVERY':
            return `Out for delivery in ${destinationCity} today`;
        case 'LABEL_CREATED':
            return `Packed · ${s.carrier} picks it up soon${eta}`;
        case 'EXCEPTION':
            return `${s.carrier} reported a delay${eta}`;
        case 'RETURNED':
            return `Returned to the shop by ${s.carrier}`;
        case 'CANCELLED':
            return 'Shipment cancelled';
        default:
            return `On the way with ${s.carrier}${eta}`;
    }
}

export async function getTrackingMap(order: OrderRow, now: Date = new Date()): Promise<TrackingMapView> {
    const db = getDb();
    const [ship] = await db.select().from(shipments).where(eq(shipments.orderId, order.id)).orderBy(desc(shipments.createdAt)).limit(1);
    if (!ship) throw new ApiError('NOT_FOUND', 'This order has not shipped yet.');
    const [shop] = order.shopId ? await db.select().from(shops).where(eq(shops.id, order.shopId)).limit(1) : [];
    const fromAddr = ship.fromAddress;
    const fromCity = shop?.city ?? fromAddr.city;
    const fromRegion = shop?.region ?? fromAddr.region;
    const from = geocodeUs({ city: fromCity, region: fromRegion, postalCode: fromAddr.postalCode }) ?? (shop?.lat != null && shop?.lng != null ? { lat: shop.lat, lng: shop.lng, precision: 'city' as const, state: fromRegion } : null);
    const to = ship.toAddress;
    const dest = geocodeUs({ city: to.city, region: to.region, postalCode: to.postalCode });
    if (!from || !dest) throw new ApiError('NOT_FOUND', 'The route for this shipment could not be drawn.');
    const progress = routeProgress(ship, now);
    const cur = interpolate(from, dest, progress);
    const events = [...(ship.events as TrackingEvent[])].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    const last = events[0] ?? null;
    let styleUrl: string | null = null;
    try {
        styleUrl = env().NEXT_PUBLIC_MAP_STYLE_URL ? new URL(env().NEXT_PUBLIC_MAP_STYLE_URL!).toString() : null;
    } catch {
        styleUrl = null;
    }
    return {
        from: { lat: from.lat, lng: from.lng, label: `${fromCity}, ${fromRegion}` },
        to: { lat: dest.lat, lng: dest.lng, label: `${to.city}, ${to.region}` },
        path: greatCirclePath(from, dest, 64),
        progress,
        current: { lat: cur.lat, lng: cur.lng, label: last?.location ?? (progress >= 1 ? `${to.city}, ${to.region}` : 'In transit') },
        statusSentence: statusSentence(ship, to.city),
        eta: ship.estimatedDeliveryDate,
        delivered: ship.status === 'DELIVERED',
        carrier: {
            carrier: ship.carrier,
            service: ship.service,
            trackingNumber: ship.trackingNumber,
            trackingUrl: ship.trackingUrl,
            lastScan: last ? { message: last.message, location: last.location, at: last.occurredAt } : null,
        },
        styleUrl,
    };
}
