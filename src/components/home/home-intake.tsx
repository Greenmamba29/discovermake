'use client';

import { useRouter } from 'next/navigation';
import { useId, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { ArrowRight, Loader2, Paperclip, Sparkles } from 'lucide-react';
import { MAKE_AI_MAX_INPUT_CHARS } from '@/contracts/make-ai';
import { stageLabel, usePartUpload } from '@/components/upload/use-part-upload';
import { sampleBracketFile } from '@/lib/sample-dxf';
import { cn } from '@/lib/utils';
import { routeIntake } from './intake';

/**
 * Home intake (workflow 10, Uber "Booking a ride"): ONE "What do you want to make?" bar.
 * - Typed text → Make AI, prefilled (`/make/ai?prompt=…`).
 * - Attach or drop a DXF → the instant-quote pipeline (usePartUpload) → `/parts/:id`.
 */
export function HomeIntake({ makeAiEnabled }: { makeAiEnabled: boolean }) {
    const router = useRouter();
    const inputId = useId();
    const hintId = `${inputId}-hint`;
    const fileRef = useRef<HTMLInputElement>(null);
    const [text, setText] = useState('');
    const [dragging, setDragging] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const upload = usePartUpload();
    const busy = upload.busy;

    const go = (input: { text: string; file?: File | null }) => {
        const route = routeIntake({ ...input, makeAiEnabled });
        setMessage(null);
        if (route.kind === 'upload') {
            void upload.start(route.file);
        } else if (route.kind === 'make-ai') {
            router.push(route.href);
        } else if (route.kind === 'empty') {
            setMessage('Describe what you want to make, or attach a DXF for an instant quote.');
        } else {
            setMessage('Describing a part is in private preview on this site. Attach a DXF for an instant binding quote, or start from a Discover design.');
        }
    };

    const onSubmit = (e: FormEvent) => {
        e.preventDefault();
        if (!busy) go({ text });
    };

    const onDrop = (e: DragEvent) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file && !busy) go({ text, file });
    };

    const status = upload.stage.kind === 'idle' ? null : stageLabel(upload.stage);
    const error = upload.stage.kind === 'error' ? upload.stage.message : message;

    return (
        <div className="w-full" data-testid="home-intake">
            <form
                onSubmit={onSubmit}
                aria-label="What do you want to make?"
                noValidate
                onDragOver={(e) => {
                    e.preventDefault();
                    if (!busy) setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={cn(
                    'relative flex items-center gap-1.5 rounded-2xl bg-paper-raised p-1.5 shadow-[0_1px_0_rgba(0,0,0,0.04),0_12px_40px_-16px_rgba(20,22,21,0.25)] ring-1 ring-paper-line transition-shadow sm:gap-2 sm:p-2',
                    'focus-within:ring-2 focus-within:ring-ink',
                    dragging && 'ring-2 ring-ink',
                )}
                data-testid="intake-bar"
            >
                <label
                    className={cn(
                        'flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-ink text-paper transition-colors hover:bg-black sm:h-14 sm:w-14',
                        'focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#1d6b3a]',
                        busy && 'cursor-progress',
                    )}
                    title="Attach a DXF"
                >
                    {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Paperclip className="h-5 w-5" aria-hidden />}
                    <input
                        ref={fileRef}
                        type="file"
                        accept=".dxf,application/dxf,image/vnd.dxf"
                        className="sr-only"
                        data-testid="upload-input"
                        aria-label="Attach a DXF for an instant quote"
                        disabled={busy}
                        onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) go({ text, file: f });
                            if (fileRef.current) fileRef.current.value = '';
                        }}
                    />
                </label>
                <label htmlFor={inputId} className="sr-only">
                    Describe what you want to make
                </label>
                <input
                    id={inputId}
                    type="text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    maxLength={MAKE_AI_MAX_INPUT_CHARS}
                    placeholder={dragging ? 'Drop your DXF for an instant quote' : 'A wall bracket for a 600 mm shelf…'}
                    aria-describedby={hintId}
                    autoComplete="off"
                    enterKeyHint="go"
                    readOnly={busy}
                    className="h-12 min-w-0 flex-1 bg-transparent px-1 font-display text-base text-ink placeholder:text-ink-subtle focus:outline-none sm:h-14 sm:text-lg"
                    data-testid="intake-text"
                />
                <button
                    type="submit"
                    disabled={busy}
                    className="inline-flex h-12 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-ink px-3.5 text-sm font-semibold text-paper transition-colors hover:bg-black disabled:opacity-60 sm:h-14 sm:px-5 sm:text-base"
                    data-testid="intake-submit"
                >
                    <span className="hidden sm:inline">Make it</span>
                    <ArrowRight className="h-5 w-5" aria-hidden />
                    <span className="sr-only sm:hidden">Make it</span>
                </button>
            </form>
            <p id={hintId} className="mt-2.5 text-sm text-ink-muted">
                Type an idea for Make AI, or attach a flat-pattern DXF <span className="whitespace-nowrap">(mm or inches)</span> for an instant binding quote. You can also drop the file on the bar.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm" aria-live="polite">
                {status && upload.stage.kind !== 'error' && (
                    <p className="w-full font-medium text-ink" data-testid="intake-status">
                        {status}
                    </p>
                )}
                {error && (
                    <p role="alert" className="w-full font-medium text-[#9a3b0c]" data-testid="upload-error">
                        {error}
                    </p>
                )}
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => go({ text: '', file: sampleBracketFile() })}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md font-medium text-ink underline-offset-4 hover:underline disabled:opacity-50"
                    data-testid="sample-part"
                >
                    <Sparkles className="h-4 w-4" aria-hidden />
                    No file handy? Quote our sample bracket
                </button>
            </div>
        </div>
    );
}
