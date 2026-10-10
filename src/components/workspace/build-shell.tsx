'use client';

import type { ReactNode } from 'react';
import type { BuildOrigin, BuildSummary } from '@/contracts';
import { cn } from '@/lib/utils';
import { SECTION_LABEL, type WorkspaceSection } from './workspace-model';

const ORIGIN_COPY: Record<BuildOrigin, string> = { upload: 'From a DXF upload', make_ai: 'Planned with Make AI', remix: 'Remix', clone: 'Made from another build', reconstruct: 'Rebuilt from a photo', kids: 'A Kids & Family project' };

/**
 * BuildShell (EPIC-300): header, status strip, section nav and the active section.
 * The nav lists only sections that have real data in this version. Horizontal and
 * scrollable on phones, a left rail from `lg`.
 */
export function BuildShell({
    build,
    sections,
    active,
    onSelect,
    actions,
    statusStrip,
    banner,
    children,
}: {
    build: BuildSummary;
    sections: WorkspaceSection[];
    active: WorkspaceSection;
    onSelect: (s: WorkspaceSection) => void;
    actions?: ReactNode;
    statusStrip?: ReactNode;
    banner?: ReactNode;
    children: ReactNode;
}) {
    return (
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10" data-testid="build-shell">
            <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                    <p className="eyebrow">
                        Build workspace · <span className="font-mono">{build.displayId}</span>
                    </p>
                    <h1 className="mt-2 font-display text-2xl font-extrabold tracking-tight sm:text-4xl">{build.name}</h1>
                    <p className="mt-1 text-sm text-fg-subtle">{ORIGIN_COPY[build.origin]}</p>
                </div>
                {actions}
            </header>
            {statusStrip && <div className="mt-6">{statusStrip}</div>}
            {banner && <div className="mt-4">{banner}</div>}
            <div className="mt-6 grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
                <nav aria-label="Build sections" className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:overflow-visible lg:px-0">
                    <ul className="flex gap-1.5 lg:sticky lg:top-6 lg:flex-col">
                        {sections.map((s) => (
                            <li key={s} className="shrink-0">
                                <button
                                    type="button"
                                    onClick={() => onSelect(s)}
                                    aria-current={s === active ? 'page' : undefined}
                                    className={cn(
                                        'w-full rounded-xl px-3 py-2 text-left text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-signal',
                                        s === active ? 'bg-graphite-750 text-fg ring-1 ring-inset ring-graphite-600' : 'text-fg-muted hover:bg-graphite-800 hover:text-fg',
                                    )}
                                    data-testid={`section-${s}`}
                                >
                                    {SECTION_LABEL[s]}
                                </button>
                            </li>
                        ))}
                    </ul>
                </nav>
                <section aria-label={SECTION_LABEL[active]} className="min-w-0" id="workspace-section">
                    {children}
                </section>
            </div>
        </div>
    );
}
