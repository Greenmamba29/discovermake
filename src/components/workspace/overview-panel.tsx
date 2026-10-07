'use client';

import { ArrowRight, ShieldAlert, UploadCloud, Users } from 'lucide-react';
import type { BuildGraphView } from '@/contracts';
import { EstimateBadge } from '@/components/make-ai/creation-intent-view';
import { Button, ButtonLink } from '@/components/ui/button';
import { Notice } from '@/components/ui/state';
import { PanelCard } from './panels';
import { WorkspaceSourcingSlot } from './workspace-sourcing-slot';
import { buildBrief, materialsOf, nextAction, nodesOf, openUnknowns, partsOf, type WorkspaceSection } from './workspace-model';

const RISK_COPY: Record<string, string> = { standard: 'Standard', elevated: 'Needs specialist review', regulated: 'Out of scope' };

/** Build health and the one next action (spec §8.3 Overview). */
export function OverviewPanel({ view, onGo, isCurrent }: { view: BuildGraphView; onGo: (s: WorkspaceSection) => void; isCurrent: boolean }) {
    const brief = buildBrief(view);
    const next = nextAction(view);
    const recommended = materialsOf(view).find((m) => m.role === 'recommended');
    const stats = [
        { label: 'Requirements', value: nodesOf(view, 'REQUIREMENT').length, section: 'requirements' as const },
        { label: 'Open questions', value: openUnknowns(view).length, section: 'questions' as const },
        { label: 'Materials', value: nodesOf(view, 'MATERIAL').length, section: 'materials' as const },
        { label: 'Parts', value: partsOf(view).length, section: 'parts' as const },
    ];
    return (
        <div className="space-y-4">
            <PanelCard title="What we are making" testId="workspace-overview">
                <div className="flex flex-wrap items-center gap-2">
                    <EstimateBadge />
                    {brief.riskClass && <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-fg-subtle">{RISK_COPY[brief.riskClass] ?? brief.riskClass}</span>}
                </div>
                {brief.summary && <p className="mt-3 text-fg-muted">{brief.summary}</p>}
                {brief.derivedFrom && (
                    <p className="mt-2 font-mono text-xs text-fg-subtle">
                        Derived from {brief.derivedFrom.displayId}
                        {brief.derivedFrom.version ? ` v${brief.derivedFrom.version}` : ''}
                    </p>
                )}
                {brief.constraints.length > 0 && (
                    <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-fg-muted">
                        {brief.constraints.map((c) => (
                            <li key={c}>{c}</li>
                        ))}
                    </ul>
                )}
                {brief.specialists.length > 0 && (
                    <p className="mt-3 flex items-center gap-1.5 text-sm text-fg-muted">
                        <Users className="h-4 w-4 text-fg-subtle" aria-hidden />
                        Specialist review: {brief.specialists.join(', ')}
                    </p>
                )}
                {recommended && <p className="mt-3 text-sm text-fg">Recommended material: {recommended.label}</p>}
            </PanelCard>

            {isCurrent && (
                <section className="flex flex-col gap-3 rounded-2xl bg-graphite-850 p-4 ring-1 ring-graphite-600 sm:flex-row sm:items-center sm:justify-between sm:p-5" aria-labelledby="next-action" data-testid="workspace-next-action">
                    <div>
                        <p className="eyebrow">Next step</p>
                        <h3 id="next-action" className="mt-1 font-display text-lg font-bold">
                            {next.title}
                        </h3>
                        <p className="mt-1 text-sm text-fg-muted">{next.detail}</p>
                    </div>
                    {next.section === 'overview' ? (
                        <ButtonLink href="/make" className="shrink-0">
                            <UploadCloud className="h-4 w-4" aria-hidden />
                            Upload a DXF
                        </ButtonLink>
                    ) : (
                        <Button className="shrink-0" onClick={() => onGo(next.section)}>
                            {next.title}
                            <ArrowRight className="h-4 w-4" aria-hidden />
                        </Button>
                    )}
                </section>
            )}

            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {stats.map((s) => (
                    <div key={s.label} className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700">
                        <dt className="eyebrow">{s.label}</dt>
                        <dd className="mt-1 font-display text-2xl font-bold">
                            {s.value > 0 ? (
                                <button type="button" className="rounded-md underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal" onClick={() => onGo(s.section)}>
                                    {s.value}
                                </button>
                            ) : (
                                s.value
                            )}
                        </dd>
                    </div>
                ))}
            </dl>

            <Notice tone="info" title="Not a quote">
                <span className="inline-flex items-start gap-1.5">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    Make AI drafts the plan. Binding prices only come from the DiscoverMake quote engine.
                </span>
            </Notice>

            <WorkspaceSourcingSlot buildId={view.build.id} designVersion={view.version.version} />
        </div>
    );
}
