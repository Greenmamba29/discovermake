'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * ⓘ explainer (DoorDash fee rule). Opens on hover, focus or tap; Escape closes.
 * The text is always in the accessibility tree via aria-describedby.
 * When open near a screen edge, the bubble shifts back inside the viewport (16px gutter)
 * so it never causes horizontal scrolling on phones.
 */
export function InfoTip({ label, text, className, surface = 'graphite' }: { label: string; text: string; className?: string; surface?: 'graphite' | 'paper' }) {
    const [open, setOpen] = useState(false);
    const id = useId();
    const ref = useRef<HTMLSpanElement>(null);
    const tipRef = useRef<HTMLSpanElement>(null);
    const [shift, setShift] = useState(0);

    useLayoutEffect(() => {
        if (!open) {
            setShift(0);
            return;
        }
        const tip = tipRef.current;
        if (!tip) return;
        const gutter = 16;
        const rect = tip.getBoundingClientRect();
        const unshiftedLeft = rect.left - shift;
        const unshiftedRight = rect.right - shift;
        const maxRight = document.documentElement.clientWidth - gutter;
        if (unshiftedRight > maxRight) setShift(maxRight - unshiftedRight);
        else if (unshiftedLeft < gutter) setShift(gutter - unshiftedLeft);
        else setShift(0);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- measure once per open
    }, [open]);

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
                ref={tipRef}
                id={id}
                role="tooltip"
                style={open ? { transform: `translateX(calc(-50% + ${shift}px))` } : undefined}
                className={cn(
                    surface === 'paper' ? 'bg-ink text-paper' : 'bg-graphite-700 text-fg ring-1 ring-graphite-600',
                    // Sized only while open: a closed bubble must stay sr-only (1px), or its width
                    // still counts towards the page width and causes horizontal scroll near edges.
                    open
                        ? 'pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 w-60 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-lg px-3 py-2 text-xs leading-relaxed opacity-100 shadow-xl'
                        : 'sr-only',
                )}
            >
                {text}
            </span>
        </span>
    );
}
