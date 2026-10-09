'use client';

import Link from 'next/link';
import { ArrowRight, Cog, Layers, Loader2, Printer, Scissors, Sparkles, Trees, Wrench, Zap } from 'lucide-react';
import { makeAiPromptHref } from '@/components/home/intake';
import { stageLabel, usePartUpload } from '@/components/upload/use-part-upload';
import type { DiscoverItem } from '@/lib/discover-catalog';
import { patternBounds, type FlatPattern } from '@/lib/dxf-builder';
import { INTERESTS } from '@/lib/interests';
import { cn } from '@/lib/utils';
import { PatternArt } from './pattern-art';

const PROCESS_ICON: Record<DiscoverItem['process'], typeof Cog> = {
    'Laser cut': Scissors,
    'Laser cut + bend': Layers,
    CNC: Cog,
    '3D print': Printer,
    Wood: Trees,
    Reconstruct: Wrench,
};

/**
 * One starter design (Pinterest / Behance grid card). Its button starts a REAL flow:
 * a bundled DXF through the instant-quote pipeline (opens the configurator prefilled with the
 * quote), or Make AI with a precise prompt.
 */
export function DiscoverCard({ item, makeAiEnabled }: { item: DiscoverItem; makeAiEnabled: boolean }) {
    const upload = usePartUpload();
    const Icon = PROCESS_ICON[item.process];
    const start = item.start;
    const titleId = `discover-${item.slug}-title`;

    return (
        <article className="mb-4 break-inside-avoid overflow-hidden rounded-2xl bg-graphite-900 ring-1 ring-graphite-700" aria-labelledby={titleId} data-testid={`discover-card-${item.slug}`}>
            {start.kind === 'quote' ? (
                <div className="bg-graphite-850 p-5">
                    <div className="mx-auto max-h-64 w-full" style={{ aspectRatio: aspect(start.preview) }}>
                        <PatternArt pattern={start.preview} title={item.title} />
                    </div>
                </div>
            ) : (
                <div className="flex aspect-[4/3] items-center justify-center bg-[radial-gradient(circle_at_30%_20%,#202423,#111413_70%)]">
                    <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-graphite-750 text-fg ring-1 ring-graphite-600">
                        <Icon className="h-8 w-8" aria-hidden />
                    </span>
                </div>
            )}
            <div className="p-4">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-fg-muted">
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                    {item.process}
                    {start.kind === 'quote' && (
                        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-signal/15 px-2 py-0.5 text-[11px] text-signal">
                            <Zap className="h-3 w-3" aria-hidden />
                            Instant quote
                        </span>
                    )}
                </p>
                <h2 id={titleId} className="mt-2 font-display text-lg font-bold text-fg">
                    {item.title}
                </h2>
                <p className="mt-1 text-sm leading-snug text-fg-muted">{item.summary}</p>
                <p className="mt-2 font-mono text-[11px] text-fg-subtle">{item.specs}</p>
                <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Interests">
                    {item.interests.map((s) => (
                        <li key={s} className="rounded-full bg-graphite-800 px-2 py-0.5 text-[11px] text-fg-muted">
                            {INTERESTS[s].label}
                        </li>
                    ))}
                </ul>
                <div className="mt-4">
                    {start.kind === 'quote' ? (
                        <>
                            <button
                                type="button"
                                disabled={upload.busy}
                                onClick={() => void upload.start(new File([start.dxf()], start.filename, { type: 'application/dxf' }), start.preset)}
                                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-signal px-4 text-[15px] font-semibold text-signal-ink transition-colors hover:bg-signal-strong disabled:cursor-progress disabled:opacity-80"
                                data-testid={`discover-start-${item.slug}`}
                            >
                                {upload.busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Zap className="h-4 w-4" aria-hidden />}
                                {upload.busy ? 'Quoting…' : 'Get an instant quote'}
                            </button>
                            <p className={cn('mt-2 min-h-[1.25rem] text-xs', upload.stage.kind === 'error' ? 'font-medium text-ember' : 'text-fg-subtle')} role={upload.stage.kind === 'error' ? 'alert' : undefined} aria-live="polite">
                                {stageLabel(upload.stage)}
                            </p>
                        </>
                    ) : makeAiEnabled ? (
                        <Link
                            href={makeAiPromptHref(start.prompt)}
                            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-graphite-750 px-4 text-[15px] font-semibold text-fg ring-1 ring-inset ring-graphite-600 transition-colors hover:bg-graphite-700"
                            data-testid={`discover-start-${item.slug}`}
                        >
                            <Sparkles className="h-4 w-4" aria-hidden />
                            {item.process === 'Reconstruct' ? 'Describe the broken part' : 'Plan it with Make AI'}
                            <ArrowRight className="h-4 w-4" aria-hidden />
                        </Link>
                    ) : (
                        <p className="rounded-xl bg-graphite-800 px-3 py-2.5 text-center text-xs text-fg-muted">Make AI is in private preview on this site.</p>
                    )}
                </div>
            </div>
        </article>
    );
}

/** Card art aspect ratio from the part's size, clamped so very long or tall parts stay readable. */
function aspect(pattern: FlatPattern): string {
    const b = patternBounds(pattern);
    return String(Math.min(3, Math.max(1 / 1.6, (b.maxX - b.minX) / (b.maxY - b.minY))));
}
