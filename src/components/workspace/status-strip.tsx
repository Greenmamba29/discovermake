'use client';

import { CircleHelp, GitCommitVertical, Sparkles } from 'lucide-react';
import type { BuildGraphView } from '@/contracts';
import { BuildTrustBadge } from '@/components/trust/build-trust-badge';
import { cn } from '@/lib/utils';
import { confidenceSummary, openUnknowns, pct, VERSION_STATUS_LABEL } from './workspace-model';

function Cell({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
    return (
        <div className={cn('min-w-0', className)}>
            <dt className="eyebrow">{label}</dt>
            <dd className="mt-1.5 text-sm text-fg">{children}</dd>
        </div>
    );
}

/**
 * Persistent status strip (spec §8.2): trust state, version, open questions and the Make AI
 * confidence summary. Trust comes from the server (derived, never stored) and a concept is
 * always drawn as a concept.
 */
export function StatusStrip({ view, onOpenQuestions }: { view: BuildGraphView; onOpenQuestions?: () => void }) {
    const open = openUnknowns(view).length;
    const conf = confidenceSummary(view);
    return (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700 sm:p-5 lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]" data-testid="workspace-status-strip">
            <Cell label="Trust" className="col-span-2 lg:col-span-1">
                <BuildTrustBadge state={view.build.trustState} showSteps />
            </Cell>
            <Cell label="Version">
                <span className="inline-flex items-center gap-1.5 font-mono" data-testid="workspace-version">
                    <GitCommitVertical className="h-4 w-4 text-fg-subtle" aria-hidden />v{view.version.version}
                    <span className="text-fg-subtle">· {VERSION_STATUS_LABEL[view.version.status]}</span>
                </span>
            </Cell>
            <Cell label="Open questions">
                {open > 0 && onOpenQuestions ? (
                    <button
                        type="button"
                        onClick={onOpenQuestions}
                        className="inline-flex items-center gap-1.5 rounded-md font-semibold text-amber underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
                        data-testid="workspace-open-questions"
                    >
                        <CircleHelp className="h-4 w-4" aria-hidden />
                        {open} open
                    </button>
                ) : (
                    <span className={cn('inline-flex items-center gap-1.5', open > 0 ? 'font-semibold text-amber' : 'text-fg-muted')} data-testid="workspace-open-questions">
                        <CircleHelp className="h-4 w-4" aria-hidden />
                        {open > 0 ? `${open} open` : 'None open'}
                    </span>
                )}
            </Cell>
            <Cell label="Make AI confidence">
                {conf.average === null ? (
                    <span className="text-fg-muted">No AI estimates</span>
                ) : (
                    <span className="inline-flex flex-col gap-0.5" data-testid="workspace-confidence">
                        <span className="inline-flex items-center gap-1.5">
                            <Sparkles className="h-4 w-4 text-amber" aria-hidden />
                            <span className="font-mono">{pct(conf.average)}</span>
                            <span className="text-fg-subtle">avg of {conf.count}</span>
                        </span>
                        {conf.lowest && conf.lowest.confidence < 0.6 && (
                            <span className="truncate text-xs text-fg-subtle" title={conf.lowest.label}>
                                Lowest: {pct(conf.lowest.confidence)} · {conf.lowest.label}
                            </span>
                        )}
                    </span>
                )}
            </Cell>
        </dl>
    );
}
