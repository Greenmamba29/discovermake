'use client';

import Link from 'next/link';
import { forwardRef, useEffect, useRef, useState, type FormEvent } from 'react';
import { Bot, MessageCircle, Send, User } from 'lucide-react';
import type { LiveEvent, PollView, QuestionView } from '@/contracts/live';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { liveApi } from './live-api';

export type ComposerMode = 'chat' | 'creator' | 'make_ai';

/** Chat lines over the video (phones) or in the side column (desktop). */
export function ChatList({ lines, className }: { lines: LiveEvent[]; className?: string }) {
    const end = useRef<HTMLLIElement>(null);
    useEffect(() => {
        end.current?.scrollIntoView({ block: 'nearest' });
    }, [lines.length]);
    return (
        <ul className={cn('space-y-1 overflow-y-auto overscroll-contain', className)} aria-label="Live chat" aria-live="polite" data-testid="chat-list" tabIndex={0}>
            {lines.length === 0 && <li className="text-xs text-fg-subtle">No messages yet. Say hi.</li>}
            {lines.map((e) => {
                const system = e.actor.kind === 'system' || (e.payload as { system?: boolean }).system;
                return (
                    <li key={e.seq} className={cn('break-words text-sm leading-snug', system && 'text-fg-subtle')} data-testid="chat-line" data-seq={e.seq}>
                        {!system && <span className={cn('mr-1.5 font-semibold', e.actor.kind === 'host' ? 'text-signal' : 'text-fg')}>{e.actor.name ?? 'Viewer'}</span>}
                        <span className="text-fg-muted">{String((e.payload as { text?: unknown }).text ?? '')}</span>
                    </li>
                );
            })}
            <li ref={end} aria-hidden />
        </ul>
    );
}

/** Chat / Ask Creator / Ask Make AI composer. */
export const Composer = forwardRef<HTMLInputElement, { showId: string; signedIn: boolean; disabledReason?: string | null; onAsked?: (q: QuestionView) => void }>(function Composer({ showId, signedIn, disabledReason, onAsked }, ref) {
    const [mode, setMode] = useState<ComposerMode>('chat');
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!signedIn) {
        return (
            <p className="rounded-xl bg-graphite-900/90 px-3 py-2.5 text-sm text-fg-muted ring-1 ring-graphite-700" data-testid="composer-signed-out">
                <Link href={`/signin?next=${encodeURIComponent(`/live/${showId}`)}`} className="font-semibold text-fg underline underline-offset-2">
                    Sign in
                </Link>{' '}
                to chat, ask the creator or ask Make AI.
            </p>
        );
    }

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        const t = text.trim();
        if (!t) return;
        setBusy(true);
        setError(null);
        try {
            if (mode === 'chat') await liveApi.chat(showId, t);
            else {
                const r = await liveApi.ask(showId, mode, t);
                onAsked?.(r.question);
            }
            setText('');
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(false);
        }
    };

    const modes: { key: ComposerMode; label: string }[] = [
        { key: 'chat', label: 'Chat' },
        { key: 'creator', label: 'Ask Creator' },
        { key: 'make_ai', label: 'Ask Make AI' },
    ];
    const placeholder = mode === 'chat' ? 'Say something…' : mode === 'creator' ? 'Ask the creator…' : 'Ask Make AI about this build…';
    return (
        <form onSubmit={submit} className="rounded-xl bg-graphite-900/90 p-2 ring-1 ring-graphite-700 backdrop-blur" data-testid="composer">
            <div className="mb-2 flex gap-1" role="radiogroup" aria-label="Send as">
                {modes.map((m) => (
                    <button
                        key={m.key}
                        type="button"
                        role="radio"
                        aria-checked={mode === m.key}
                        onClick={() => setMode(m.key)}
                        className={cn('rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset', mode === m.key ? 'bg-signal text-signal-ink ring-signal' : 'text-fg-muted ring-graphite-600 hover:text-fg')}
                        data-testid={`composer-mode-${m.key}`}
                    >
                        {m.label}
                    </button>
                ))}
            </div>
            <div className="flex gap-2">
                <label className="sr-only" htmlFor={`composer-${showId}`}>
                    {placeholder}
                </label>
                <input
                    ref={ref}
                    id={`composer-${showId}`}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    maxLength={mode === 'chat' ? 300 : 500}
                    placeholder={disabledReason ?? placeholder}
                    disabled={busy || !!disabledReason}
                    className="h-10 min-w-0 flex-1 rounded-lg bg-graphite-850 px-3 text-sm text-fg ring-1 ring-inset ring-graphite-600 placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-signal"
                    data-testid="composer-input"
                />
                <button type="submit" disabled={busy || !text.trim() || !!disabledReason} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-signal text-signal-ink disabled:bg-graphite-600 disabled:text-fg-subtle" aria-label="Send" data-testid="composer-send">
                    <Send className="h-4 w-4" aria-hidden />
                </button>
            </div>
            {error && (
                <p className="mt-1.5 text-xs font-medium text-ember" role="alert" data-testid="composer-error">
                    {error}
                </p>
            )}
        </form>
    );
});

