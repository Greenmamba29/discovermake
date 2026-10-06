import { cn } from '@/lib/utils';

export function Skeleton({ className }: { className?: string }) {
    return <div className={cn('skeleton', className)} aria-hidden />;
}

/** Generic page skeleton with an accessible loading label. */
export function PageSkeleton({ label = 'Loading' }: { label?: string }) {
    return (
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6" role="status" aria-live="polite">
            <span className="sr-only">{label}…</span>
            <Skeleton className="mb-3 h-4 w-28" />
            <Skeleton className="mb-8 h-9 w-2/3 max-w-md" />
            <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
                <Skeleton className="h-72 sm:h-96" />
                <div className="space-y-3">
                    <Skeleton className="h-20" />
                    <Skeleton className="h-20" />
                    <Skeleton className="h-20" />
                </div>
            </div>
        </div>
    );
}
