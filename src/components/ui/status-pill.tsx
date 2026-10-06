import type { UniversalStatus } from '@/contracts';
import { cn } from '@/lib/utils';
import { UNIVERSAL_PILL, UNIVERSAL_PILL_PAPER } from '@/lib/status';

/** Status pill: renders ONLY the universal status vocabulary (spec §23). */
export function StatusPill({ status, surface = 'graphite', className }: { status: UniversalStatus; surface?: 'graphite' | 'paper'; className?: string }) {
    const s = UNIVERSAL_PILL[status];
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.08em]',
                surface === 'paper' ? UNIVERSAL_PILL_PAPER[status] : s.className,
                className,
            )}
            data-status={status}
        >
            <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} aria-hidden />
            {status.replace('_', ' ')}
        </span>
    );
}