export function QuestionsList({ questions }: { questions: QuestionView[] }) {
    const ordered = [...questions].reverse();
    return (
        <section aria-labelledby="questions-heading" className="rounded-2xl bg-graphite-900 p-3 ring-1 ring-graphite-700 sm:p-4" data-testid="questions">
            <h2 id="questions-heading" className="flex items-center gap-2 font-display text-base font-bold">
                <MessageCircle className="h-4 w-4" aria-hidden /> Questions
            </h2>
            {ordered.length === 0 ? (
                <p className="mt-2 text-sm text-fg-muted">No questions yet. Ask the creator, or ask Make AI about the build on screen.</p>
            ) : (
                <ul className="mt-2 space-y-3">
                    {ordered.slice(0, 20).map((q) => (
                        <li key={q.id} className="text-sm" data-testid={`question-${q.id}`} data-mode={q.mode}>
                            <p className="text-fg">
                                <span className="font-semibold">{q.askedBy}</span>
                                <span className="ml-1.5 rounded bg-graphite-800 px-1.5 py-0.5 text-[11px] text-fg-muted">{q.mode === 'make_ai' ? 'Make AI' : 'Creator'}</span>
                                <span className="mt-0.5 block text-fg-muted">{q.text}</span>
                            </p>
                            {q.answer ? (
                                <p className="mt-1 flex gap-1.5 rounded-lg bg-graphite-850 p-2 text-fg" data-testid="question-answer">
                                    {q.answeredBy === 'make_ai' ? <Bot className="mt-0.5 h-4 w-4 shrink-0 text-signal" aria-label="Make AI" /> : <User className="mt-0.5 h-4 w-4 shrink-0 text-signal" aria-label="Host" />}
                                    <span>{q.answer}</span>
                                </p>
                            ) : (
                                <p className="mt-1 text-xs text-fg-subtle">Waiting for the creator</p>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

export function PollCard({ poll, showId, signedIn, onVoted }: { poll: PollView; showId: string; signedIn: boolean; onVoted: (p: PollView) => void }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const vote = async (i: number) => {
        setBusy(true);
        setError(null);
        try {
            onVoted((await liveApi.vote(showId, poll.id, i)).poll);
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(false);
        }
    };
    const voted = poll.viewerVote !== null;
    return (
        <section aria-labelledby={`poll-${poll.id}`} className="rounded-2xl bg-graphite-900 p-3 ring-1 ring-graphite-700 sm:p-4" data-testid="poll">
            <p className="eyebrow">Poll{poll.status === 'CLOSED' ? ' · closed' : ''}</p>
            <h2 id={`poll-${poll.id}`} className="mt-1 font-display text-base font-bold">
                {poll.question}
            </h2>
            <ul className="mt-2 space-y-1.5">
                {poll.options.map((o, i) => {
                    const pct = poll.total ? Math.round((o.votes / poll.total) * 100) : 0;
                    return (
                        <li key={o.label}>
                            <button
                                type="button"
                                disabled={!signedIn || voted || busy || poll.status !== 'OPEN'}
                                onClick={() => vote(i)}
                                className={cn('relative w-full overflow-hidden rounded-lg px-3 py-2 text-left text-sm ring-1 ring-inset ring-graphite-600', poll.viewerVote === i && 'ring-signal')}
                                data-testid={`poll-option-${i}`}
                            >
                                <span className="absolute inset-y-0 left-0 bg-graphite-750" style={{ width: `${pct}%` }} aria-hidden />
                                <span className="relative flex justify-between gap-2">
                                    <span>{o.label}</span>
                                    <span className="font-mono tabular text-fg-muted">{pct}%</span>
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ul>
            <p className="mt-1.5 text-xs text-fg-subtle">{poll.total} vote{poll.total === 1 ? '' : 's'}</p>
            {error && <p className="text-xs text-ember">{error}</p>}
        </section>
    );
}
