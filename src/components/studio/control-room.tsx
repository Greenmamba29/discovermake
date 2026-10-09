'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ExternalLink, Factory, MessageSquareText, Radio, Shield, Star } from 'lucide-react';
import type { ControlRoomView, FeaturedProduct, HostIntent, QuestionView } from '@/contracts/live';
import { Button, buttonClass } from '@/components/ui/button';
import { ConfirmAction } from '@/components/ui/confirm-action';
import { Field, SelectInput, TextInput } from '@/components/ui/field';
import { ErrorState, Notice } from '@/components/ui/state';
import { PageSkeleton } from '@/components/ui/skeleton';
import { ApiClientError, errorMessage } from '@/lib/api';
import { money } from '@/lib/format';
import { cn } from '@/lib/utils';
import { liveApi } from '@/components/live/live-api';
import { LiveBadge } from '@/components/live/live-badge';
import { visibleChat } from '@/components/live/live-state';
import { useLiveShow } from '@/components/live/use-live-show';
import { ClipStudio } from '@/components/media/clip-studio';
import { AuctionPanel } from './auction-panel';
import { GoLiveChecklist } from './go-live-checklist';
import { parseBuildIds } from './studio-home';

/**
 * Live Show Control (workflow 08): every action is a host intent; the server validates it
 * and emits the signed events viewers see. Live state comes from the same event stream.
 */
