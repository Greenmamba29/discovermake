'use client';

/**
 * Read-only Build Workspace sections backed by Build Graph nodes: Requirements, Materials
 * and Parts. AI-produced items are labelled as estimates; catalog misses read "needs sourcing".
 */
import type { ReactNode } from 'react';
import { Boxes, Layers, ListChecks, PackageSearch, Ruler, Wrench } from 'lucide-react';
import type { BuildGraphView } from '@/contracts';
import { EmptyState } from '@/components/ui/state';
import { cn } from '@/lib/utils';
import { materialsOf, nodesOf, partsOf, pct, processesOf, requirementInfo, type MaterialInfo } from './workspace-model';

export function Tag({ children, className }: { children: ReactNode; className?: string }) {
    return <span className={cn('inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] ring-1 ring-inset', className)}>{children}</span>;
}

export function PanelCard({ title, icon, children, className, testId }: { title: string; icon?: ReactNode; children: ReactNode; className?: string; testId?: string }) {
    return (
        <section className={cn('rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700 sm:p-5', className)} data-testid={testId}>
            <h3 className="flex items-center gap-2 font-display text-base font-bold">
                {icon && (
                    <span className="text-fg-subtle" aria-hidden>
                        {icon}
                    </span>
                )}
                {title}
            </h3>
            <div className="mt-3">{children}</div>
        </section>
    );
}

const SourcingTag = () => <Tag className="text-amber ring-amber/40">Needs sourcing</Tag>;

export function RequirementsPanel({ view }: { view: BuildGraphView }) {
    const reqs = nodesOf(view, 'REQUIREMENT').map(requirementInfo);
    if (reqs.length === 0) return <EmptyState title="No requirements yet" />;
    return (
        <PanelCard title={`Requirements (${reqs.length})`} icon={<ListChecks className="h-5 w-5" />} testId="workspace-requirements">
            <ul className="space-y-2">
                {reqs.map((r) => (
                    <li key={r.key} className="rounded-xl bg-graphite-850 p-3 ring-1 ring-inset ring-graphite-700">
                        <p className="text-sm text-fg">{r.text}</p>
                        <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {r.category && <Tag className="text-fg-muted ring-graphite-600">{r.category}</Tag>}
                            {r.fromAnswer ? (
                                <Tag className="text-signal ring-signal/30">Your answer</Tag>
                            ) : r.statedByBuyer ? (
                                <Tag className="text-signal ring-signal/30">You said</Tag>
                            ) : (
                                <Tag className="text-fg-subtle ring-graphite-600">Inferred by Make AI</Tag>
                            )}
                            {r.confidence !== null && <span className="font-mono text-[11px] text-fg-subtle">{pct(r.confidence)} sure</span>}
                        </p>
                    </li>
                ))}
            </ul>
        </PanelCard>
    );
}

const EFFECT_COPY: Record<string, string> = { lower: 'Lower', similar: 'Similar', higher: 'Higher', faster: 'Faster', slower: 'Slower', unknown: 'Unknown' };

function MaterialCard({ m }: { m: MaterialInfo }) {
    return (
        <li className={cn('rounded-xl p-4 ring-1 ring-inset', m.role === 'recommended' ? 'bg-graphite-850 ring-signal/30' : 'bg-graphite-850 ring-graphite-700')} data-testid={`material-${m.key}`}>
            <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-fg">{m.inCatalog ? m.label : m.label.replace(/\s*\(needs sourcing\)$/i, '')}</p>
                <Tag className={m.role === 'recommended' ? 'text-signal ring-signal/30' : 'text-fg-muted ring-graphite-600'}>{m.role}</Tag>
                {!m.inCatalog && <SourcingTag />}
                {m.confidence !== null && <span className="font-mono text-[11px] text-fg-subtle">{pct(m.confidence)} confidence</span>}
            </div>
            {m.why && <p className="mt-1.5 text-sm text-fg-muted">{m.why}</p>}
            {m.tradeoff && <p className="mt-1 text-sm text-fg-subtle">Tradeoff: {m.tradeoff}</p>}
            {(m.costEffect || m.leadTimeEffect) && (
                <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                    {m.costEffect && (
                        <div>
                            <dt className="eyebrow">Cost effect</dt>
                            <dd className="mt-1 text-sm text-fg">
                                {EFFECT_COPY[m.costEffect] ?? m.costEffect}
                                {m.costNote && <span className="block text-xs text-fg-subtle">{m.costNote}</span>}
                            </dd>
                        </div>
                    )}
                    {m.leadTimeEffect && (
                        <div>
                            <dt className="eyebrow">Lead-time effect</dt>
                            <dd className="mt-1 text-sm text-fg">
                                {EFFECT_COPY[m.leadTimeEffect] ?? m.leadTimeEffect}
                                {m.leadTimeNote && <span className="block text-xs text-fg-subtle">{m.leadTimeNote}</span>}
                            </dd>
                        </div>
                    )}
                </dl>
            )}
            {m.processCompatibility && <p className="mt-3 text-xs text-fg-subtle">Process fit: {m.processCompatibility}</p>}
            {(m.tradeoffs.length > 0 || m.risks.length > 0) && (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-fg-muted">
                    {m.tradeoffs.map((t) => (
                        <li key={`t-${t}`}>{t}</li>
                    ))}
                    {m.risks.map((r) => (
                        <li key={`r-${r}`}>Risk: {r}</li>
                    ))}
                </ul>
            )}
        </li>
    );
}

