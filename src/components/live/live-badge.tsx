import type { ShowStatus } from '@/contracts/live';
import { cn } from '@/lib/utils';

function compact(n: number): string {
    return n >= 10_000 ? `${(n / 1000).toFixed(0)}K` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

/** ● LIVE · 12.4K (red is reserved for LIVE only, workflow 10). Dark text on red for contrast. */
export function LiveBadge({ status, viewerCount, className }: { status: ShowStatus; viewerCount?: number; className?: string }) {
    if (status === 'LIVE') {
        return (
            <span className={cn('inline-flex items-center gap-1.5 rounded-md bg-live px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-graphite-950', className)} data-testid="live-badge">
                <span className="h-1.5 w-1.5 rounded-full bg-graphite-950 motion-safe:animate-pulse" aria-hidden />
                Live
                {viewerCount !== undefined && (
                    <span className="font-mono font-bold normal-case tabular" aria-label={`${viewerCount} watching`}>
                        · {compact(viewerCount)}
                    </span>
                )}
            </span>
        );
    }
    const label = status === 'SCHEDULED' ? 'Upcoming' : status === 'ENDED' ? 'Replay' : 'Cancelled';
    return (
        <span className={cn('inline-flex items-center rounded-md bg-graphite-800 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-fg ring-1 ring-inset ring-graphite-600', className)} data-testid="live-badge">
            {label}
        </span>
    );
}
