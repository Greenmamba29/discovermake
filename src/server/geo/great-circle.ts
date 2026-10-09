/**
 * Great-circle helpers (pure): the shortest path between two points on the sphere,
 * sampled as a polyline for the tracking map, plus distance and interpolation.
 */
import type { LatLng } from './us-geo';

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
export const EARTH_RADIUS_KM = 6371.0088;

/** Central angle between two points (radians, haversine). */
export function centralAngle(a: LatLng, b: LatLng): number {
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function distanceKm(a: LatLng, b: LatLng): number {
    return centralAngle(a, b) * EARTH_RADIUS_KM;
}

/** Point at fraction `t` (0..1) along the great circle from a to b. */
export function interpolate(a: LatLng, b: LatLng, t: number): LatLng {
    const f = Math.max(0, Math.min(1, t));
    const d = centralAngle(a, b);
    if (d < 1e-9) return { lat: a.lat, lng: a.lng };
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const [la1, lo1, la2, lo2] = [rad(a.lat), rad(a.lng), rad(b.lat), rad(b.lng)];
    const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
    const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
    const z = A * Math.sin(la1) + B * Math.sin(la2);
    return { lat: deg(Math.atan2(z, Math.sqrt(x * x + y * y))), lng: deg(Math.atan2(y, x)) };
}

/** Great-circle polyline as GeoJSON [lng, lat] pairs, `segments` + 1 points including both ends. */
export function greatCirclePath(a: LatLng, b: LatLng, segments = 64): [number, number][] {
    const n = Math.max(1, Math.floor(segments));
    const out: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
        const p = interpolate(a, b, i / n);
        out.push([Math.round(p.lng * 1e5) / 1e5, Math.round(p.lat * 1e5) / 1e5]);
    }
    return out;
}
