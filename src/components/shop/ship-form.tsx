'use client';

import { useState } from 'react';
import { Package, Tag } from 'lucide-react';
import { CreateShipmentRequest, type JobPacket, type ShipmentView } from '@/contracts';
import { Field, TextInput } from '@/components/ui/field';
import { ConfirmAction } from '@/components/ui/confirm-action';
import { Notice } from '@/components/ui/state';
import { api, ApiClientError, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

type Mode = 'label' | 'manual';

/** Ship form: buy a label through DiscoverMake (CARRIER=easypost) or enter a label bought elsewhere (CARRIER=manual). */
export function ShipForm({ jobId, packet, onShipped }: { jobId: string; packet: JobPacket; onShipped: (s: ShipmentView) => void }) {
    const longIn = Math.max(packet.part.bboxWidthMm, packet.part.bboxHeightMm) / 25.4;
    const shortIn = Math.min(packet.part.bboxWidthMm, packet.part.bboxHeightMm) / 25.4;
    const [mode, setMode] = useState<Mode>('label');
    const [parcel, setParcel] = useState({ lengthIn: String(Math.ceil(longIn + 2)), widthIn: String(Math.ceil(shortIn + 2)), heightIn: '2', weightOz: '16' });
    const [manual, setManual] = useState({ carrier: '', service: '', trackingNumber: '', trackingUrl: '' });
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const submit = async () => {
        const body = {
            parcel: { lengthIn: Number(parcel.lengthIn), widthIn: Number(parcel.widthIn), heightIn: Number(parcel.heightIn), weightOz: Number(parcel.weightOz) },
            ...(mode === 'manual'
                ? { manual: { carrier: manual.carrier, service: manual.service, trackingNumber: manual.trackingNumber, ...(manual.trackingUrl.trim() ? { trackingUrl: manual.trackingUrl.trim() } : {}) } }
                : {}),
        };
        const parsed = CreateShipmentRequest.safeParse(body);
        if (!parsed.success) {
            const first = parsed.error.issues[0];
            const field = first?.path.join(' ') ?? '';
            setError(/parcel/.test(field) ? 'Enter positive package dimensions (inches) and weight (ounces).' : /trackingUrl/.test(field) ? 'The tracking link must be a full URL starting with https://' : 'Enter the carrier, service and a tracking number (6+ characters).');
            return;
        }
        setBusy(true);
        setError(null);
        try {
            onShipped(await api.createShipment(jobId, parsed.data));
        } catch (err) {
            const msg = errorMessage(err);
            // The server knows which carrier adapter is configured; follow its lead.
            if (err instanceof ApiClientError && err.status === 400 && /CARRIER=manual/.test(msg)) setMode('manual');
            if (err instanceof ApiClientError && err.status === 400 && /CARRIER=easypost/.test(msg)) setMode('label');
            setError(msg);
        } finally {
            setBusy(false);
        }
    };

    const num = (k: keyof typeof parcel, label: string, unit: string) => (
        <Field label={`${label} (${unit})`}>
            {({ id }) => (
                <TextInput id={id} type="number" inputMode="decimal" min="0.1" step="0.1" className="font-mono" value={parcel[k]} onChange={(e) => setParcel((p) => ({ ...p, [k]: e.target.value }))} data-testid={`ship-${k}`} />
            )}
        </Field>
    );

    return (
        <section aria-labelledby="ship-heading" className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700 sm:p-5" data-testid="ship-form">
            <h2 id="ship-heading" className="font-display text-lg font-bold">
                Ship the order
            </h2>
            <p className="mt-1 text-sm text-fg-muted">
                Inspection passed. Pack per the instructions, then create the shipment. Buyer paid for <span className="font-semibold text-fg">{packet.packing.shippingMethod.toLowerCase()}</span> shipping.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Label source">
                {(
                    [
                        { key: 'label', icon: Tag, title: 'Buy label', body: 'DiscoverMake buys the label' },
                        { key: 'manual', icon: Package, title: 'I have a label', body: 'Enter carrier tracking' },
                    ] as const
                ).map((o) => (
                    <button
                        key={o.key}
                        type="button"
                        role="radio"
                        aria-checked={mode === o.key}
                        onClick={() => setMode(o.key)}
                        className={cn('flex flex-col items-start rounded-xl p-3 text-left ring-1 ring-inset', mode === o.key ? 'bg-graphite-800 ring-signal' : 'ring-graphite-700 hover:bg-graphite-850')}
                        data-testid={`ship-mode-${o.key}`}
                    >
                        <o.icon className="h-4 w-4 text-fg-muted" aria-hidden />
                        <span className="mt-1 text-sm font-semibold text-fg">{o.title}</span>
                        <span className="text-xs text-fg-subtle">{o.body}</span>
                    </button>
                ))}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {num('lengthIn', 'Length', 'in')}
                {num('widthIn', 'Width', 'in')}
                {num('heightIn', 'Height', 'in')}
                {num('weightOz', 'Weight', 'oz')}
            </div>
            {mode === 'manual' && (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <Field label="Carrier">
                        {({ id }) => <TextInput id={id} placeholder="UPS" value={manual.carrier} onChange={(e) => setManual((m) => ({ ...m, carrier: e.target.value }))} data-testid="ship-carrier" />}
                    </Field>
                    <Field label="Service">
                        {({ id }) => <TextInput id={id} placeholder="Ground" value={manual.service} onChange={(e) => setManual((m) => ({ ...m, service: e.target.value }))} data-testid="ship-service" />}
                    </Field>
                    <Field label="Tracking number">
                        {({ id }) => <TextInput id={id} className="font-mono" value={manual.trackingNumber} onChange={(e) => setManual((m) => ({ ...m, trackingNumber: e.target.value }))} data-testid="ship-tracking" />}
                    </Field>
                    <Field label="Tracking link" optional>
                        {({ id }) => <TextInput id={id} type="url" placeholder="https://" value={manual.trackingUrl} onChange={(e) => setManual((m) => ({ ...m, trackingUrl: e.target.value }))} data-testid="ship-tracking-url" />}
                    </Field>
                </div>
            )}
            {error && (
                <Notice tone="error" className="mt-4" title="Shipment not created" testId="ship-error">
                    {error}
                </Notice>
            )}
            <div className="mt-5">
                <ConfirmAction
                    label={mode === 'label' ? 'Buy label and ship' : 'Mark as shipped'}
                    confirmLabel="Confirm shipment"
                    prompt="The buyer is notified with tracking right away. Make sure the parts are packed."
                    onConfirm={submit}
                    loading={busy}
                    testId="ship-submit"
                    className="w-full sm:w-auto"
                />
            </div>
        </section>
    );
}
