import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/** DoorDash-style option group: "Required · Select 1" / "Optional · Up to N", with a done check. */
export function OptionGroup({
    title,
    rule,
    required,
    satisfied,
    children,
    id,
}: {
    title: string;
    rule: string;
    required: boolean;
    satisfied: boolean;
    children: ReactNode;
    id: string;
}) {
    return (
        <fieldset className="border-t border-graphite-700 py-5 first:border-t-0 first:pt-0" aria-describedby={`${id}-rule`}>
            <legend className="sr-only">{title}</legend>
            <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                    <p className="font-display text-lg font-bold text-fg" aria-hidden>
                        {title}
                    </p>
                    <p id={`${id}-rule`} className="text-xs text-fg-subtle">
                        {rule}
                    </p>
                </div>
                {required ? (
                    satisfied ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-signal/15 px-2.5 py-1 text-[11px] font-semibold text-signal">
                            <Check className="h-3 w-3" aria-hidden /> Done
                        </span>
                    ) : (
                        <span className="rounded-full bg-graphite-700 px-2.5 py-1 text-[11px] font-semibold text-fg">Required</span>
                    )
                ) : (
                    <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold text-fg-subtle ring-1 ring-graphite-600">Optional</span>
                )}
            </div>
            {children}
        </fieldset>
    );
}

/** Radio/checkbox row with a leading visual, title, detail and trailing meta. */
export function OptionRow({
    type,
    name,
    checked,
    disabled,
    onChange,
    leading,
    title,
    detail,
    meta,
    testId,
    value,
}: {
    type: 'radio' | 'checkbox';
    name: string;
    value: string;
    checked: boolean;
    disabled?: boolean;
    onChange: () => void;
    leading?: ReactNode;
    title: ReactNode;
    detail?: ReactNode;
    meta?: ReactNode;
    testId?: string;
}) {
    return (
        <label
            className={cn(
                'flex min-h-[56px] cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 ring-1 ring-inset transition-colors',
                checked ? 'bg-graphite-800 ring-signal' : 'ring-graphite-700 hover:bg-graphite-850 hover:ring-graphite-600',
                disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent',
                'focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-signal',
            )}
            data-testid={testId}
            data-checked={checked || undefined}
        >
            <input type={type} name={name} value={value} checked={checked} disabled={disabled} onChange={onChange} className="sr-only" />
            {leading}
            <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium text-fg">{title}</span>
                {detail && <span className="block text-xs text-fg-muted">{detail}</span>}
            </span>
            {meta && <span className="shrink-0 text-right text-xs text-fg-muted">{meta}</span>}
            <span
                className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center ring-2 ring-inset',
                    type === 'radio' ? 'rounded-full' : 'rounded-md',
                    checked ? 'bg-signal ring-signal' : 'ring-graphite-500',
                )}
                aria-hidden
            >
                {checked && (type === 'radio' ? <span className="h-2 w-2 rounded-full bg-signal-ink" /> : <Check className="h-3.5 w-3.5 text-signal-ink" strokeWidth={3} />)}
            </span>
        </label>
    );
}
