'use client';

import { useId, useState, type FormEvent } from 'react';
import { CheckCircle2, CircleHelp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TextInput } from '@/components/ui/field';
import { Notice } from '@/components/ui/state';
import { StatusPill } from '@/components/ui/status-pill';
import type { UnknownInfo } from './workspace-model';
import type { WorkspaceAnswer } from './workspace-api';

const MAX_ANSWER_CHARS = 200;

function QuestionCard({ unknown, onAnswer, busy, readOnly }: { unknown: UnknownInfo; onAnswer: (a: WorkspaceAnswer) => void; busy: boolean; readOnly: boolean }) {
    const [value, setValue] = useState('');
    const [error, setError] = useState<string | null>(null);
    const inputId = useId();
    const errId = `${inputId}-err`;

    function submit(e: FormEvent) {
        e.preventDefault();
        const v = value.trim();
        if (!v) return setError('Type an answer, or use the suggested default.');
        if (v.length > MAX_ANSWER_CHARS) return setError(`Keep answers under ${MAX_ANSWER_CHARS} characters.`);
        setError(null);
        onAnswer({ unknownKey: unknown.key, value: v });
    }

    return (
        <li className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-amber/30 sm:p-5" data-testid={`question-${unknown.key}`}>
            <div className="flex items-start justify-between gap-3">
                <p className="font-semibold text-fg">{unknown.question}</p>
                <StatusPill status="NEEDS_INPUT" className="shrink-0 px-2 py-0.5 text-[10px]" />
            </div>
            {unknown.why && <p className="mt-1.5 text-sm text-fg-muted">{unknown.why}</p>}
            {readOnly ? (
                <p className="mt-3 text-xs text-fg-subtle">Open the current version to answer.</p>
            ) : (
                <>
                    {unknown.suggestedDefault ? (
                        <div className="mt-4 flex flex-wrap items-center gap-2">
                            <span className="eyebrow">Suggested</span>
                            <span className="text-sm text-fg">{unknown.suggestedDefault}</span>
                            <Button size="sm" variant="secondary" disabled={busy} onClick={() => onAnswer({ unknownKey: unknown.key, value: unknown.suggestedDefault! })}>
                                <CheckCircle2 className="h-4 w-4" aria-hidden />
                                Use this default
                            </Button>
                        </div>
                    ) : (
                        <p className="mt-3 text-xs text-fg-subtle">No safe default: we need your answer.</p>
                    )}
                    <form onSubmit={submit} noValidate className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start">
                        <div className="min-w-0 flex-1">
                            <label htmlFor={inputId} className="sr-only">
                                Your answer: {unknown.question}
                            </label>
                            <TextInput
                                id={inputId}
                                value={value}
                                maxLength={MAX_ANSWER_CHARS}
                                onChange={(e) => setValue(e.target.value)}
                                placeholder={unknown.suggestedDefault ? 'Or type your own answer' : 'Type your answer'}
                                aria-invalid={error ? true : undefined}
                                aria-describedby={error ? errId : undefined}
                                disabled={busy}
                            />
                            {error && (
                                <p id={errId} role="alert" className="mt-1.5 text-xs font-medium text-ember">
                                    {error}
                                </p>
                            )}
                        </div>
                        <Button type="submit" disabled={busy}>
                            Save answer
                        </Button>
                    </form>
                </>
            )}
        </li>
    );
}

/**
 * NEEDS_INPUT question cards (workflow 01 rule 1): one tap accepts the suggested default,
 * or the buyer types a value. Every answer writes a new design version on the server.
 */
export function QuestionCards({
    open,
    answered,
    onAnswer,
    pending,
    error,
    readOnly = false,
}: {
    open: UnknownInfo[];
    answered: UnknownInfo[];
    onAnswer: (answers: WorkspaceAnswer[]) => void;
    pending: boolean;
    error?: string | null;
    readOnly?: boolean;
}) {
    return (
        <div className="space-y-5">
            {error && (
                <Notice tone="error" title="Your answer was not saved">
                    {error}
                </Notice>
            )}
            {open.length === 0 ? (
                <Notice tone="success" title="No open questions">
                    Every question Make AI asked is answered.
                </Notice>
            ) : (
                <ul className="space-y-3" aria-busy={pending}>
                    {open.map((u) => (
                        <QuestionCard key={u.key} unknown={u} busy={pending} readOnly={readOnly} onAnswer={(a) => onAnswer([a])} />
                    ))}
                </ul>
            )}
            {answered.length > 0 && (
                <section aria-labelledby="answered-questions">
                    <h3 id="answered-questions" className="eyebrow">
                        Answered ({answered.length})
                    </h3>
                    <ul className="mt-2 divide-y divide-graphite-700 rounded-2xl bg-graphite-900 ring-1 ring-graphite-700">
                        {answered.map((u) => (
                            <li key={u.key} className="flex items-start gap-3 p-4 text-sm">
                                <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" aria-hidden />
                                <div className="min-w-0">
                                    <p className="text-fg-muted">{u.question}</p>
                                    <p className="mt-0.5 font-semibold text-fg">
                                        {u.answer ?? 'Answered'}
                                        {u.usedDefault && <span className="ml-2 font-mono text-[11px] font-normal text-fg-subtle">default</span>}
                                    </p>
                                </div>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </div>
    );
}
