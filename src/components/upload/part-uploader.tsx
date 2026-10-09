'use client';

import { useRef, useState, type DragEvent } from 'react';
import { ArrowRight, FileUp, Loader2, Sparkles, UploadCloud } from 'lucide-react';
import { sampleBracketFile } from '@/lib/sample-dxf';
import { cn } from '@/lib/utils';
import { usePartUpload } from './use-part-upload';

/**
 * The single "What do you want to make?" drop zone (Uber "Where to?" pattern).
 * Real pipeline (usePartUpload): POST /api/parts -> PUT signed URL -> POST /api/parts/:id/analyze -> /parts/:id.
 */
export function PartUploader({ surface = 'graphite', size = 'lg', autoFocus = false }: { surface?: 'graphite' | 'paper'; size?: 'md' | 'lg'; autoFocus?: boolean }) {
    const inputRef = useRef<HTMLInputElement>(null);
    const { stage, busy, progressPct, start } = usePartUpload();
    const [dragging, setDragging] = useState(false);
    const paper = surface === 'paper';

    const run = async (file: File) => {
        await start(file);
        if (inputRef.current) inputRef.current.value = '';
    };

    const onDrop = (e: DragEvent) => {
        e.preventDefault();
        setDragging(false);
        if (busy) return;
        const file = e.dataTransfer.files?.[0];
        if (file) void run(file);
    };

    return (
        <div className="w-full">
            <div
                onDragOver={(e) => {
                    e.preventDefault();
                    if (!busy) setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={cn(
                    'group relative overflow-hidden rounded-2xl transition-all',
                    paper ? 'bg-paper-raised shadow-[0_1px_0_rgba(0,0,0,0.04),0_12px_40px_-16px_rgba(20,22,21,0.25)] ring-1 ring-paper-line' : 'bg-graphite-850 ring-1 ring-graphite-600',
                    dragging && (paper ? 'ring-2 ring-ink' : 'ring-2 ring-signal'),
                    size === 'lg' ? 'p-2' : 'p-1.5',
                )}
            >
                <label
                    className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-xl px-3 sm:gap-4 sm:px-4',
                        size === 'lg' ? 'min-h-[76px] py-3' : 'min-h-[60px] py-2',
                        busy && 'cursor-progress',
                        'focus-within:outline focus-within:outline-2 focus-within:outline-offset-2',
                        paper ? 'focus-within:outline-ink' : 'focus-within:outline-signal',
                    )}
                >
                    <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', paper ? 'bg-ink text-paper' : 'bg-signal text-signal-ink')}>
                        {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <UploadCloud className="h-5 w-5" aria-hidden />}
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className={cn('block truncate font-display text-base font-semibold sm:text-lg', paper ? 'text-ink' : 'text-fg')}>
                            {stage.kind === 'uploading' && `Uploading ${stage.filename}`}
                            {stage.kind === 'analyzing' && `Analyzing ${stage.filename}`}
                            {stage.kind === 'pricing' && `Pricing ${stage.filename}`}
                            {stage.kind === 'opening' && 'Opening your part'}
                            {(stage.kind === 'idle' || stage.kind === 'error') && (dragging ? 'Drop it here' : 'Drop a DXF, or browse your files')}
                        </span>
                        <span className={cn('block truncate text-sm', paper ? 'text-ink-muted' : 'text-fg-muted')}>
                            {stage.kind === 'uploading' && `${progressPct}% uploaded`}
                            {stage.kind === 'analyzing' && 'Reading geometry, holes and bend lines'}
                            {stage.kind === 'pricing' && 'Getting your instant quote'}
                            {stage.kind === 'opening' && 'Loading the configurator'}
                            {(stage.kind === 'idle' || stage.kind === 'error') && 'Flat pattern, mm or inches · up to 50 MB'}
                        </span>
                    </span>
                    <span className={cn('hidden items-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold sm:inline-flex', paper ? 'bg-paper text-ink ring-1 ring-paper-line' : 'bg-graphite-700 text-fg')}>
                        <FileUp className="h-4 w-4" aria-hidden />
                        Browse
                    </span>
                    <input
                        ref={inputRef}
                        type="file"
                        accept=".dxf,application/dxf,image/vnd.dxf"
                        className="sr-only"
                        data-testid="upload-input"
                        aria-label="Upload a DXF file"
                        autoFocus={autoFocus}
                        disabled={busy}
                        onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void run(f);
                        }}
                    />
                </label>
                {busy && (
                    <div className={cn('absolute inset-x-0 bottom-0 h-1', paper ? 'bg-paper-line' : 'bg-graphite-700')} role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPct}>
                        <div
                            className={cn('h-full transition-[width] duration-200', paper ? 'bg-ink' : 'bg-signal', stage.kind === 'analyzing' && 'animate-pulse')}
                            style={{ width: `${progressPct}%` }}
                        />
                    </div>
                )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm" aria-live="polite">
                {stage.kind === 'error' && (
                    <p role="alert" className={cn('w-full font-medium', paper ? 'text-[#9a3b0c]' : 'text-ember')} data-testid="upload-error">
                        {stage.message}
                    </p>
                )}
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run(sampleBracketFile())}
                    className={cn('inline-flex items-center gap-1.5 rounded-md font-medium underline-offset-4 hover:underline disabled:opacity-50', paper ? 'text-ink' : 'text-fg')}
                    data-testid="sample-part"
                >
                    <Sparkles className="h-4 w-4" aria-hidden />
                    No file handy? Try a sample mounting plate
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </button>
            </div>
        </div>
    );
}
