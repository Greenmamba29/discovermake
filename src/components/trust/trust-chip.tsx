'use client';

import { BadgeCheck, CircleDashed, ShieldCheck, Sparkles } from 'lucide-react';
import type { TrustLevel } from '@/contracts';
import { InfoTip } from '@/components/ui/info-tip';
import { cn } from '@/lib/utils';

export type Orderability = 'no' | 'after_approval' | 'yes';

/**
 * Quote trust levels (workflow 03, "shown on every price"). The ONE place this copy lives:
 * every price on the configure screen, the Manufacturing Route and the sourcing desk uses it.
 */
export const TRUST_COPY: Record<TrustLevel, { label: string; tip: string; orderable: Orderability; orderableLabel: string }> = {
    AI_ESTIMATE: {
        label: 'AI estimate',
        tip: 'An automated estimate from your design. A manufacturing partner has not reviewed it yet, so it cannot be ordered.',
        orderable: 'no',
        orderableLabel: 'Not orderable',
    },
    SUPPLIER_ESTIMATE: {
        label: 'Supplier estimate',
        tip: 'An indicative number from a manufacturing partner. It is not confirmed against your full design package yet, so it cannot be ordered.',
        orderable: 'no',
        orderableLabel: 'Not orderable',
    },
    SUPPLIER_CONFIRMED: {
        label: 'Supplier-confirmed',
        tip: 'A manufacturing partner confirmed this price against this exact design version. It can be ordered once DiscoverMake and you approve it.',
        orderable: 'after_approval',
        orderableLabel: 'Orderable after approval',
    },
    BINDING: {
        label: 'Binding quote',
        tip: 'This is the price you pay. It is locked until the quote expires, and checkout charges exactly this amount plus the shipping you choose.',
        orderable: 'yes',
        orderableLabel: 'Orderable',
    },
};

const STYLE: Record<TrustLevel, string> = {
    AI_ESTIMATE: 'bg-graphite-700 text-fg-muted',
    SUPPLIER_ESTIMATE: 'bg-amber/15 text-amber',
    SUPPLIER_CONFIRMED: 'bg-transparent text-signal ring-1 ring-inset ring-signal/50',
    BINDING: 'bg-signal/15 text-signal',
};

const ICON: Record<TrustLevel, typeof BadgeCheck> = {
    AI_ESTIMATE: Sparkles,
    SUPPLIER_ESTIMATE: CircleDashed,
    SUPPLIER_CONFIRMED: ShieldCheck,
    BINDING: BadgeCheck,
};

export function isOrderable(level: TrustLevel): Orderability {
    return TRUST_COPY[level].orderable;
}

/** Trust label chip with an ⓘ explainer. `showOrderable` adds the "Not orderable / Orderable" line. */
export function TrustChip({
    level,
    showOrderable = false,
    testId = 'trust-chip',
    className,
}: {
    level: TrustLevel;
    showOrderable?: boolean;
    testId?: string;
    className?: string;
}) {
    const t = TRUST_COPY[level];
    const Icon = ICON[level];
    return (
        <span className={cn('inline-flex flex-wrap items-center gap-1.5', className)}>
            <span
                className={cn('inline-flex items-center gap-1 rounded-full py-0.5 pl-2.5 pr-1 text-xs font-semibold', STYLE[level])}
                data-testid={testId}
                data-trust={level}
            >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {t.label}
                <InfoTip label={t.label} text={t.tip} />
            </span>
            {showOrderable && (
                <span className={cn('text-[11px] font-medium', t.orderable === 'yes' ? 'text-signal' : t.orderable === 'after_approval' ? 'text-fg-muted' : 'text-fg-subtle')} data-testid={`${testId}-orderable`}>
                    {t.orderableLabel}
                </span>
            )}
        </span>
    );
}
