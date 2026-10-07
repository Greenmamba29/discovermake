'use client';

import { Minus, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/** Bounded quantity stepper with a typeable value. */
export function QtyStepper({
    value,
    onChange,
    min = 1,
    max = 5000,
    label = 'Quantity',
    testId = 'qty-stepper',
    size = 'md',
}: {
    value: number;
    onChange: (n: number) => void;
    min?: number;
    max?: number;
    label?: string;
    testId?: string;
    size?: 'sm' | 'md';
}) {
    const [draft, setDraft] = useState(String(value));
    useEffect(() => setDraft(String(value)), [value]);
    const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n)));
    const commit = () => {
        const n = Number(draft);
        if (Number.isFinite(n) && n >= 1) onChange(clamp(n));
        else setDraft(String(value));
    };
    const btn = cn(
        'flex items-center justify-center rounded-lg text-fg transition-colors hover:bg-graphite-700 disabled:text-fg-subtle disabled:hover:bg-transparent',
        size === 'sm' ? 'h-8 w-8' : 'h-10 w-10',
    );
    return (
        <div className="inline-flex items-center gap-1 rounded-xl bg-graphite-850 p-1 ring-1 ring-inset ring-graphite-600" data-testid={testId} role="group" aria-label={label}>
            <button type="button" className={btn} onClick={() => onChange(clamp(value - 1))} disabled={value <= min} aria-label={`Decrease ${label.toLowerCase()}`} data-testid={`${testId}-dec`}>
                <Minus className="h-4 w-4" aria-hidden />
            </button>
            <input
                type="number"
                inputMode="numeric"
                min={min}
                max={max}
                value={draft}
                aria-label={label}
                data-testid={`${testId}-input`}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        commit();
                    }
                }}
                className={cn('tabular bg-transparent text-center font-mono font-semibold text-fg focus:outline-none', size === 'sm' ? 'w-12 text-sm' : 'w-16 text-base')}
            />
            <button type="button" className={btn} onClick={() => onChange(clamp(value + 1))} disabled={value >= max} aria-label={`Increase ${label.toLowerCase()}`} data-testid={`${testId}-inc`}>
                <Plus className="h-4 w-4" aria-hidden />
            </button>
        </div>
    );
}
