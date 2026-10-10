'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';
import type { CreateQuoteRequest, PartView, QuoteView } from '@/contracts';
import { MAX_PART_UPLOAD_BYTES } from '@/contracts/parts';
import { api, ApiClientError, errorMessage, putSigned } from '@/lib/api';

/**
 * The ONE DXF upload pipeline in the browser (instant quote, workflow 02):
 *   POST /api/parts -> PUT signed URL (fallback: POST /api/parts/:id/upload) -> POST /api/parts/:id/analyze
 * Every entry point (Home intake, /make, Discover starters, onboarding's first build) uses it.
 */

export type UploadStage =
    | { kind: 'idle' }
    | { kind: 'uploading'; filename: string; progress: number }
    | { kind: 'analyzing'; filename: string }
    | { kind: 'pricing'; filename: string }
    | { kind: 'opening'; filename: string }
    | { kind: 'error'; message: string };

/** Material + thickness (+ options) to price with right after analysis. Ids only, never prices. */
export type QuotePreset = Omit<CreateQuoteRequest, 'partId'>;

export function validateDxfFile(file: File): string | null {
    if (!/\.dxf$/i.test(file.name)) {
        if (/\.(step|stp|iges|igs|stl|3mf|obj)$/i.test(file.name)) return 'STEP, STL and other 3D formats are coming soon. Instant quotes take flat DXF files today.';
        return 'Instant quotes take .dxf files (ASCII DXF, R12–R2018). Export your flat pattern as DXF and try again.';
    }
    if (file.size === 0) return 'That file is empty.';
    if (file.size > MAX_PART_UPLOAD_BYTES) return `That file is larger than ${MAX_PART_UPLOAD_BYTES / 1024 / 1024} MB.`;
    return null;
}

/** Upload + analyze one DXF. Throws ApiClientError / Error with a plain-language message. */
export async function uploadAndAnalyze(file: File, onProgress?: (fraction: number) => void, onAnalyzing?: () => void): Promise<PartView> {
    const created = await api.createPart({ filename: file.name, contentType: file.type || 'application/dxf', sizeBytes: file.size });
    try {
        await putSigned(created.upload, file, onProgress);
    } catch (putErr) {
        // Signed PUT unavailable (e.g. object storage CORS): fall back to the direct upload route.
        if (file.size > MAX_PART_UPLOAD_BYTES || (putErr instanceof ApiClientError && putErr.status === 413)) throw putErr;
        const form = new FormData();
        form.append('file', file, file.name);
        const res = await fetch(`/api/parts/${encodeURIComponent(created.partId)}/upload`, { method: 'POST', body: form });
        if (!res.ok) throw putErr;
    }
    onAnalyzing?.();
    return api.analyzePart(created.partId, {});
}

/** Price an analyzed part with a preset. Returns null when the part cannot be priced instantly. */
export async function quotePreset(part: PartView, preset: QuotePreset): Promise<QuoteView | null> {
    if (part.status !== 'READY') return null;
    return api.createQuote({ ...preset, partId: part.id });
}

/** Configurator URL for a part, prefilled from a quote when there is one. */
export function partUrl(partId: string, quoteId?: string | null): string {
    return `/parts/${encodeURIComponent(partId)}${quoteId ? `?from=${encodeURIComponent(quoteId)}` : ''}`;
}

/**
 * Hook: run the pipeline and open the configurator (`/parts/:id`). With a preset, the part is
 * priced first and the configurator opens prefilled with that quote (`?from=`).
 */
export function usePartUpload() {
    const router = useRouter();
    const [stage, setStage] = useState<UploadStage>({ kind: 'idle' });
    const running = useRef(false);
    const busy = stage.kind === 'uploading' || stage.kind === 'analyzing' || stage.kind === 'pricing' || stage.kind === 'opening';

    const start = useCallback(
        async (file: File, preset?: QuotePreset) => {
            if (running.current) return;
            const invalid = validateDxfFile(file);
            if (invalid) {
                setStage({ kind: 'error', message: invalid });
                return;
            }
            running.current = true;
            setStage({ kind: 'uploading', filename: file.name, progress: 0 });
            try {
                const part = await uploadAndAnalyze(
                    file,
                    (p) => setStage({ kind: 'uploading', filename: file.name, progress: p }),
                    () => setStage({ kind: 'analyzing', filename: file.name }),
                );
                let quoteId: string | null = null;
                if (preset && part.status === 'READY') {
                    setStage({ kind: 'pricing', filename: file.name });
                    // A preset that does not price (e.g. a REVIEW config) still opens the configurator.
                    quoteId = (await quotePreset(part, preset).catch(() => null))?.id ?? null;
                }
                setStage({ kind: 'opening', filename: file.name });
                router.push(partUrl(part.id, quoteId));
            } catch (err) {
                setStage({ kind: 'error', message: errorMessage(err) });
            } finally {
                running.current = false;
            }
        },
        [router],
    );

    const reset = useCallback(() => setStage({ kind: 'idle' }), []);
    const progressPct = stage.kind === 'uploading' ? Math.round(stage.progress * 100) : stage.kind === 'idle' || stage.kind === 'error' ? 0 : 100;
    return { stage, busy, progressPct, start, reset };
}

/** One-line description of an upload stage for status text. */
export function stageLabel(stage: UploadStage): string {
    switch (stage.kind) {
        case 'uploading':
            return `Uploading ${stage.filename} · ${Math.round(stage.progress * 100)}%`;
        case 'analyzing':
            return `Analyzing ${stage.filename}: geometry, holes and bend lines`;
        case 'pricing':
            return `Pricing ${stage.filename}`;
        case 'opening':
            return 'Opening your instant quote';
        case 'error':
            return stage.message;
        default:
            return '';
    }
}
