'use client';

import { useState } from 'react';
import { Check, Copy, ExternalLink, Package } from 'lucide-react';
import type { ShipmentView } from '@/contracts';
import { dateTime, humanize, shortDate } from '@/lib/format';

export function ShipmentCard({ shipment }: { shipment: ShipmentView }) {
    const [copied, setCopied] = useState(false);
    const events = [...shipment.events].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    return (
        <section aria-labelledby="shipment-heading" className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700 sm:p-5" data-testid="shipment-card">
            <div className="flex items-start justify-between gap-3">
                <div className="flex gap-3">
                    <Package className="mt-0.5 h-5 w-5 text-signal" aria-hidden />
                    <div>
                        <h2 id="shipment-heading" className="font-semibold text-fg">
                            {shipment.carrier} {shipment.service}
                        </h2>
                        <p className="text-sm text-fg-muted">
                            {humanize(shipment.status)}
                            {shipment.deliveredAt ? ` · ${dateTime(shipment.deliveredAt)}` : shipment.estimatedDeliveryDate ? ` · arrives ${shortDate(shipment.estimatedDeliveryDate)}` : ''}
                        </p>
                    </div>
                </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
                <code className="rounded-lg bg-graphite-850 px-2.5 py-1.5 font-mono text-sm text-fg ring-1 ring-graphite-700" data-testid="tracking-number">
                    {shipment.trackingNumber}
                </code>
                <button
                    type="button"
                    className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-fg-muted hover:bg-graphite-800 hover:text-fg"
                    onClick={async () => {
                        try {
                            await navigator.clipboard.writeText(shipment.trackingNumber);
                            setCopied(true);
                            setTimeout(() => setCopied(false), 1500);
                        } catch {
                            /* clipboard blocked */
                        }
                    }}
                >
                    {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                    {copied ? 'Copied' : 'Copy'}
                </button>
                {shipment.trackingUrl && (
                    <a href={shipment.trackingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-signal hover:bg-graphite-800">
                        Carrier tracking <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                        <span className="sr-only">(opens in a new tab)</span>
                    </a>
                )}
            </div>
            {events.length > 0 && (
                <ol className="mt-4 space-y-2 border-t border-graphite-700 pt-3 text-sm">
                    {events.map((e, i) => (
                        <li key={`${e.occurredAt}-${i}`} className="flex justify-between gap-3">
                            <span className="text-fg">
                                {e.message}
                                {e.location && <span className="text-fg-subtle"> · {e.location}</span>}
                            </span>
                            <span className="shrink-0 font-mono text-[11px] text-fg-subtle">{dateTime(e.occurredAt)}</span>
                        </li>
                    ))}
                </ol>
            )}
        </section>
    );
}
