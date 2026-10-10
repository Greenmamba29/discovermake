import Link from 'next/link';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export const RECONSTRUCT_STEPS = [
    { key: 'capture', label: 'Photos' },
    { key: 'measure', label: 'Measure' },
    { key: 'confirm', label: 'Caliper' },
    { key: 'review', label: 'Review' },
] as const;
export type ReconstructStep = (typeof RECONSTRUCT_STEPS)[number]['key'];

/**
 * Guided steps (Mobbin: camera capture flows with a "Step 2 of 4" progress bar). Completed and
 * current steps link back when `hrefFor` is given; later steps are plain text.
 */
export function ReconstructStepper({ current, hrefFor, reachable = 0 }: { current: ReconstructStep; hrefFor?: (step: ReconstructStep) => string; reachable?: number }) {
    const index = RECONSTRUCT_STEPS.findIndex((s) => s.key === current);
    return (
        <nav aria-label="Reconstruct steps" className="mt-4" data-testid="reconstruct-stepper">
            <p className="text-xs font-semibold text-fg-muted" data-testid="reconstruct-step-label">
                Step {index + 1} of {RECONSTRUCT_STEPS.length}
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-graphite-800" role="progressbar" aria-label="Reconstruct progress" aria-valuemin={1} aria-valuemax={RECONSTRUCT_STEPS.length} aria-valuenow={index + 1}>
                <div className="h-full rounded-full bg-signal transition-all" style={{ width: `${((index + 1) / RECONSTRUCT_STEPS.length) * 100}%` }} />
            </div>
            <ol className="mt-3 grid grid-cols-4 gap-1 text-[11px] sm:text-xs">
                {RECONSTRUCT_STEPS.map((s, i) => {
                    const done = i < index;
                    const linkable = hrefFor && i <= Math.max(index, reachable) && s.key !== 'capture';
                    const inner = (
                        <span className={cn('flex items-center gap-1 truncate', i === index ? 'font-semibold text-fg' : done ? 'text-fg-muted' : 'text-fg-subtle')}>
                            <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px]', done ? 'bg-signal text-signal-ink' : i === index ? 'bg-fg text-graphite-950' : 'bg-graphite-700 text-fg-muted')} aria-hidden>
                                {done ? <Check className="h-3 w-3" /> : i + 1}
                            </span>
                            {s.label}
                        </span>
                    );
                    return (
                        <li key={s.key} aria-current={i === index ? 'step' : undefined}>
                            {linkable ? (
                                <Link href={hrefFor!(s.key)} className="rounded hover:underline">
                                    {inner}
                                </Link>
                            ) : (
                                inner
                            )}
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
}
