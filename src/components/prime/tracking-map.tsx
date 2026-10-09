'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, Truck } from 'lucide-react';
import type { TrackingMapView } from '@/contracts/prime';
import { dateTime, shortDate } from '@/lib/format';
import { primeApi } from './api';
import { MAP_H, MAP_W, project, US_OUTLINE_PATH } from './us-outline';

/** Offline vector-free fallback: SVG US outline, the great-circle line, both ends and the parcel. */
function OfflineMap({ map }: { map: TrackingMapView }) {
    const line = map.path.map(([lng, lat]) => project(lng, lat).join(',')).join(' ');
    const done = map.path.slice(0, Math.max(1, Math.round(map.progress * (map.path.length - 1))) + 1).map(([lng, lat]) => project(lng, lat).join(',')).join(' ');
    const [fx, fy] = project(map.from.lng, map.from.lat);
    const [tx, ty] = project(map.to.lng, map.to.lat);
    const [cx, cy] = project(map.current.lng, map.current.lat);
    return (
        <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="h-full w-full" role="img" aria-label={`Route from ${map.from.label} to ${map.to.label}`} data-testid="map-offline">
            <rect width={MAP_W} height={MAP_H} fill="#101312" />
            <path d={US_OUTLINE_PATH} fill="#1a1f1d" stroke="#2e3532" strokeWidth={1.2} strokeLinejoin="round" />
            <polyline points={line} fill="none" stroke="#3a443f" strokeWidth={2.5} strokeDasharray="5 5" strokeLinecap="round" />
            <polyline points={done} fill="none" stroke="#5fe08a" strokeWidth={3} strokeLinecap="round" />
            <circle cx={fx} cy={fy} r={5} fill="#0c0e0d" stroke="#5fe08a" strokeWidth={2} />
            <circle cx={tx} cy={ty} r={6} fill="#5fe08a" />
            {!map.delivered && <circle cx={cx} cy={cy} r={7} fill="#5fe08a" stroke="#0c0e0d" strokeWidth={3} />}
            <text x={fx} y={fy - 10} fill="#c9d1cc" fontSize={11} textAnchor="middle">
                {map.from.label}
            </text>
            <text x={tx} y={ty + 18} fill="#c9d1cc" fontSize={11} textAnchor="middle">
                {map.to.label}
            </text>
        </svg>
    );
}

/** MapLibre with tiles from NEXT_PUBLIC_MAP_STYLE_URL, lazy-loaded only when a style is configured. */
function LiveMap({ map }: { map: TrackingMapView }) {
    const ref = useRef<HTMLDivElement>(null);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        let disposed = false;
        let instance: { remove: () => void } | null = null;
        (async () => {
            try {
                const maplibre = (await import('maplibre-gl')).default;
                await import('maplibre-gl/dist/maplibre-gl.css');
                if (disposed || !ref.current) return;
                const m = new maplibre.Map({ container: ref.current, style: map.styleUrl!, attributionControl: { compact: true }, interactive: true });
                instance = m;
                m.on('load', () => {
                    m.addSource('route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: map.path } } });
                    m.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': '#5fe08a', 'line-width': 3 } });
                    new maplibre.Marker({ color: '#9aa39e' }).setLngLat([map.from.lng, map.from.lat]).addTo(m);
                    new maplibre.Marker({ color: '#5fe08a' }).setLngLat([map.to.lng, map.to.lat]).addTo(m);
                    const lngs = map.path.map((p) => p[0]);
                    const lats = map.path.map((p) => p[1]);
                    m.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 48, duration: 0 });
                });
                m.on('error', () => setFailed(true));
            } catch {
                setFailed(true);
            }
        })();
        return () => {
            disposed = true;
            instance?.remove();
        };
    }, [map]);
    if (failed) return <OfflineMap map={map} />;
    return <div ref={ref} className="h-full w-full" data-testid="map-live" />;
}

/** Shop "Arrives Jul 31" carrier card + Waymo one-line status, over the route map. */
export function TrackingMap({ orderId, token, shipped }: { orderId: string; token: string | null; shipped: boolean }) {
    const q = useQuery({ queryKey: ['tracking-map', orderId, token], queryFn: () => primeApi.trackingMap(orderId, token), enabled: shipped, refetchInterval: 60_000, retry: false });
    const [copied, setCopied] = useState(false);
    if (!shipped || !q.data) return null;
    const map = q.data;
    const c = map.carrier;
    return (
        <section aria-labelledby="map-heading" className="overflow-hidden rounded-2xl bg-graphite-900 ring-1 ring-graphite-700" data-testid="tracking-map">
            <div className="relative aspect-[16/9] w-full bg-graphite-950">{map.styleUrl ? <LiveMap map={map} /> : <OfflineMap map={map} />}</div>
            <div className="relative -mt-6 rounded-t-2xl bg-graphite-900 p-4 sm:p-5">
                <h2 id="map-heading" className="font-display text-lg font-bold" data-testid="map-status">
                    {map.statusSentence}
                </h2>
                {map.eta && !map.delivered && <p className="text-sm text-signal">Arrives {shortDate(map.eta)}</p>}
                <div className="mt-3 flex items-start gap-3 rounded-xl bg-graphite-850 p-3 ring-1 ring-graphite-700" data-testid="carrier-card">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-graphite-750" aria-hidden>
                        <Truck className="h-5 w-5 text-signal" />
                    </span>
                    <div className="min-w-0 flex-1 text-sm">
                        <p className="font-semibold text-fg">
                            {c.carrier} {c.service}
                        </p>
                        <p className="flex flex-wrap items-center gap-2 font-mono text-xs text-fg-muted">
                            <span data-testid="carrier-tracking-number">{c.trackingNumber}</span>
                            <button
                                type="button"
                                className="inline-flex items-center gap-1 rounded px-1 font-sans font-semibold text-fg-muted hover:text-fg"
                                onClick={async () => {
                                    try {
                                        await navigator.clipboard.writeText(c.trackingNumber);
                                        setCopied(true);
                                        setTimeout(() => setCopied(false), 1500);
                                    } catch {
                                        /* clipboard blocked */
                                    }
                                }}
                            >
                                {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
                                {copied ? 'Copied' : 'Copy'}
                            </button>
                        </p>
                        {c.lastScan && (
                            <p className="mt-1 text-xs text-fg-subtle" data-testid="carrier-last-scan">
                                Last scan: {c.lastScan.message}
                                {c.lastScan.location ? ` · ${c.lastScan.location}` : ''} · {dateTime(c.lastScan.at)}
                            </p>
                        )}
                    </div>
                    {c.trackingUrl && (
                        <a href={c.trackingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-signal hover:underline">
                            Track <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                            <span className="sr-only">(opens in a new tab)</span>
                        </a>
                    )}
                </div>
                <p className="mt-2 text-[11px] text-fg-subtle">
                    {map.from.label} → {map.to.label}
                </p>
            </div>
        </section>
    );
}