export function ControlRoom({ showId }: { showId: string }) {
    const control = useQuery({ queryKey: ['live-control', showId], queryFn: () => liveApi.control(showId), retry: false });
    const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const live = useLiveShow(showId, {
        onEvent: () => {
            if (refetchTimer.current) clearTimeout(refetchTimer.current);
            refetchTimer.current = setTimeout(() => void control.refetch(), 400);
        },
    });
    const [busy, setBusy] = useState<string | null>(null);
    const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
    useEffect(() => () => (refetchTimer.current ? clearTimeout(refetchTimer.current) : undefined), []);

    const send = async (key: string, intent: HostIntent, ok?: string) => {
        setBusy(key);
        setMessage(null);
        try {
            await liveApi.intent(showId, intent);
            if (ok) setMessage({ tone: 'success', text: ok });
            await Promise.all([control.refetch(), intent.intent === 'start_show' || intent.intent === 'end_show' ? live.refetch() : Promise.resolve()]);
        } catch (err) {
            setMessage({ tone: 'error', text: errorMessage(err) });
        } finally {
            setBusy(null);
        }
    };

    if (control.isLoading) return <PageSkeleton label="Opening the control room" />;
    if (control.error || !control.data) {
        const status = control.error instanceof ApiClientError ? control.error.status : 0;
        return (
            <ErrorState
                title={status === 401 ? 'Sign in to run this show' : status === 403 ? 'This is not your show' : 'Control room unavailable'}
                message={status === 403 ? 'Only the channel owner can open its control room.' : errorMessage(control.error)}
                action={
                    <Link href="/studio" className={buttonClass('secondary')}>
                        Back to Creator Studio
                    </Link>
                }
            />
        );
    }
    const data = control.data;
    // Ended shows: the hook folds the replay log at position 0; the control room shows the final state.
    const liveState = live.isReplay ? null : live.state;
    const show = liveState?.show ?? data.snapshot.show;
    const drop = liveState?.drop ?? data.snapshot.drop;
    const chat = liveState ? visibleChat(liveState) : data.snapshot.recentChat;
    const questions = liveState?.questions ?? data.snapshot.questions;
    const featuredNow = liveState?.featured ?? data.snapshot.featured;
    const ended = show.status === 'ENDED' || show.status === 'CANCELLED';

    return (
        <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6" data-testid="control-room" data-status={show.status}>
            <Link href="/studio" className="text-sm text-fg-muted hover:text-fg">
                ← Creator Studio
            </Link>
            <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="eyebrow">Control room · {show.displayId}</p>
                    <h1 className="mt-1 font-display font-wide text-2xl font-extrabold sm:text-3xl">{show.title}</h1>
                    <div className="mt-2 flex items-center gap-2">
                        <LiveBadge status={show.status} viewerCount={show.viewerCount} />
                        <Link href={`/live/${showId}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
                            Open viewer <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                        </Link>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    {show.status === 'SCHEDULED' && (
                        <ConfirmAction label="Start show" confirmLabel="Go live" prompt="Go live now? Viewers see the show immediately." onConfirm={() => send('start', { intent: 'start_show' }, 'You are live.')} loading={busy === 'start'} testId="start-show" icon={<Radio className="h-4 w-4" aria-hidden />} />
                    )}
                    {show.status === 'LIVE' && <ConfirmAction label="End show" confirmLabel="End show" variant="caution" prompt="End the show for everyone? It becomes a shoppable replay." onConfirm={() => send('end', { intent: 'end_show' }, 'Show ended.')} loading={busy === 'end'} testId="end-show" />}
                </div>
            </div>
            {message && (
                <Notice tone={message.tone} className="mt-4" testId="control-message">
                    {message.text}
                </Notice>
            )}

            <Stats stats={data.stats} />

            <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
                <div className="min-w-0 space-y-6">
                    <FeaturedPanel showId={showId} items={data.featuredBuilds} currentBuildId={featuredNow?.buildId ?? null} disabled={ended} busy={busy} onFeature={(b) => send(`feature-${b}`, { intent: 'feature_product', buildId: b })} onAdded={() => void control.refetch()} />
                    {ended && <ClipStudio showId={showId} />}
                    <DropPanel drop={drop} featured={data.featuredBuilds} disabled={ended} busy={busy} send={send} />
                    <AuctionPanel auction={liveState?.auction ?? data.snapshot.auction ?? null} featured={data.featuredBuilds} disabled={ended} busy={busy} send={send} />
                    <QuestionQueue questions={questions} busy={busy} onAnswer={(id, answer) => send(`answer-${id}`, { intent: 'answer_question', questionId: id, answer }, 'Answer sent.')} />
                    <PollPanel disabled={ended} busy={busy} onCreate={(question, options) => send('poll', { intent: 'create_poll', question, options }, 'Poll is live.')} poll={liveState?.poll ?? data.snapshot.poll} />
                </div>
                <aside className="space-y-6">
                    <GoLiveChecklist checklist={data.checklist} />
                    <ModerationPanel chat={chat} slowMode={liveState?.slowModeSeconds ?? data.snapshot.slowModeSeconds} mutes={data.mutes} disabled={ended} busy={busy} send={send} />
                    <MilestonePanel disabled={show.status !== 'LIVE'} busy={busy} send={send} />
                </aside>
            </div>
        </div>
    );
}

function Stats({ stats }: { stats: ControlRoomView['stats'] }) {
    const tiles = [
        { label: 'Watching', value: String(stats.viewerCount), sub: `peak ${stats.peakViewers}` },
        { label: 'Likes', value: String(stats.likeCount) },
        { label: 'Chat', value: String(stats.chatCount) },
        { label: 'Questions', value: String(stats.questionCount), sub: `${stats.openQuestionCount} open` },
        { label: 'Slots held', value: String(stats.slotsClaimed), sub: `${stats.orderCount} orders` },
        { label: 'Slot revenue', value: money(stats.slotRevenueCents) },
    ];
    return (
        <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="live-stats">
            {tiles.map((t) => (
                <div key={t.label} className="rounded-xl bg-graphite-900 p-3 ring-1 ring-graphite-700">
                    <dt className="text-xs text-fg-muted">{t.label}</dt>
                    <dd className="font-display text-xl font-bold tabular">{t.value}</dd>
                    {t.sub && <dd className="text-xs text-fg-subtle">{t.sub}</dd>}
                </div>
            ))}
        </dl>
    );
}

function FeaturedPanel({ showId, items, currentBuildId, disabled, busy, onFeature, onAdded }: { showId: string; items: FeaturedProduct[]; currentBuildId: string | null; disabled: boolean; busy: string | null; onFeature: (buildId: string) => void; onAdded: () => void }) {
    const [text, setText] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);
    const add = async (e: FormEvent) => {
        e.preventDefault();
        const ids = parseBuildIds(text);
        if (!ids.length) return setError('Paste a build link or id (bld_…).');
        setAdding(true);
        setError(null);
        try {
            await liveApi.updateShow(showId, { featuredBuildIds: [...new Set([...items.map((i) => i.buildId), ...ids])] });
            setText('');
            onAdded();
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setAdding(false);
        }
    };
    return (
        <section aria-labelledby="featured-heading" className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700" data-testid="featured-panel">
            <h2 id="featured-heading" className="flex items-center gap-2 font-display text-lg font-bold">
                <Star className="h-5 w-5 text-fg-muted" aria-hidden /> Products
            </h2>
            {items.length === 0 ? (
                <p className="mt-2 text-sm text-fg-muted">Add the builds you will show. Featuring one pins it on every viewer&apos;s NOW SHOWING card.</p>
            ) : (
                <ul className="mt-3 space-y-2">
                    {items.map((f) => {
                        const current = f.buildId === currentBuildId;
                        return (
                            <li key={f.buildId} className={cn('flex flex-wrap items-center justify-between gap-2 rounded-xl p-3 ring-1 ring-inset', current ? 'bg-signal/10 ring-signal/40' : 'ring-graphite-700')} data-testid={`featured-${f.buildId}`}>
                                <div className="min-w-0">
                                    <p className="truncate font-semibold">
                                        {f.name} <span className="font-mono text-xs text-fg-subtle">{f.displayId}</span>
                                    </p>
                                    <p className="text-xs text-fg-muted">
                                        {f.priceCents !== null ? `${money(f.priceCents)} · ` : ''}
                                        {f.canBuy ? 'Binding quote ready' : 'No binding quote'}
                                        {f.hasApprovedVersion ? ' · approved design' : ''}
                                    </p>
                                </div>
                                {current ? (
                                    <span className="text-xs font-semibold text-signal">Now showing</span>
                                ) : (
                                    <Button size="sm" variant="secondary" disabled={disabled} loading={busy === `feature-${f.buildId}`} onClick={() => onFeature(f.buildId)} data-testid={`feature-${f.buildId}`}>
                                        Feature
                                    </Button>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
            {!disabled && (
                <form onSubmit={add} className="mt-3 flex gap-2">
                    <label htmlFor="add-build" className="sr-only">
                        Add a build
                    </label>
                    <TextInput id="add-build" placeholder="Paste a build link or id" value={text} onChange={(e) => setText(e.target.value)} data-testid="add-build-input" />
                    <Button type="submit" variant="secondary" loading={adding} data-testid="add-build-submit">
                        Add
                    </Button>
                </form>
            )}
            {error && <p className="mt-2 text-xs text-ember">{error}</p>}
        </section>
    );
}

function DropPanel({ drop, featured, disabled, busy, send }: { drop: ControlRoomView['snapshot']['drop']; featured: FeaturedProduct[]; disabled: boolean; busy: string | null; send: (k: string, i: HostIntent, ok?: string) => Promise<void> }) {
    const buyable = featured.filter((f) => f.canBuy);
    const [buildId, setBuildId] = useState('');
    const [price, setPrice] = useState('');
    const [total, setTotal] = useState('50');
    const [threshold, setThreshold] = useState('10');
    const [limit, setLimit] = useState('2');
    const [minutes, setMinutes] = useState('30');
    const [fairQueue, setFairQueue] = useState(false);
    const selected = buyable.find((f) => f.buildId === (buildId || buyable[0]?.buildId));
    const open = drop?.status === 'OPEN';

    const start = (e: FormEvent) => {
        e.preventDefault();
        if (!selected) return;
        void send(
            'drop',
            {
                intent: 'start_drop',
                buildId: selected.buildId,
                priceCents: Math.round(Number(price) * 100),
                totalSlots: Number(total),
                thresholdSlots: Number(threshold),
                perBuyerLimit: Number(limit),
                durationMinutes: Number(minutes),
                ...(fairQueue ? { fairQueue: true } : {}),
            },
            fairQueue ? 'Drop is live with a fair queue.' : 'Drop is live.',
        );
    };
    return (
        <section aria-labelledby="drop-heading" className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700" data-testid="drop-panel">
            <h2 id="drop-heading" className="flex items-center gap-2 font-display text-lg font-bold">
                <Factory className="h-5 w-5 text-fg-muted" aria-hidden /> Live drop · Build Slots
            </h2>
            {drop && (
                <div className="mt-3 rounded-xl bg-graphite-850 p-3 ring-1 ring-graphite-700" data-testid="control-drop" data-status={drop.status}>
                    <p className="font-semibold">
                        {drop.title} · {money(drop.priceCents)}
                    </p>
                    <p className="text-sm text-fg-muted" data-testid="control-drop-count">
                        {drop.claimedSlots} / {drop.totalSlots} claimed · production at {drop.thresholdSlots} · {drop.status === 'OPEN' ? `closes ${new Date(drop.closesAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : drop.status.toLowerCase()}
                    </p>
                    {open && (
                        <div className="mt-3">
                            <ConfirmAction
                                label="Close drop"
                                confirmLabel="Close now"
                                variant="caution"
                                prompt={drop.claimedSlots >= drop.thresholdSlots ? 'Close and capture every authorized slot? Orders go to production.' : 'Below the threshold: closing releases every hold. Close anyway?'}
                                onConfirm={() => send('close-drop', { intent: 'close_drop' }, 'Drop closed.')}
                                loading={busy === 'close-drop'}
                                testId="close-drop"
                            />
                        </div>
                    )}
                </div>
            )}
            {!open && !disabled && (
                <form onSubmit={start} className="mt-3 space-y-3" data-testid="drop-form">
                    {buyable.length === 0 ? (
                        <p className="text-sm text-fg-muted">A drop needs a featured build with an orderable binding quote.</p>
                    ) : (
                        <>
                            <Field label="Build">
                                {({ id }) => (
                                    <SelectInput id={id} value={selected?.buildId ?? ''} onChange={(e) => setBuildId(e.target.value)} data-testid="drop-build">
                                        {buyable.map((f) => (
                                            <option key={f.buildId} value={f.buildId}>
                                                {f.name}
                                            </option>
                                        ))}
                                    </SelectInput>
                                )}
                            </Field>
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                                <Field label="Price per slot ($)" hint={selected?.priceCents ? `Unit price at quote qty: ${money(selected.priceCents)}` : undefined}>
                                    {({ id, describedBy }) => <TextInput id={id} aria-describedby={describedBy} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} data-testid="drop-price" />}
                                </Field>
                                <Field label="Slots">{({ id }) => <TextInput id={id} inputMode="numeric" value={total} onChange={(e) => setTotal(e.target.value)} data-testid="drop-total" />}</Field>
                                <Field label="Production at">{({ id }) => <TextInput id={id} inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value)} data-testid="drop-threshold" />}</Field>
                                <Field label="Per buyer">{({ id }) => <TextInput id={id} inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} data-testid="drop-limit" />}</Field>
                                <Field label="Minutes">{({ id }) => <TextInput id={id} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} data-testid="drop-minutes" />}</Field>
                            </div>
                            <label className="flex items-start gap-2 text-sm">
                                <input type="checkbox" checked={fairQueue} onChange={(e) => setFairQueue(e.target.checked)} className="mt-1" data-testid="drop-fair-queue" />
                                <span>
                                    <span className="font-medium">Fair queue for high demand</span>
                                    <span className="block text-xs text-fg-subtle">Claims that arrive in the same second are ordered at random, then admitted one by one; buyers see their place in line.</span>
                                </span>
                            </label>
                            <p className="text-xs text-fg-subtle">The price must cover the binding quote at the production quantity. Buyers are only charged if the drop reaches it.</p>
                            <Button type="submit" loading={busy === 'drop'} disabled={!price} data-testid="drop-start">
                                Start drop
                            </Button>
                        </>
                    )}
                </form>
            )}
        </section>
    );
}

