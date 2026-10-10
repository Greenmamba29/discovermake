'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Sparkles } from 'lucide-react';
import { MAKE_AI_MAX_INPUT_CHARS, MakeAiIntakeRequest, MakeAiIntakeResponse } from '@/contracts/make-ai';
import { Button } from '@/components/ui/button';
import { Field, TextArea } from '@/components/ui/field';
import { Notice } from '@/components/ui/state';
import { apiFetch, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { CreationIntentView, EstimateBadge } from './creation-intent-view';

const STARTERS = [
    'A weatherproof outdoor enclosure for a Raspberry Pi with a solar battery.',
    'A replacement mounting bracket for a broken shelf, holds about 20 kg.',
    'A black acrylic display stand for three phones, 25 of them.',
] as const;

const fmt = new Intl.NumberFormat('en-US');

/** "What do you want to make?" box -> POST /api/make-ai/intake -> CreationIntent cards. */
export function MakeAiIntake({ initialText = '' }: { initialText?: string }) {
    const [text, setText] = useState(initialText);
    const [fieldError, setFieldError] = useState<string | null>(null);
    const [serverError, setServerError] = useState<string | null>(null);
    const [pending, setPending] = useState(false);
    const [result, setResult] = useState<MakeAiIntakeResponse | null>(null);
    const resultHeading = useRef<HTMLHeadingElement>(null);
    const abort = useRef<AbortController | null>(null);

    useEffect(() => () => abort.current?.abort(), []);
    useEffect(() => {
        if (result) resultHeading.current?.focus();
    }, [result]);

    const over = text.length > MAKE_AI_MAX_INPUT_CHARS;

    async function onSubmit(e: FormEvent) {
        e.preventDefault();
        const parsed = MakeAiIntakeRequest.safeParse({ text });
        if (!parsed.success) {
            setFieldError(parsed.error.issues[0]?.message ?? 'Describe what you want to make.');
            return;
        }
        abort.current?.abort();
        const controller = new AbortController();
        abort.current = controller;
        setFieldError(null);
        setServerError(null);
        setPending(true);
        try {
            const raw = await apiFetch<unknown>('/api/make-ai/intake', { body: parsed.data, signal: controller.signal });
            setResult(MakeAiIntakeResponse.parse(raw));
        } catch (err) {
            if ((err as Error)?.name === 'AbortError') return;
            setServerError(errorMessage(err));
        } finally {
            if (abort.current === controller) setPending(false);
        }
    }

    return (
        <div className="space-y-10">
            <form onSubmit={onSubmit} noValidate aria-busy={pending} className="space-y-4">
                <Field
                    label="What do you want to make?"
                    error={fieldError}
                    hint={
                        <span className={cn('font-mono', over && 'text-ember')}>
                            {fmt.format(text.length)} / {fmt.format(MAKE_AI_MAX_INPUT_CHARS)} characters. Include sizes, quantity and where it will be used if you know them.
                        </span>
                    }
                >
                    {({ id, describedBy, invalid }) => (
                        <TextArea
                            id={id}
                            name="text"
                            rows={5}
                            value={text}
                            maxLength={MAKE_AI_MAX_INPUT_CHARS}
                            onChange={(e) => setText(e.target.value)}
                            placeholder="e.g. A powder-coated steel wall bracket for a 600 mm shelf, 4 of them."
                            aria-describedby={describedBy}
                            aria-invalid={invalid || over || undefined}
                            readOnly={pending}
                            autoFocus
                            className="min-h-[140px] resize-y"
                        />
                    )}
                </Field>
                <div className="flex flex-wrap items-center gap-2">
                    <span className="eyebrow mr-1" id="starters-label">
                        Try
                    </span>
                    <ul aria-labelledby="starters-label" className="contents">
                        {STARTERS.map((s) => (
                            <li key={s}>
                                <button
                                    type="button"
                                    onClick={() => setText(s)}
                                    disabled={pending}
                                    className="rounded-lg bg-graphite-800 px-2.5 py-1.5 text-left text-xs text-fg-muted ring-1 ring-inset ring-graphite-600 transition-colors hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-signal disabled:opacity-60"
                                >
                                    {s}
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <Button type="submit" size="lg" loading={pending} disabled={over}>
                        {!pending && <Sparkles className="h-4 w-4" aria-hidden />}
                        {pending ? 'Planning…' : 'Plan it with Make AI'}
                    </Button>
                    <EstimateBadge />
                </div>
                <p className="sr-only" role="status" aria-live="polite">
                    {pending ? 'Make AI is reading your description.' : result ? 'Make AI plan ready.' : ''}
                </p>
            </form>

            {serverError && (
                <Notice tone="error" title="Make AI could not plan that">
                    {serverError}
                </Notice>
            )}

            {result && (
                <section aria-labelledby="make-ai-result">
                    <h2 id="make-ai-result" ref={resultHeading} tabIndex={-1} className="mb-4 font-display text-xl font-bold focus:outline-none">
                        Make AI plan
                    </h2>
                    <CreationIntentView key={result.intentId} intent={result.intent} model={result.model} intentId={result.intentId} />
                </section>
            )}
        </div>
    );
}
