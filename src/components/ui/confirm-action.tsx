'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, type ButtonProps } from './button';
import { cn } from '@/lib/utils';

/**
 * Two-step action with the confirmation built into the page (never window.confirm).
 * First click reveals a confirm row; Escape or Cancel backs out.
 */
export function ConfirmAction({
    label,
    confirmLabel,
    prompt,
    onConfirm,
    variant = 'primary',
    size = 'md',
    disabled,
    loading,
    testId,
    className,
    icon,
}: {
    label: ReactNode;
    confirmLabel: string;
    prompt: ReactNode;
    onConfirm: () => void | Promise<void>;
    variant?: ButtonProps['variant'];
    size?: ButtonProps['size'];
    disabled?: boolean;
    loading?: boolean;
    testId?: string;
    className?: string;
    icon?: ReactNode;
}) {
    const [armed, setArmed] = useState(false);
    const confirmRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (armed) confirmRef.current?.focus();
    }, [armed]);

    if (!armed) {
        return (
            <Button variant={variant} size={size} disabled={disabled} loading={loading} onClick={() => setArmed(true)} data-testid={testId} className={className}>
                {icon}
                {label}
            </Button>
        );
    }
    return (
        <div
            className={cn('flex flex-col gap-2 rounded-xl bg-graphite-800 p-3 ring-1 ring-inset ring-graphite-600 sm:flex-row sm:items-center', className)}
            onKeyDown={(e) => e.key === 'Escape' && setArmed(false)}
            role="group"
            aria-label="Confirm action"
        >
            <p className="flex-1 text-sm text-fg">{prompt}</p>
            <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setArmed(false)} disabled={loading}>
                    Cancel
                </Button>
                <Button
                    ref={confirmRef}
                    variant={variant === 'secondary' || variant === 'ghost' ? 'primary' : variant}
                    size="sm"
                    loading={loading}
                    data-testid={testId ? `${testId}-confirm` : undefined}
                    onClick={async () => {
                        await onConfirm();
                        setArmed(false);
                    }}
                >
                    {confirmLabel}
                </Button>
            </div>
        </div>
    );
}