function QuestionQueue({ questions, busy, onAnswer }: { questions: QuestionView[]; busy: string | null; onAnswer: (id: string, answer: string) => void }) {
    const open = questions.filter((q) => q.mode === 'creator' && !q.answer);
    const answered = questions.filter((q) => q.answer).slice(-6).reverse();
    return (
        <section aria-labelledby="queue-heading" className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700" data-testid="question-queue">
            <h2 id="queue-heading" className="flex items-center gap-2 font-display text-lg font-bold">
                <MessageSquareText className="h-5 w-5 text-fg-muted" aria-hidden /> Questions
            </h2>
            {open.length === 0 ? <p className="mt-2 text-sm text-fg-muted">No open questions.</p> : null}
            <ul className="mt-2 space-y-3">
                {open.map((q) => (
                    <AnswerRow key={q.id} q={q} busy={busy === `answer-${q.id}`} onAnswer={onAnswer} />
                ))}
            </ul>
            {answered.length > 0 && (
                <ul className="mt-4 space-y-2 border-t border-graphite-700 pt-3 text-sm">
                    {answered.map((q) => (
                        <li key={q.id}>
                            <p className="text-fg-muted">
                                {q.askedBy}: {q.text}
                            </p>
                            <p className="text-fg">
                                <span className="text-xs text-signal">{q.answeredBy === 'make_ai' ? 'Make AI' : 'You'}</span> {q.answer}
                            </p>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

function AnswerRow({ q, busy, onAnswer }: { q: QuestionView; busy: boolean; onAnswer: (id: string, answer: string) => void }) {
    const [text, setText] = useState('');
    return (
        <li className="rounded-xl p-3 ring-1 ring-inset ring-graphite-700" data-testid={`queue-${q.id}`}>
            <p className="text-sm">
                <span className="font-semibold">{q.askedBy}</span> <span className="text-fg-muted">{q.text}</span>
            </p>
            <form
                className="mt-2 flex gap-2"
                onSubmit={(e) => {
                    e.preventDefault();
                    if (text.trim()) onAnswer(q.id, text.trim());
                }}
            >
                <label htmlFor={`answer-${q.id}`} className="sr-only">
                    Answer {q.askedBy}
                </label>
                <TextInput id={`answer-${q.id}`} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your answer" data-testid={`answer-input-${q.id}`} />
                <Button type="submit" size="md" loading={busy} disabled={!text.trim()} data-testid={`answer-submit-${q.id}`}>
                    Answer
                </Button>
            </form>
        </li>
    );
}

function PollPanel({ disabled, busy, onCreate, poll }: { disabled: boolean; busy: string | null; onCreate: (question: string, options: string[]) => void; poll: ControlRoomView['snapshot']['poll'] }) {
    const [question, setQuestion] = useState('');
    const [options, setOptions] = useState(['', '', '', '']);
    const filled = options.map((o) => o.trim()).filter(Boolean);
    return (
        <section aria-labelledby="poll-heading" className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700" data-testid="poll-panel">
            <h2 id="poll-heading" className="font-display text-lg font-bold">
                Poll
            </h2>
            {poll && (
                <div className="mt-2 text-sm">
                    <p className="font-semibold">{poll.question}</p>
                    <ul className="mt-1 text-fg-muted">
                        {poll.options.map((o) => (
                            <li key={o.label}>
                                {o.label}: {o.votes}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {!disabled && (
                <form
                    className="mt-3 space-y-2"
                    onSubmit={(e) => {
                        e.preventDefault();
                        onCreate(question.trim(), filled);
                        setQuestion('');
                        setOptions(['', '', '', '']);
                    }}
                >
                    <Field label="Question">{({ id }) => <TextInput id={id} value={question} maxLength={140} onChange={(e) => setQuestion(e.target.value)} data-testid="poll-question" />}</Field>
                    <div className="grid grid-cols-2 gap-2">
                        {options.map((o, i) => (
                            <Field key={i} label={`Option ${i + 1}`} optional={i >= 2}>
                                {({ id }) => <TextInput id={id} value={o} maxLength={60} onChange={(e) => setOptions((cur) => cur.map((c, j) => (j === i ? e.target.value : c)))} data-testid={`poll-option-input-${i}`} />}
                            </Field>
                        ))}
                    </div>
                    <Button type="submit" variant="secondary" loading={busy === 'poll'} disabled={question.trim().length < 3 || filled.length < 2} data-testid="poll-create">
                        Start poll
                    </Button>
                </form>
            )}
        </section>
    );
}

function ModerationPanel({ chat, slowMode, mutes, disabled, busy, send }: { chat: ControlRoomView['snapshot']['recentChat']; slowMode: number; mutes: ControlRoomView['mutes']; disabled: boolean; busy: string | null; send: (k: string, i: HostIntent, ok?: string) => Promise<void> }) {
    const recent = useMemo(() => chat.filter((c) => c.actor.kind === 'viewer').slice(-8).reverse(), [chat]);
    return (
        <section aria-labelledby="mod-heading" className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700" data-testid="moderation-panel">
            <h2 id="mod-heading" className="flex items-center gap-2 font-display text-lg font-bold">
                <Shield className="h-5 w-5 text-fg-muted" aria-hidden /> Moderation
            </h2>
            <Field label="Slow mode" className="mt-3">
                {({ id }) => (
                    <SelectInput id={id} value={String(slowMode)} disabled={disabled || busy === 'slow'} onChange={(e) => void send('slow', { intent: 'slow_mode', seconds: Number(e.target.value) })} data-testid="slow-mode">
                        <option value="0">Off</option>
                        <option value="10">One message per 10 s</option>
                        <option value="30">One message per 30 s</option>
                        <option value="60">One message per minute</option>
                    </SelectInput>
                )}
            </Field>
            <p className="mt-2 text-xs text-fg-subtle">Keyword and link filters are always on. {mutes.length ? `${mutes.length} viewer${mutes.length === 1 ? '' : 's'} muted.` : ''}</p>
            <ul className="mt-3 space-y-2">
                {recent.length === 0 && <li className="text-sm text-fg-muted">No viewer messages yet.</li>}
                {recent.map((c) => (
                    <li key={c.seq} className="rounded-lg bg-graphite-850 p-2 text-sm" data-testid={`mod-line-${c.seq}`}>
                        <p className="break-words">
                            <span className="font-semibold">{c.actor.name ?? 'Viewer'}</span> <span className="text-fg-muted">{String((c.payload as { text?: unknown }).text ?? '')}</span>
                        </p>
                        {!disabled && (
                            <div className="mt-1.5 flex gap-2">
                                <Button size="sm" variant="ghost" onClick={() => void send(`remove-${c.seq}`, { intent: 'remove_chat', eventSeq: c.seq })} loading={busy === `remove-${c.seq}`} data-testid={`remove-${c.seq}`}>
                                    Remove
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => void send(`mute-${c.seq}`, { intent: 'mute_viewer', viewerId: c.actor.id, minutes: 10 }, `${c.actor.name ?? 'Viewer'} is muted for 10 minutes.`)} loading={busy === `mute-${c.seq}`} data-testid={`mute-${c.seq}`}>
                                    Mute 10 min
                                </Button>
                            </div>
                        )}
                    </li>
                ))}
            </ul>
        </section>
    );
}

const MILESTONES = [
    { event: 'machine.started', label: 'Machine started' },
    { event: 'machine.completed', label: 'Machine finished' },
    { event: 'inspection.passed', label: 'Inspection passed' },
    { event: 'prototype.completed', label: 'Prototype complete' },
] as const;

function MilestonePanel({ disabled, busy, send }: { disabled: boolean; busy: string | null; send: (k: string, i: HostIntent, ok?: string) => Promise<void> }) {
    return (
        <section aria-labelledby="ms-heading" className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700" data-testid="milestone-panel">
            <h2 id="ms-heading" className="font-display text-lg font-bold">
                Production milestones
            </h2>
            <p className="mt-1 text-xs text-fg-subtle">{disabled ? 'Available while you are live.' : 'Post what is happening on the floor.'}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
                {MILESTONES.map((m) => (
                    <Button key={m.event} size="sm" variant="secondary" disabled={disabled} loading={busy === m.event} onClick={() => void send(m.event, { intent: 'machine_milestone', event: m.event })} data-testid={`milestone-${m.event}`}>
                        {m.label}
                    </Button>
                ))}
            </div>
        </section>
    );
}
