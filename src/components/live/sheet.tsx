'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

/**
 * Bottom sheet on phones, centered dialog on larger screens (native <dialog>, so focus,
 * Escape and the backdrop come from the platform). Opening it never unmounts the stream:
 * the video keeps playing behind it.
 */
export function Sheet({ open, onClose, title, children, testId, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; testId?: string; wide?: boolean }) {
    const ref = useRef<HTMLDialogElement>(null);
    const titleId = useId();
    useEffect(() => {
        const d = ref.current;
        if (!d) return;
        if (open && !d.open) d.showModal();
        if (!open && d.open) d.close();
    }, [open]);
    return (
        <dialog
            ref={ref}
            onClose={onClose}
            aria-labelledby={titleId}
            data-testid={testId}
            className={`mb-0 mt-auto max-h-[88svh] w-full max-w-none overflow-y-auto rounded-t-2xl bg-graphite-900 p-0 text-fg ring-1 ring-graphite-700 backdrop:bg-black/60 sm:m-auto sm:rounded-2xl ${wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'}`}
        >
            {open && (
                <div className="p-4 sm:p-6">
                    <div className="mb-4 flex items-start justify-between gap-3">
                        <h2 id={titleId} className="font-display text-xl font-bold">
                            {title}
                        </h2>
                        <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-fg-muted hover:bg-graphite-800 hover:text-fg" aria-label="Close">
                            <X className="h-5 w-5" aria-hidden />
                        </button>
                    </div>
                    {children}
                </div>
            )}
        </dialog>
    );
}
