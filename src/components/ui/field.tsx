'use client';

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const control =
    'w-full rounded-xl bg-graphite-850 px-3.5 text-[15px] text-fg ring-1 ring-inset ring-graphite-600 placeholder:text-fg-subtle transition-shadow hover:ring-graphite-500 focus:outline-none focus:ring-2 focus:ring-signal aria-[invalid=true]:ring-ember disabled:opacity-60';

type FieldShellProps = {
    label: string;
    hint?: ReactNode;
    error?: string | null;
    optional?: boolean;
    className?: string;
    children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
};

/** Label + control + hint/error wiring (aria-describedby, aria-invalid). */
export function Field({ label, hint, error, optional, className, children }: FieldShellProps) {
    const id = useId();
    const hintId = hint ? `${id}-hint` : undefined;
    const errId = error ? `${id}-err` : undefined;
    const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined;
    return (
        <div className={cn('flex flex-col gap-1.5', className)}>
            <label htmlFor={id} className="text-sm font-medium text-fg">
                {label}
                {optional && <span className="ml-1.5 text-xs font-normal text-fg-subtle">Optional</span>}
            </label>
            {children({ id, describedBy, invalid: Boolean(error) })}
            {hint && !error && (
                <p id={hintId} className="text-xs text-fg-subtle">
                    {hint}
                </p>
            )}
            {error && (
                <p id={errId} role="alert" className="text-xs font-medium text-ember">
                    {error}
                </p>
            )}
        </div>
    );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput({ className, ...rest }, ref) {
    return <input ref={ref} className={cn(control, 'h-11', className)} {...rest} />;
});

export const SelectInput = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function SelectInput({ className, children, ...rest }, ref) {
    return (
        <select ref={ref} className={cn(control, 'h-11 appearance-none bg-[length:16px] bg-[right_12px_center] bg-no-repeat pr-9', className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23a9afab' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }} {...rest}>
            {children}
        </select>
    );
});

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={cn(control, 'min-h-[88px] py-2.5', className)} {...rest} />;
});
