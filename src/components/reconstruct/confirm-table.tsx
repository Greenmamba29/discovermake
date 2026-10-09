'use client';

/**
 * Caliper confirmation (the hard rule): one row per critical dimension. A photo estimate may
 * prefill the field, but the row stays UNCONFIRMED until the buyer types a caliper or ruler
 * reading (mm or in, 0.01 mm) and presses Confirm. The delta to the estimate is shown, with a
 * warning above 10%.
 */
import { useState } from 'react';
import { AlertTriangle, BadgeCheck, CircleDashed } from 'lucide-react';
import { DELTA_WARN_PCT, type DimensionView, type LengthUnit } from '@/contracts/reconstruct';
import { Button } from '@/components/ui/button';
import { SelectInput, TextInput } from '@/components/ui/field';
import { dateTime } from '@/lib/format';
import { deltaPct, deltaWarning, fromMm, parseReading } from '@/lib/reconstruct/measure';
import { cn } from '@/lib/utils';

export type ConfirmTableProps = {
    rows: DimensionView[];
    onConfirm: (param: DimensionView['param'], value: number, unit: LengthUnit) => Promise<void>;
    disabled?: boolean;
};

function Row({ row, onConfirm, disabled }: { row: DimensionView; onConfirm: ConfirmTableProps['onConfirm']; disabled?: boolean }) {
    const [unit, setUnit] = useState<LengthUnit>(row.enteredUnit ?? 'mm');
    const [text, setText] = useState<string>(row.enteredValue !== null ? String(row.enteredValue) : '');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const parsed = text.trim() ? parseReading(text, unit) : null;
    const pendingMm = parsed?.mm ?? null;
    const confirmed = row.confirmedAt !== null;
    const changed = confirmed && pendingMm !== null && Math.abs(pendingMm - (row.caliperMm ?? 0)) > 0.005;
    const liveDelta = row.estimateMm !== null && pendingMm !== null ? deltaPct(row.estimateMm, pendingMm) : row.deltaPct;
    const warn = pendingMm !== null ? deltaWarning(row.estimateMm, pendingMm) : row.deltaWarning;
    const inputId = `cal-${row.param}`;

    const confirm = async () => {
        if (!parsed) {
            setError('Type the reading as a number, e.g. 38.10 or 1.5 in.');
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await onConfirm(row.param, parsed.value, parsed.unit);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save the reading.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <li className={cn('rounded-xl p-4 ring-1 ring-inset', confirmed && !changed ? 'bg-signal/5 ring-signal/40' : 'bg-graphite-900 ring-graphite-700')} data-testid={`dim-row-${row.param}`} data-confirmed={confirmed && !changed ? 'true' : 'false'}>
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                    <label htmlFor={inputId} className="font-semibold">
                        {row.label}
                    </label>
                    <p className="text-xs text-fg-subtle">{row.hint}</p>
                </div>
                {confirmed && !changed ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-signal/15 px-2.5 py-0.5 text-xs font-semibold text-signal" data-testid={`dim-status-${row.param}`}>
                        <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> Caliper confirmed
                    </span>
                ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber/15 px-2.5 py-0.5 text-xs font-semibold text-amber" data-testid={`dim-status-${row.param}`}>
                        <CircleDashed className="h-3.5 w-3.5" aria-hidden /> Not confirmed
                    </span>
                )}
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                <div>
                    <dt className="text-xs text-fg-muted">Estimate from photo</dt>
                    <dd className="font-mono" data-testid={`dim-estimate-${row.param}`}>
                        {row.estimateMm !== null ? `${row.estimateMm.toFixed(2)} mm${row.estimateUncertaintyMm !== null ? ` ± ${row.estimateUncertaintyMm.toFixed(1)}` : ''}` : '—'}
                    </dd>
                </div>
                <div>
                    <dt className="text-xs text-fg-muted">Caliper reading</dt>
                    <dd className="font-mono" data-testid={`dim-caliper-${row.param}`}>
                        {row.caliperMm !== null ? `${row.caliperMm.toFixed(2)} mm` : '—'}
                    </dd>
                </div>
                <div className="col-span-2 sm:col-span-1">
                    <dt className="text-xs text-fg-muted">Difference</dt>
                    <dd className={cn('font-mono', warn && 'font-semibold text-amber')} data-testid={`dim-delta-${row.param}`}>
                        {liveDelta !== null ? `${liveDelta.toFixed(1)}%` : '—'}
                    </dd>
                </div>
            </dl>
            {warn && (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-amber" role="status" data-testid={`dim-warning-${row.param}`}>
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> The photo estimate is more than {DELTA_WARN_PCT}% off this reading. Measure again to be sure; the caliper reading is what gets made.
                </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
                <TextInput
                    id={inputId}
                    className="h-10 w-32 font-mono"
                    inputMode="decimal"
                    placeholder={row.estimateMm !== null ? fromMm(row.estimateMm, unit).toString() : unit === 'mm' ? '0.00' : '0.000'}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') void confirm();
                    }}
                    disabled={disabled || busy}
                    aria-invalid={Boolean(error) || undefined}
                    aria-describedby={error ? `${inputId}-err` : undefined}
                    data-testid={`dim-input-${row.param}`}
                />
                <label htmlFor={`${inputId}-unit`} className="sr-only">
                    Unit for {row.label}
                </label>
                <SelectInput id={`${inputId}-unit`} className="h-10 w-24" value={unit} onChange={(e) => setUnit(e.target.value as LengthUnit)} disabled={disabled || busy} data-testid={`dim-unit-${row.param}`}>
                    <option value="mm">mm</option>
                    <option value="in">in</option>
                </SelectInput>
                {row.estimateMm !== null && !text && (
                    <Button size="sm" variant="ghost" onClick={() => setText(fromMm(row.estimateMm!, unit).toString())} disabled={disabled || busy} data-testid={`dim-prefill-${row.param}`}>
                        Use estimate as a start
                    </Button>
                )}
                <Button size="sm" onClick={confirm} loading={busy} disabled={disabled || !text.trim() || (confirmed && !changed && unit === row.enteredUnit)} data-testid={`dim-confirm-${row.param}`}>
                    {confirmed ? 'Update reading' : 'Confirm reading'}
                </Button>
                {parsed && unit === 'in' && <span className="font-mono text-xs text-fg-subtle">= {parsed.mm.toFixed(2)} mm</span>}
            </div>
            {error && (
                <p id={`${inputId}-err`} role="alert" className="mt-2 text-xs font-medium text-ember">
                    {error}
                </p>
            )}
            {confirmed && row.confirmedAt && (
                <p className="mt-2 text-[11px] text-fg-subtle">
                    Confirmed {dateTime(row.confirmedAt)} · typed {row.enteredValue} {row.enteredUnit}
                </p>
            )}
        </li>
    );
}

export function ConfirmTable({ rows, onConfirm, disabled }: ConfirmTableProps) {
    const done = rows.filter((r) => r.confirmedAt !== null).length;
    return (
        <section aria-labelledby="confirm-heading" data-testid="confirm-table">
            <div className="flex items-baseline justify-between gap-2">
                <h2 id="confirm-heading" className="font-display text-lg font-bold">
                    Caliper readings
                </h2>
                <span className="text-xs text-fg-muted" data-testid="confirm-progress">
                    {done} of {rows.length} confirmed
                </span>
            </div>
            <p className="mt-1 text-sm text-fg-muted">Every size below is made exactly as you confirm it. Photo estimates only help you start.</p>
            <ul className="mt-3 space-y-3">
                {rows.map((r) => (
                    <Row key={`${r.param}-${r.confirmedAt ?? 'open'}`} row={r} onConfirm={onConfirm} disabled={disabled} />
                ))}
            </ul>
        </section>
    );
}
