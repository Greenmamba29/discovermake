'use client';

import Link from 'next/link';
import { GitFork, Layers } from 'lucide-react';
import type { BuildCard } from '@/contracts/media';
import { LICENSE_LABELS } from '@/contracts/media';
import { money } from '@/lib/format';
import { cn } from '@/lib/utils';

export function creatorLabel(c: BuildCard['creator']): string {
    return c.displayName ?? (c.handle ? `@${c.handle}` : (c.channelName ?? 'A maker'));
}

/** The part's flat pattern as card art (path in mm, evenodd fill). */
export function PreviewArt({ svg, size, title, className }: { svg: string | null; size: BuildCard['previewSize']; title: string; className?: string }) {
    if (!svg || !size || size.widthMm <= 0 || size.heightMm <= 0) {
        return (
            <div className={cn('flex aspect-[4/3] items-center justify-center bg-[radial-gradient(circle_at_30%_20%,#202423,#111413_70%)]', className)} aria-hidden>
                <Layers className="h-10 w-10 text-fg-subtle" />
            </div>
        );
    }
    const pad = Math.max(size.widthMm, size.heightMm) * 0.06;
    return (
        <div className={cn('bg-graphite-850 p-4', className)}>
            <svg viewBox={`${-pad} ${-pad} ${size.widthMm + pad * 2} ${size.heightMm + pad * 2}`} className="mx-auto max-h-56 w-full" role="img" aria-label={`Flat pattern of ${title}`} style={{ aspectRatio: String(Math.min(3, Math.max(0.6, size.widthMm / size.heightMm))) }}>
                <path d={svg} fill="#cfd6d2" fillRule="evenodd" />
            </svg>
        </div>
    );
}

export function LicenseChip({ license, royaltyPct, className }: { license: BuildCard['license']; royaltyPct: number; className?: string }) {
    return (
        <span className={cn('inline-flex items-center gap-1 rounded-full bg-graphite-800 px-2 py-0.5 text-[11px] font-medium text-fg-muted', className)} data-testid="license-chip">
            <GitFork className="h-3 w-3" aria-hidden />
            {LICENSE_LABELS[license]}
            {license !== 'none' && royaltyPct > 0 ? ` · ${royaltyPct}% royalty` : ''}
        </span>
    );
}

/** A published build in a Pinterest-style grid (Discover, channel page, search). */
export function BuildCardView({ build, onOpen, headingLevel = 3 }: { build: BuildCard; onOpen?: () => void; headingLevel?: 2 | 3 }) {
    const Heading = headingLevel === 2 ? 'h2' : 'h3';
    const titleId = `build-card-${build.buildId}`;
    return (
        <article className="mb-4 break-inside-avoid overflow-hidden rounded-2xl bg-graphite-900 ring-1 ring-graphite-700" aria-labelledby={titleId} data-testid="feed-build" data-build-id={build.buildId}>
            <Link href={`/b/${build.buildId}`} onClick={onOpen} className="block focus-visible:outline-offset-[-2px]">
                {build.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={build.coverUrl} alt={`Cover of ${build.title}`} className="aspect-[4/3] w-full object-cover" loading="lazy" />
                ) : (
                    <PreviewArt svg={build.previewSvg} size={build.previewSize} title={build.title} />
                )}
                <div className="p-4">
                    <Heading id={titleId} className="font-display text-base font-bold text-fg">
                        {build.title}
                    </Heading>
                    <p className="mt-0.5 text-sm text-fg-muted">by {creatorLabel(build.creator)}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <LicenseChip license={build.license} royaltyPct={build.royaltyPct} />
                        {build.remixCount > 0 && <span className="rounded-full bg-graphite-800 px-2 py-0.5 text-[11px] text-fg-muted">{build.remixCount} remix{build.remixCount === 1 ? '' : 'es'}</span>}
                    </div>
                    <p className="mt-3 flex items-baseline justify-between text-sm">
                        <span className="font-semibold text-fg">{build.priceCents !== null ? `${money(build.priceCents, build.currency)} each` : 'Make AI build'}</span>
                        <span className="font-mono text-[11px] text-fg-subtle">{build.displayId}</span>
                    </p>
                </div>
            </Link>
        </article>
    );
}
