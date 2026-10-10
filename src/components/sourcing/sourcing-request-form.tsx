'use client';

import { useState, type FormEvent } from 'react';
import { Search } from 'lucide-react';
import { CreateSourcingRequest } from '@/contracts';
import { Button } from '@/components/ui/button';
import { Field, TextArea, TextInput } from '@/components/ui/field';
import { Notice } from '@/components/ui/state';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { sourcingApi } from './api';
import { dollarsToCents, todayIso } from './money-input';
import { SOURCING_REGIONS } from './regions';

type Errors = Partial<Record<'quantity' | 'targetUnitCost' | 'targetDeliveryDate' | 'notes', string>>;

/** "Find manufacturing partners": the buyer's sourcing request (POST /api/builds/:buildId/sourcing). */
export function SourcingRequestForm({
    buildId,
    partId,
    defaultQuantity,
    onCreated,
    onCancel,
}: {
    buildId: string;
    partId?: string;
    defaultQuantity?: number;
    onCreated: () => void;
    onCancel?: () => void;
}) {
    const [quantity, setQuantity] = useState(String(defaultQuantity ?? 100));
    const [targetUnit, setTargetUnit] = useState('');
    const [date, setDate] = useState('');
    const [regions, setRegions] = useState<string[]>([]);
    const [notes, setNotes] = useState('');
    const [errors, setErrors] = useState<Errors>({});
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const toggleRegion = (code: string) => setRegions((r) => (r.includes(code) ? r.filter((c) => c !== code) : [...r, code]));

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        const next: Errors = {};
        const qty = Number(quantity);
        if (!Number.isInteger(qty) || qty < 1 || qty > 1_000_000) next.quantity = 'Enter a whole number between 1 and 1,000,000.';
        const cents = dollarsToCents(targetUnit);
        if (cents !== null && (!Number.isFinite(cents) || cents <= 0)) next.targetUnitCost = 'Enter a price like 4.50, or leave it empty.';
        if (date && date < todayIso()) next.targetDeliveryDate = 'Pick a date in the future.';
        if (notes.length > 2000) next.notes = 'Keep notes under 2,000 characters.';
        setErrors(next);
        if (Object.keys(next).length) return;

        const body = {
            ...(partId ? { partId } : {}),
            quantity: qty,
            ...(cents ? { targetUnitCostCents: cents } : {}),
            ...(date ? { targetDeliveryDate: date } : {}),
            ...(regions.length ? { targetRegions: regions } : {}),
            ...(notes.trim() ? { notes: notes.trim() } : {}),
        };
        const parsed = CreateSourcingRequest.safeParse(body);
        if (!parsed.success) {
            setSubmitError('Some details need another look.');
            return;
        }
        setBusy(true);
        setSubmitError(null);
        try {
            await sourcingApi.requestSourcing(buildId, parsed.data);
            onCreated();
        } catch (err) {
            setSubmitError(errorMessage(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <form onSubmit={submit} noValidate className="space-y-4" data-testid="sourcing-request-form" aria-labelledby="sourcing-form-heading">
            <div>
                <h3 id="sourcing-form-heading" className="font-display text-lg font-bold">
                    Find manufacturing partners
                </h3>
                <p className="mt-1 text-sm text-fg-muted">
                    We ask vetted partners to quote your build and show every offer here with its trust level. Nothing is ordered or charged.
                </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Quantity" error={errors.quantity}>
                    {({ id, describedBy, invalid }) => (
                        <TextInput
                            id={id}
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={1_000_000}
                            value={quantity}
                            onChange={(e) => setQuantity(e.target.value)}
                            aria-describedby={describedBy}
                            aria-invalid={invalid}
                            className="font-mono tabular"
                            data-testid="sourcing-quantity"
                        />
                    )}
                </Field>
                <Field label="Target price per part (USD)" optional error={errors.targetUnitCost} hint="Helps partners know your budget.">
                    {({ id, describedBy, invalid }) => (
                        <TextInput
                            id={id}
                            inputMode="decimal"
                            placeholder="4.50"
                            value={targetUnit}
                            onChange={(e) => setTargetUnit(e.target.value)}
                            aria-describedby={describedBy}
                            aria-invalid={invalid}
                            className="font-mono tabular"
                            data-testid="sourcing-target-price"
                        />
                    )}
                </Field>
                <Field label="Needed by" optional error={errors.targetDeliveryDate}>
                    {({ id, describedBy, invalid }) => (
                        <TextInput
                            id={id}
                            type="date"
                            min={todayIso()}
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            aria-describedby={describedBy}
                            aria-invalid={invalid}
                            data-testid="sourcing-date"
                        />
                    )}
                </Field>
            </div>
            <fieldset>
                <legend className="text-sm font-medium text-fg">
                    Where it can be made <span className="ml-1.5 text-xs font-normal text-fg-subtle">Optional · leave empty for anywhere</span>
                </legend>
                <div className="mt-2 flex flex-wrap gap-2">
                    {SOURCING_REGIONS.map((r) => {
                        const on = regions.includes(r.code);
                        return (
                            <button
                                key={r.code}
                                type="button"
                                aria-pressed={on}
                                onClick={() => toggleRegion(r.code)}
                                className={cn(
                                    'h-9 rounded-full px-3 text-sm font-medium ring-1 ring-inset transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-signal',
                                    on ? 'bg-signal/15 text-signal ring-signal/50' : 'bg-graphite-850 text-fg-muted ring-graphite-600 hover:text-fg',
                                )}
                                data-testid={`sourcing-region-${r.code}`}
                            >
                                {r.label}
                            </button>
                        );
                    })}
                </div>
            </fieldset>
            <Field label="Notes for partners" optional error={errors.notes} hint="Finish, packaging, certifications or anything else that matters.">
                {({ id, describedBy, invalid }) => (
                    <TextArea id={id} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} aria-describedby={describedBy} aria-invalid={invalid} data-testid="sourcing-notes" />
                )}
            </Field>
            {submitError && <Notice tone="error">{submitError}</Notice>}
            <div className="flex flex-wrap gap-2">
                <Button type="submit" loading={busy} data-testid="sourcing-submit">
                    <Search className="h-4 w-4" aria-hidden /> Find manufacturing partners
                </Button>
                {onCancel && (
                    <Button variant="ghost" onClick={onCancel} disabled={busy}>
                        Cancel
                    </Button>
                )}
            </div>
        </form>
    );
}
