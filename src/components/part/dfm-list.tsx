'use client';

import { AlertTriangle, CheckCircle2, OctagonAlert, Wand2 } from 'lucide-react';
import type { DfmResult, DfmViolation } from '@/contracts';
import { cn } from '@/lib/utils';

export type DfmFixAction = { label: string; apply: () => void };

/** DFM issues with severity and fix text. `actionFor` can turn a fix into a one-tap apply. */
export function DfmList({ dfm, actionFor, compact = false }: { dfm: DfmResult | null; actionFor?: (v: DfmViolation) => DfmFixAction | null; compact?: boolean }) {
    if (!dfm) return null;
    if (dfm.violations.length === 0) {
        return (
            <p className="flex items-center gap-2 text-sm text-signal" data-testid="dfm-clear">
                <CheckCircle2 className="h-4 w-4" aria-hidden /> No manufacturability issues found.
            </p>
        );
    }
    const sorted = [...dfm.violations].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'BLOCKING' ? -1 : 1));
    return (
        <ul className="space-y-2" data-testid="dfm-list">
            {sorted.map((v, i) => {
                const blocking = v.severity === 'BLOCKING';
                const action = actionFor?.(v) ?? null;
                return (
                    <li
                        key={`${v.ruleId}-${i}`}
                        className={cn('rounded-xl p-3 ring-1 ring-inset', blocking ? 'bg-ember/10 ring-ember/35' : 'bg-amber/10 ring-amber/25')}
                        data-severity={v.severity}
                    >
                        <div className="flex gap-2.5">
                            {blocking ? <OctagonAlert className="mt-0.5 h-4 w-4 shrink-0 text-ember" aria-hidden /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber" aria-hidden />}
                            <div className="min-w-0 flex-1">
                                <p className="text-sm text-fg">
                                    <span className={cn('mr-1.5 font-mono text-[10px] font-bold uppercase tracking-wider', blocking ? 'text-ember' : 'text-amber')}>{blocking ? 'Must fix' : 'Warning'}</span>
                                    {v.message}
                                    {v.count > 1 && <span className="text-fg-muted"> ({v.count}×)</span>}
                                </p>
                                {!compact && v.measuredMm != null && v.thresholdMm != null && (
                                    <p className="mt-0.5 font-mono text-[11px] text-fg-subtle">
                                        measured {v.measuredMm.toFixed(2)} mm · minimum {v.thresholdMm.toFixed(2)} mm
                                    </p>
                                )}
                                {v.fix && (
                                    <div className="mt-2 flex flex-wrap items-center gap-2">
                                        <p className="text-xs text-fg-muted">
                                            <span className="font-semibold text-fg">Fix:</span> {v.fix.label}
                                        </p>
                                        {action && (
                                            <button
                                                type="button"
                                                onClick={action.apply}
                                                className="inline-flex items-center gap-1 rounded-lg bg-graphite-700 px-2 py-1 text-xs font-semibold text-fg hover:bg-graphite-600"
                                            >
                                                <Wand2 className="h-3 w-3" aria-hidden /> {action.label}
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </li>
                );
            })}
        </ul>
    );
}
