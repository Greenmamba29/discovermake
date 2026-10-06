import type { TrackingStep } from '@/contracts';
import { TRACKING_STEP_LABELS } from '@/lib/status';
import { dateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

/** 6-segment Uber-style stepper: Design locked → Materials → Production → QA → Shipping → Delivered. */
export function TrackingStepper({ steps }: { steps: TrackingStep[] }) {
    return (
        <ol className="grid grid-cols-6 gap-1.5" aria-label="Order progress" data-testid="order-stepper">
            {steps.map((s) => {
                const label = TRACKING_STEP_LABELS[s.key] ?? s.label;
                return (
                    <li key={s.key} className="min-w-0" aria-current={s.state === 'current' ? 'step' : undefined} data-state={s.state}>
                        <div
                            className={cn(
                                'h-1.5 rounded-full',
                                s.state === 'done' && 'bg-signal',
                                s.state === 'current' && 'bg-signal/60 motion-safe:animate-pulse',
                                s.state === 'upcoming' && 'bg-graphite-700',
                                s.state === 'failed' && 'bg-ember',
                            )}
                            aria-hidden
                        />
                        <p className={cn('mt-2 text-[10px] font-medium leading-tight sm:text-xs', s.state === 'upcoming' ? 'text-fg-subtle' : 'text-fg', s.state === 'failed' && 'text-ember')}>{label}</p>
                        {s.at && <p className="mt-0.5 hidden font-mono text-[10px] text-fg-subtle sm:block">{dateTime(s.at)}</p>}
                        <span className="sr-only">
                            {s.state === 'done' ? 'completed' : s.state === 'current' ? 'in progress' : s.state === 'failed' ? 'needs attention' : 'not started'}
                        </span>
                    </li>
                );
            })}
        </ol>
    );
}
