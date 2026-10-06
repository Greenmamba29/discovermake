'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * ⓘ explainer (DoorDash fee rule). Opens on hover, focus or tap; Escape closes.
 * The text is always in the accessibility tree via aria-describedby.
 */
export function InfoTip({ label, text, className, surface = 'graphite' }: { label: string; text: string; className?: string; surface?: 'graphite' | 'paper' }) {
    const [open, setOpen] = useState(false);
    const id = useId();
    const ref = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
        const onDown = (e: PointerEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('keydown', onKey);
        document.addEventListener('pointerdown', onDown);
        return () => {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('pointerdown', onDown);
        };
    }, [open]);

    return (
        <span ref={ref} className={cn('relative inline-flex', className)} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
            <button
                type="button"
                aria-label={`About ${label}`}
                aria-describedby={id}
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                onFocus={() => setOpen(true)}
                onBlur={() => setOpen(false)}
                className={cn(
                    'inline-flex h-6 w-6 items-center justify-center rounded-full',
                    surface === 'paper' ? 'text-ink-subtle hover:text-ink' : 'text-fg-subtle hover:text-fg',
                )}
            >
                <Info className="h-3.5 w-3.5" aria-hidden />
            </button>
            <span
                id={id}
                role="tooltip"
                className={cn(
                    'pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 w-60 -translate-x-1/2 rounded-lg px-3 py-2 text-xs leading-relaxed shadow-xl transition-opacity',
                    surface === 'paper' ? 'bg-ink text-paper' : 'bg-graphite-700 text-fg ring-1 ring-graphite-600',
                    open ? 'opacity-100' : 'sr-only opacity-0',
                )}
            >
                {text}
            </span>
        </span>
    );
}
