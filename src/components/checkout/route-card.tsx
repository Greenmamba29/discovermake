import { BadgeCheck, Factory, MapPin, Star } from 'lucide-react';
import type { QuoteRoute, TrustLevel } from '@/contracts';
import { TrustChip } from '@/components/trust/trust-chip';

/**
 * Recommended manufacturing route (Screen 03): the shop the quote was priced on. Buyer-safe, no shop costs.
 * Pass `trustLevel` to label the route's price with its quote trust level.
 */
export function RouteCard({ route, compact = false, trustLevel }: { route: QuoteRoute; compact?: boolean; trustLevel?: TrustLevel }) {
    return (
        <div className="flex gap-3 rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700" data-testid="route-card">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-graphite-750 text-fg" aria-hidden>
                <Factory className="h-6 w-6" />
            </span>
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-fg">{route.shopName}</p>
                    <span className="rounded-full bg-signal/15 px-2 py-0.5 text-[11px] font-semibold text-signal">Recommended</span>
                    {trustLevel && <TrustChip level={trustLevel} testId="route-trust-chip" />}
                </div>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
                    <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" aria-hidden /> {route.city}, {route.region}
                    </span>
                    <span className="inline-flex items-center gap-1">
                        <Star className="h-3.5 w-3.5" aria-hidden /> {route.rating != null ? `${route.rating.toFixed(1)} rating` : 'New partner'}
                    </span>
                </p>
                {!compact && (
                    <ul className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                        <li className="rounded-md bg-graphite-750 px-2 py-0.5 text-fg-muted">{route.processName}</li>
                        {route.machineLabel && <li className="rounded-md bg-graphite-750 px-2 py-0.5 text-fg-muted">{route.machineLabel}</li>}
                        {route.certifications.map((c) => (
                            <li key={c} className="inline-flex items-center gap-1 rounded-md bg-graphite-750 px-2 py-0.5 text-fg-muted">
                                <BadgeCheck className="h-3 w-3" aria-hidden /> {c}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
