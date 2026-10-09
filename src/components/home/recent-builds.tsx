'use client';

import Link from 'next/link';
import { ArrowRight, Box } from 'lucide-react';
import type { MyBuildRow } from '@/contracts/account';
import { useMyBuilds } from '@/components/site/use-account';
import { StatusPill } from '@/components/ui/status-pill';

/** Where a build row opens: its part's configurator when it has one, else the Build Workspace. */
export function buildHref(row: Pick<MyBuildRow, 'buildId' | 'partId'>): string {
    return row.partId ? `/parts/${encodeURIComponent(row.partId)}` : `/build/${encodeURIComponent(row.buildId)}/workspace`;
}

/** viewBox for an absolute M/L/Z path (the part preview format); null for anything else. */
export function pathViewBox(d: string): string | null {
    if (/[^MLZmlz0-9eE.,\s-]/.test(d)) return null;
    const n = (d.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
    if (n.length < 4 || n.length % 2) return null;
    const xs = n.filter((_, i) => i % 2 === 0);
    const ys = n.filter((_, i) => i % 2 === 1);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const w = Math.max(...xs) - minX;
    const h = Math.max(...ys) - minY;
    if (!(w > 0 && h > 0)) return null;
    const pad = Math.max(w, h) * 0.08;
    return `${minX - pad} ${minY - pad} ${w + pad * 2} ${h + pad * 2}`;
}

function BuildThumb({ d }: { d: string | null }) {
    const viewBox = d ? pathViewBox(d) : null;
    if (!d || !viewBox) return <Box className="h-5 w-5" aria-hidden />;
    return (
        <svg viewBox={viewBox} className="h-8 w-8" aria-hidden>
            <path d={d} fill="currentColor" fillRule="evenodd" />
        </svg>
    );
}

/**
 * Recent builds strip under the intake (Uber: recents under "Where to?"), from
 * GET /api/me/builds?limit=4. Renders nothing when the API is unavailable or there are no builds.
 */
export function RecentBuilds() {
    const { data } = useMyBuilds(4);
    const rows = data?.rows ?? [];
    if (rows.length === 0) return null;
    return (
        <section aria-labelledby="recent-builds" className="mx-auto w-full max-w-6xl px-4 pt-10 sm:px-6" data-testid="recent-builds">
            <div className="flex items-end justify-between gap-4">
                <h2 id="recent-builds" className="font-display font-wide text-xl font-bold text-ink sm:text-2xl">
                    Recent builds
                </h2>
                <Link href="/builds" className="inline-flex min-h-[44px] items-center gap-1 rounded text-sm font-semibold text-ink hover:underline">
                    All builds <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
            </div>
            <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {rows.slice(0, 4).map((row) => (
                    <li key={row.buildId}>
                        <Link href={buildHref(row)} className="flex h-full items-center gap-3 rounded-2xl bg-paper-raised p-3 ring-1 ring-paper-line transition-shadow hover:shadow-md">
                            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-ink text-paper">
                                <BuildThumb d={row.previewSvg} />
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block truncate font-semibold text-ink">{row.name}</span>
                                <span className="block truncate font-mono text-[11px] text-ink-subtle">{row.displayId}</span>
                            </span>
                            <StatusPill status={row.status} surface="paper" className="shrink-0" />
                        </Link>
                    </li>
                ))}
            </ul>
        </section>
    );
}