export function MaterialsPanel({ view }: { view: BuildGraphView }) {
    const materials = materialsOf(view);
    if (materials.length === 0) return <EmptyState title="No materials yet" />;
    const engineer = materials.some((m) => m.byEngineer);
    return (
        <PanelCard title="Materials" icon={<Layers className="h-5 w-5" />} testId="workspace-materials">
            <p className="mb-3 text-sm text-fg-muted">
                {engineer ? 'Recommended by the Make AI Materials Engineer from the DiscoverMake catalog.' : 'Candidates from your Make AI plan, matched to the DiscoverMake catalog.'} Anything outside the catalog needs sourcing
                before it can be quoted.
            </p>
            <ul className="space-y-3">
                {materials.map((m) => (
                    <MaterialCard key={m.key} m={m} />
                ))}
            </ul>
        </PanelCard>
    );
}

export function PartsPanel({ view }: { view: BuildGraphView }) {
    const parts = partsOf(view);
    const processes = processesOf(view);
    if (parts.length === 0 && processes.length === 0) return <EmptyState title="No parts yet" />;
    return (
        <div className="space-y-4">
            {parts.length > 0 && (
                <PanelCard title="Parts" icon={<Boxes className="h-5 w-5" />} testId="workspace-parts">
                    <p className="mb-3 text-sm text-fg-muted">A first cut from your plan. CAD splits it into real parts later.</p>
                    <ul className="space-y-3">
                        {parts.map((p) => (
                            <li key={p.key} className="rounded-xl bg-graphite-850 p-4 ring-1 ring-inset ring-graphite-700">
                                <div className="flex flex-wrap items-center gap-2">
                                    <p className="font-semibold text-fg">{p.label}</p>
                                    <Tag className="text-fg-muted ring-graphite-600">{p.type === 'ASSEMBLY' ? 'Assembly' : 'Part'}</Tag>
                                </div>
                                <div className="mt-3 flex items-start gap-2 text-sm">
                                    <Ruler className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" aria-hidden />
                                    {p.dimensionsStated ? (
                                        <ul className="space-y-0.5 text-fg">
                                            {p.dimensions.map((d) => (
                                                <li key={d}>{d}</li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <p className="text-amber">Dimensions needed: answer the size question. We never guess them.</p>
                                    )}
                                </div>
                                {(p.materials.length > 0 || p.processes.length > 0 || p.finishes.length > 0) && (
                                    <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                                        {p.materials.length > 0 && (
                                            <div>
                                                <dt className="eyebrow">Made of</dt>
                                                <dd className="mt-1 text-fg-muted">{p.materials.join(', ')}</dd>
                                            </div>
                                        )}
                                        {p.processes.length > 0 && (
                                            <div>
                                                <dt className="eyebrow">Processes</dt>
                                                <dd className="mt-1 text-fg-muted">{p.processes.join(', ')}</dd>
                                            </div>
                                        )}
                                        {p.finishes.length > 0 && (
                                            <div>
                                                <dt className="eyebrow">Finish</dt>
                                                <dd className="mt-1 text-fg-muted">{p.finishes.join(', ')}</dd>
                                            </div>
                                        )}
                                    </dl>
                                )}
                            </li>
                        ))}
                    </ul>
                </PanelCard>
            )}
            {processes.length > 0 && (
                <PanelCard title="Processes and finishes" icon={<Wrench className="h-5 w-5" />} testId="workspace-processes">
                    <ul className="flex flex-wrap gap-2">
                        {processes.map((p) => (
                            <li key={p.key} className="inline-flex items-center gap-2 rounded-lg bg-graphite-800 px-2.5 py-1.5 text-sm text-fg ring-1 ring-inset ring-graphite-600">
                                {p.inCatalog ? null : <PackageSearch className="h-4 w-4 text-amber" aria-hidden />}
                                {p.label}
                                {p.type === 'FINISH' && p.options > 1 && <span className="font-mono text-[11px] text-fg-subtle">{p.options} options</span>}
                            </li>
                        ))}
                    </ul>
                </PanelCard>
            )}
        </div>
    );
}
