'use client';

/**
 * Versions (ADR-0001): the design version history, a diff between any two versions and
 * "Approve version" for a DRAFT newer than the approved one. Approved versions are immutable.
 * Render with `key={latestVersion}` so the compare pickers reset when a new version lands.
 */
import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GitCompare, History, ShieldCheck } from 'lucide-react';
import type { BuildGraphDiff, BuildGraphView, DesignVersionStatus } from '@/contracts';
import { Button } from '@/components/ui/button';
import { ConfirmAction } from '@/components/ui/confirm-action';
import { SelectInput } from '@/components/ui/field';
import { Notice } from '@/components/ui/state';
import { errorMessage } from '@/lib/api';
import { shortDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PanelCard, Tag } from './panels';
import { workspaceApi } from './workspace-api';
import { approvedVersion, canApprove, VERSION_STATUS_LABEL } from './workspace-model';

const VERSION_TAG: Record<DesignVersionStatus, string> = {
    DRAFT: 'text-fg-muted ring-graphite-600 border-dashed',
    APPROVED: 'text-signal ring-signal/40',
    SUPERSEDED: 'text-fg-subtle ring-graphite-700',
};

export function DiffSummary({ diff, labels }: { diff: BuildGraphDiff; labels: Map<string, string> }) {
    const name = (key: string) => labels.get(key) ?? key;
    const nothing = diff.added.length + diff.removed.length + diff.changed.length + diff.edgesAdded + diff.edgesRemoved === 0;
    if (nothing) return <p className="text-sm text-fg-muted">No differences between v{diff.from} and v{diff.to}.</p>;
    return (
        <div className="space-y-3 text-sm" data-testid="workspace-diff">
            <p className="font-mono text-xs text-fg-subtle">
                v{diff.from} → v{diff.to}: +{diff.added.length} added · −{diff.removed.length} removed · {diff.changed.length} changed · links +{diff.edgesAdded} / −{diff.edgesRemoved}
            </p>
            {diff.added.length > 0 && (
                <div>
                    <h4 className="eyebrow text-signal">Added</h4>
                    <ul className="mt-1 space-y-0.5">
                        {diff.added.map((k) => (
                            <li key={k} className="text-fg">
                                + {name(k)} <span className="font-mono text-[11px] text-fg-subtle">{k}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {diff.removed.length > 0 && (
                <div>
                    <h4 className="eyebrow text-ember">Removed</h4>
                    <ul className="mt-1 space-y-0.5">
                        {diff.removed.map((k) => (
                            <li key={k} className="text-fg-muted">
                                − {name(k)} <span className="font-mono text-[11px] text-fg-subtle">{k}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {diff.changed.length > 0 && (
                <div>
                    <h4 className="eyebrow text-amber">Changed</h4>
                    <ul className="mt-1 space-y-0.5">
                        {diff.changed.map((c) => (
                            <li key={c.key} className="text-fg">
                                ~ {name(c.key)} <span className="font-mono text-[11px] text-fg-subtle">{c.fields.join(', ')}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

export function VersionsPanel({
    buildId,
    view,
    viewing,
    onView,
    onApprove,
    approving,
    approveError,
}: {
    buildId: string;
    /** The current-version graph (the source of the version list). */
    view: BuildGraphView;
    /** The version shown elsewhere in the workspace. */
    viewing: number;
    onView: (version: number) => void;
    onApprove: (version: number) => Promise<void>;
    approving: boolean;
    approveError?: string | null;
}) {
    const versions = [...view.versions].sort((a, b) => b.version - a.version);
    const latest = versions[0]?.version ?? 1;
    const [from, setFrom] = useState(Math.max(1, latest - 1));
    const [to, setTo] = useState(latest);
    const fromId = useId();
    const toId = useId();
    const canDiff = versions.length > 1 && from !== to;
    const diff = useQuery({ queryKey: ['build-graph-diff', buildId, from, to], queryFn: ({ signal }) => workspaceApi.diff(buildId, from, to, signal), enabled: canDiff });
    const labels = new Map(view.nodes.map((n) => [n.key, n.label]));
    const approved = approvedVersion(view);

    return (
        <div className="space-y-4">
            <PanelCard title="Version history" icon={<History className="h-5 w-5" />} testId="workspace-versions">
                {approveError && (
                    <Notice tone="error" title="Could not approve" className="mb-3">
                        {approveError}
                    </Notice>
                )}
                <ol className="space-y-2">
                    {versions.map((v) => (
                        <li key={v.version} className={cn('rounded-xl bg-graphite-850 p-3 ring-1 ring-inset', v.version === viewing ? 'ring-signal/40' : 'ring-graphite-700')} data-testid={`version-${v.version}`}>
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="font-mono text-sm font-semibold text-fg">v{v.version}</span>
                                <Tag className={VERSION_TAG[v.status]}>{VERSION_STATUS_LABEL[v.status]}</Tag>
                                <span className="font-mono text-[11px] text-fg-subtle">{shortDate(v.createdAt)}</span>
                                {v.version === viewing && <span className="font-mono text-[11px] text-signal">viewing</span>}
                            </div>
                            <p className="mt-1 text-sm text-fg-muted">{v.summary}</p>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                {v.version !== viewing && (
                                    <Button size="sm" variant="ghost" onClick={() => onView(v.version)}>
                                        View v{v.version}
                                    </Button>
                                )}
                                {canApprove(view, v.version) && (
                                    <ConfirmAction
                                        size="sm"
                                        label={`Approve version ${v.version}`}
                                        confirmLabel="Approve"
                                        icon={<ShieldCheck className="h-4 w-4" aria-hidden />}
                                        prompt={
                                            approved
                                                ? `Version ${v.version} becomes the approved design and version ${approved} is superseded. Approved versions never change.`
                                                : `Version ${v.version} becomes the approved design. Approved versions never change.`
                                        }
                                        loading={approving}
                                        onConfirm={() => onApprove(v.version)}
                                        testId={`approve-v${v.version}`}
                                    />
                                )}
                            </div>
                        </li>
                    ))}
                </ol>
            </PanelCard>

            {versions.length > 1 && (
                <PanelCard title="Compare versions" icon={<GitCompare className="h-5 w-5" />}>
                    <div className="mb-4 flex flex-wrap items-end gap-3">
                        <div className="flex flex-col gap-1.5">
                            <label htmlFor={fromId} className="text-sm font-medium text-fg">
                                From
                            </label>
                            <SelectInput id={fromId} value={from} onChange={(e) => setFrom(Number(e.target.value))} className="w-28">
                                {versions.map((v) => (
                                    <option key={v.version} value={v.version}>
                                        v{v.version}
                                    </option>
                                ))}
                            </SelectInput>
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <label htmlFor={toId} className="text-sm font-medium text-fg">
                                To
                            </label>
                            <SelectInput id={toId} value={to} onChange={(e) => setTo(Number(e.target.value))} className="w-28">
                                {versions.map((v) => (
                                    <option key={v.version} value={v.version}>
                                        v{v.version}
                                    </option>
                                ))}
                            </SelectInput>
                        </div>
                    </div>
                    {!canDiff ? (
                        <p className="text-sm text-fg-muted">Pick two different versions.</p>
                    ) : diff.isPending ? (
                        <div className="skeleton h-20 w-full rounded-xl" role="status" aria-label="Comparing versions" />
                    ) : diff.isError ? (
                        <Notice tone="error">{errorMessage(diff.error)}</Notice>
                    ) : (
                        <DiffSummary diff={diff.data} labels={labels} />
                    )}
                </PanelCard>
            )}
        </div>
    );
}
