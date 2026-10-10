'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, FileUp, Loader2, RefreshCw, Timer } from 'lucide-react';
import type { TrustLevel } from '@/contracts';
import { FlatPattern } from '@/components/part/part-preview';
import { TrustChip } from '@/components/trust/trust-chip';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/state';
import { partUrl, quotePreset, stageLabel, uploadAndAnalyze, usePartUpload, type QuotePreset } from '@/components/upload/use-part-upload';
import { errorMessage } from '@/lib/api';
import { money, shortDate } from '@/lib/format';
import { sampleBracketFile } from '@/lib/sample-dxf';
import type { FirstBuild } from './onboarding-state';

/** The sample wall bracket priced as a single 6061 aluminum part (same preset as the Discover card). */
export const FIRST_BUILD_PRESET: QuotePreset = { materialId: 'mat_al_6061', thicknessOptionId: 'thk_al6061_090', finishServiceId: null, services: [], quantity: 1 };

type Run = { kind: 'running'; label: string } | { kind: 'error'; message: string } | { kind: 'idle' };

/**
 * Onboarding step 3, the "aha" moment: the bundled sample DXF goes through the real
 * upload → analyze → quote API and shows the real price and its trust level in seconds.
 * "Use my own file" runs the same pipeline on the visitor's DXF and opens the configurator.
 */
export function FirstBuildStep({ firstBuild, onQuoted }: { firstBuild: FirstBuild | null; onQuoted: (fb: FirstBuild) => void }) {
    const [run, setRun] = useState<Run>({ kind: 'idle' });
    const started = useRef(false);
    const own = usePartUpload();
    const ownInput = useRef<HTMLInputElement>(null);

    const quoteSample = async () => {
        const t0 = performance.now();
        setRun({ kind: 'running', label: 'Uploading the sample bracket' });
        try {
            const part = await uploadAndAnalyze(sampleBracketFile(), undefined, () => setRun({ kind: 'running', label: 'Reading geometry, holes and cut length' }));
            setRun({ kind: 'running', label: 'Pricing it with a partner shop rate card' });
            const quote = await quotePreset(part, FIRST_BUILD_PRESET);
            if (!quote || !part.preview) throw new Error('The sample could not be priced right now. Try again in a moment.');
            onQuoted({
                partId: part.id,
                quoteId: quote.id,
                subtotalCents: quote.subtotalCents,
                currency: quote.currency,
                trustLevel: quote.trustLevel,
                orderable: quote.orderable,
                shipDate: quote.shipDate,
                materialName: quote.summary.materialName,
                thicknessLabel: quote.summary.thicknessLabel,
                widthMm: part.preview.widthMm,
                heightMm: part.preview.heightMm,
                svgPath: part.preview.svgPath,
                elapsedMs: Math.round(performance.now() - t0),
            });
            setRun({ kind: 'idle' });
        } catch (err) {
            setRun({ kind: 'error', message: errorMessage(err) });
        }
    };

    useEffect(() => {
        if (firstBuild || started.current) return;
        started.current = true;
        void quoteSample();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="space-y-5">
            {firstBuild ? (
                <article className="overflow-hidden rounded-2xl bg-graphite-900 ring-1 ring-graphite-700" data-testid="first-build">
                    <div className="grid gap-0 sm:grid-cols-[1fr_1.1fr]">
                        <div className="aspect-[4/3] bg-graphite-850 p-5 sm:aspect-auto">
                            <FlatPattern preview={{ svgPath: firstBuild.svgPath, widthMm: firstBuild.widthMm, heightMm: firstBuild.heightMm, bendLines: [], outer: [], holes: [] }} />
                        </div>
                        <div className="p-5">
                            <p className="eyebrow">Wall bracket · 1 part</p>
                            <p className="mt-1 text-sm text-fg-muted">
                                {firstBuild.materialName} · {firstBuild.thicknessLabel}
                            </p>
                            <p className="mt-4 font-display text-4xl font-extrabold tabular" data-testid="first-build-price">
                                {money(firstBuild.subtotalCents, firstBuild.currency)}
                            </p>
                            <div className="mt-2">
                                <TrustChip level={firstBuild.trustLevel as TrustLevel} showOrderable />
                            </div>
                            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                                <div>
                                    <dt className="eyebrow">Ships</dt>
                                    <dd className="mt-0.5 text-fg">{shortDate(firstBuild.shipDate)}</dd>
                                </div>
                                <div>
                                    <dt className="eyebrow">Quoted in</dt>
                                    <dd className="mt-0.5 inline-flex items-center gap-1 text-fg" data-testid="first-build-elapsed">
                                        <Timer className="h-3.5 w-3.5 text-signal" aria-hidden />
                                        {(firstBuild.elapsedMs / 1000).toFixed(1)} s
                                    </dd>
                                </div>
                            </dl>
                            <Link href={partUrl(firstBuild.partId, firstBuild.quoteId)} className="mt-5 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg text-sm font-semibold text-signal hover:underline" data-testid="first-build-open">
                                Change material or quantity
                                <ArrowRight className="h-4 w-4" aria-hidden />
                            </Link>
                        </div>
                    </div>
                </article>
            ) : run.kind === 'error' ? (
                <Notice tone="error" title="We could not price the sample" action={<Button variant="secondary" size="sm" onClick={() => void quoteSample()}><RefreshCw className="h-4 w-4" aria-hidden />Try again</Button>}>
                    {run.message}
                </Notice>
            ) : (
                <div className="flex items-center gap-3 rounded-2xl bg-graphite-900 p-5 ring-1 ring-graphite-700" role="status" aria-live="polite" data-testid="first-build-running">
                    <Loader2 className="h-5 w-5 shrink-0 animate-spin text-signal" aria-hidden />
                    <span className="text-sm text-fg">{run.kind === 'running' ? run.label : 'Starting'}…</span>
                </div>
            )}

            <div className="rounded-2xl border border-dashed border-graphite-600 p-4">
                <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-signal">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-graphite-700 text-fg">
                        {own.busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <FileUp className="h-5 w-5" aria-hidden />}
                    </span>
                    <span className="min-w-0">
                        <span className="block font-semibold text-fg">Use my own file</span>
                        <span className="block text-sm text-fg-muted">{own.stage.kind === 'idle' ? 'A flat-pattern DXF, mm or inches' : stageLabel(own.stage)}</span>
                    </span>
                    <input
                        ref={ownInput}
                        type="file"
                        accept=".dxf,application/dxf,image/vnd.dxf"
                        className="sr-only"
                        disabled={own.busy}
                        data-testid="onboarding-own-file"
                        onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void own.start(f);
                            if (ownInput.current) ownInput.current.value = '';
                        }}
                    />
                </label>
                {own.stage.kind === 'error' && (
                    <p role="alert" className="mt-2 text-sm font-medium text-ember">
                        {own.stage.message}
                    </p>
                )}
            </div>
        </div>
    );
}
