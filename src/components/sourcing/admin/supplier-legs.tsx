'use client';

import { useState } from 'react';
import type { SupplierLegOpsView, SupplierLegStatus } from '@/contracts';
import { ConfirmAction } from '@/components/ui/confirm-action';
import { Field, TextInput } from '@/components/ui/field';
import { Notice } from '@/components/ui/state';
import { errorMessage } from '@/lib/api';
import { dateTime, money } from '@/lib/format';
import { primeApi } from '@/lib/prime-api';

const NEXT_LABEL: Partial<Record<SupplierLegStatus, string>> = {
    IN_PRODUCTION_AT_SUPPLIER: 'Supplier started production',
    SHIPPED_INBOUND: 'Shipped inbound',
    DELIVERED: 'Delivered (direct ship)',
};

/** Ops: one supplier fulfilment leg (PO) with the supplier-side updates ops may record. */
function LegCard({ token, leg, onChanged }: { token: string; leg: SupplierLegOpsView; onChanged: () => Promise<unknown> }) {
    const [carrier, setCarrier] = useState(leg.inboundCarrier ?? '');
    const [tracking, setTracking] = useState(leg.inboundTracking ?? '');
    const [error, setError] = useState<string | null>(null);
    const advance = async (to: SupplierLegStatus) => {
        setError(null);
        try {
            await primeApi.advanceLeg(token, leg.id, {
                to,
                ...(to === 'SHIPPED_INBOUND' ? { inboundCarrier: carrier.trim(), inboundTracking: tracking.trim(), ...(leg.directShip ? { preShipmentInspection: 'PASS' as const } : {}) } : {}),
            });
            await onChanged();
        } catch (err) {
            setError(errorMessage(err));
        }
    };
    return (
        <article className="space-y-3 rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700" data-testid={`leg-${leg.id}`} aria-labelledby={`leg-${leg.id}-title`}>
            <div className="flex flex-wrap items-center gap-2">
                <h3 id={`leg-${leg.id}-title`} className="font-mono font-semibold">
                    {leg.poNumber}
                </h3>
                <span className="rounded-md bg-graphite-750 px-2 py-0.5 font-mono text-[11px] text-fg" data-testid="leg-status">
                    {leg.status}
                </span>
                <span className="text-xs text-fg-muted">order {leg.orderNumber}</span>
                {leg.directShip && <span className="rounded-md bg-amber/15 px-2 py-0.5 text-[11px] text-amber">direct ship</span>}
            </div>
            <dl className="grid gap-x-4 gap-y-1 text-xs text-fg-muted sm:grid-cols-2">
                <div>
                    <dt className="inline text-fg-subtle">Supplier </dt>
                    <dd className="inline">
                        {leg.supplier.name} ({leg.supplier.country}) · {leg.incoterm}
                    </dd>
                </div>
                <div>
                    <dt className="inline text-fg-subtle">Supplier deposit </dt>
                    <dd className="inline">
                        {money(leg.supplierDeposit.amountCents)} · {leg.supplierDeposit.status.toLowerCase()}
                    </dd>
                </div>
                <div>
                    <dt className="inline text-fg-subtle">Receiving </dt>
                    <dd className="inline">{leg.receivingShop ? leg.receivingShop.name : 'none (direct ship)'}</dd>
                </div>
                <div>
                    <dt className="inline text-fg-subtle">Inbound </dt>
                    <dd className="inline">{leg.inboundTracking ? `${leg.inboundCarrier} · ${leg.inboundTracking}` : '—'}</dd>
                </div>
            </dl>
            <ol className="space-y-0.5 text-xs text-fg-muted">
                {leg.history.map((h, i) => (
                    <li key={`${h.status}-${i}`}>
                        <span className="font-mono text-fg-subtle">{dateTime(h.at)}</span> {h.status}
                        {h.note ? ` · ${h.note}` : ''}
                    </li>
                ))}
            </ol>
            {leg.allowedNext.includes('SHIPPED_INBOUND') && (
                <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Inbound carrier">{({ id }) => <TextInput id={id} value={carrier} maxLength={80} onChange={(e) => setCarrier(e.target.value)} data-testid="leg-carrier" />}</Field>
                    <Field label="Inbound tracking">{({ id }) => <TextInput id={id} value={tracking} maxLength={120} onChange={(e) => setTracking(e.target.value)} data-testid="leg-tracking" />}</Field>
                </div>
            )}
            {leg.allowedNext.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {leg.allowedNext.map((to) => (
                        <ConfirmAction key={to} label={NEXT_LABEL[to] ?? to} confirmLabel="Record" prompt={`Record "${NEXT_LABEL[to] ?? to}" for ${leg.poNumber}?`} size="sm" variant="secondary" onConfirm={() => advance(to)} testId={`leg-advance-${to}`} />
                    ))}
                </div>
            )}
            {error && <Notice tone="error">{error}</Notice>}
        </article>
    );
}

export function SupplierLegsPanel({ token, legs, onChanged }: { token: string; legs: SupplierLegOpsView[]; onChanged: () => Promise<unknown> }) {
    if (!legs.length) return <p className="text-sm text-fg-muted">No purchase orders yet. A leg appears when ops approves a buyer&apos;s purchase order.</p>;
    return (
        <ul className="space-y-3">
            {legs.map((leg) => (
                <li key={leg.id}>
                    <LegCard token={token} leg={leg} onChanged={onChanged} />
                </li>
            ))}
        </ul>
    );
}
