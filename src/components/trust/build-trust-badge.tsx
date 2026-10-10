import { BUILD_TRUST_STATES, type BuildTrustState } from '@/contracts';
import { cn } from '@/lib/utils';

/**
 * Build trust states (workflow 03): CONCEPT → ENGINEERING REVIEW → MANUFACTURING READY →
 * SUPPLIER CONFIRMED → ORDERABLE. Only ORDERABLE gets the solid signal color, and a concept
 * is drawn dashed and neutral so it can never be mistaken for a production-ready part.
 */
export const BUILD_TRUST_COPY: Record<BuildTrustState, { label: string; description: string }> = {
    CONCEPT: { label: 'Concept', description: 'An idea or AI concept. Not engineered for production yet.' },
    ENGINEERING_REVIEW: { label: 'Engineering review', description: 'Being checked for manufacturability before it can be quoted firmly.' },
    MANUFACTURING_READY: { label: 'Manufacturing ready', description: 'The design is complete enough to quote and source.' },
    SUPPLIER_CONFIRMED: { label: 'Supplier confirmed', description: 'A manufacturing partner confirmed this design version. Ordering still needs approval.' },
    ORDERABLE: { label: 'Orderable', description: 'Price and date are committed. You can order it.' },
};

const CHIP: Record<BuildTrustState, string> = {
    CONCEPT: 'border border-dashed border-graphite-500 bg-transparent text-fg-muted',
    ENGINEERING_REVIEW: 'bg-amber/15 text-amber',
    MANUFACTURING_READY: 'bg-graphite-700 text-fg',
    SUPPLIER_CONFIRMED: 'bg-transparent text-signal ring-1 ring-inset ring-signal/50',
    ORDERABLE: 'bg-signal/15 text-signal',
};

export function BuildTrustBadge({ state, showSteps = false, className }: { state: BuildTrustState; showSteps?: boolean; className?: string }) {
    const copy = BUILD_TRUST_COPY[state];
    const index = BUILD_TRUST_STATES.indexOf(state);
    return (
        <div className={cn('inline-flex flex-col gap-1.5', className)} data-testid="build-trust-badge" data-trust-state={state}>
            <span className={cn('inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.08em]', CHIP[state])} title={copy.description}>
                {copy.label}
            </span>
            {showSteps && (
                <>
                    <ol className="flex gap-1" aria-label={`Build trust: step ${index + 1} of ${BUILD_TRUST_STATES.length}, ${copy.label}`}>
                        {BUILD_TRUST_STATES.map((s, i) => (
                            <li
                                key={s}
                                className={cn('h-1.5 w-8 rounded-full', i > index ? 'bg-graphite-700' : state === 'ORDERABLE' ? 'bg-signal' : state === 'CONCEPT' ? 'bg-graphite-500' : i === index ? 'bg-signal/60' : 'bg-signal/35')}
                                aria-current={i === index ? 'step' : undefined}
                            >
                                <span className="sr-only">{BUILD_TRUST_COPY[s].label}</span>
                            </li>
                        ))}
                    </ol>
                    <p className="text-xs text-fg-subtle">{copy.description}</p>
                </>
            )}
        </div>
    );
}
