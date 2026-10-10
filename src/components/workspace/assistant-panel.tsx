'use client';

/**
 * Ask Make AI (300-3): questions and change requests about this build, scoped to its latest
 * design version. Answers are grounded on the Build Graph (requirements, materials, open
 * questions). A change request comes back as a proposal; nothing changes until the buyer
 * confirms it, which writes a NEW design version. With Make AI off (or no model key) the panel
 * says so plainly and the buyer can still add a requirement by hand.
 */
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, MessageSquareText, PlusCircle, Sparkles, X } from 'lucide-react';
import type { BuildGraphView } from '@/contracts';
import { REQUIREMENT_CATEGORIES, type RequirementCategory } from '@/contracts/make-ai';
import { ASSISTANT_MAX_MESSAGE_CHARS, type AssistantAskResponse, type AssistantProposal } from '@/contracts/workspace';
import { Button } from '@/components/ui/button';
import { Field, SelectInput, TextArea, TextInput } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { Notice } from '@/components/ui/state';
import { errorMessage } from '@/lib/api';
import { PanelCard } from './panels';
import { assistantQueryKey, workspaceApi } from './workspace-api';
import { latestVersion, nodesOf } from './workspace-model';

const SUGGESTIONS = ['What material is best for outdoor use?', 'Make it 20 mm wider', 'Which questions are still open?'];

const CATEGORY_LABEL: Record<RequirementCategory, string> = {
    function: 'Function',
    dimension: 'Dimension',
    material: 'Material',
    environment: 'Environment',
    finish: 'Finish',
    quantity: 'Quantity',
    budget: 'Budget',
    timeline: 'Timeline',
    compliance: 'Compliance',
    other: 'Other',
};

type Turn = { id: number; question: string; reply: Extract<AssistantAskResponse, { status: 'answered' }> | null; error: string | null; state: 'pending' | 'done' | 'confirmed' | 'dismissed'; savedVersion?: number };

function proposalText(p: AssistantProposal): string {
    return p.kind === 'answer_question' ? `Answer “${p.question}” with “${p.value}”.` : `Add the requirement “${p.text}” (${CATEGORY_LABEL[p.category].toLowerCase()}).`;
}

export function AssistantPanel({ view, isCurrent, onChanged }: { view: BuildGraphView; isCurrent: boolean; onChanged: (view: BuildGraphView) => void }) {
    const buildId = view.build.id;
    const version = latestVersion(view);
    const status = useQuery({ queryKey: assistantQueryKey(buildId), queryFn: ({ signal }) => workspaceApi.assistantStatus(buildId, signal) });
    const [message, setMessage] = useState('');
    const [turns, setTurns] = useState<Turn[]>([]);
    const [nextId, setNextId] = useState(1);

    const ask = useMutation({
        mutationFn: ({ text }: { id: number; text: string }) => workspaceApi.ask(buildId, text),
        onSuccess: (res, { id }) => {
            setTurns((ts) =>
                ts.map((t) => (t.id === id ? (res.status === 'answered' ? { ...t, reply: res, state: 'done' } : { ...t, error: res.reason, state: 'done' }) : t)),
            );
            if (res.status === 'unavailable') void status.refetch();
        },
        onError: (err, { id }) => setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, error: errorMessage(err), state: 'done' } : t))),
    });

    const confirm = useMutation({
        mutationFn: ({ turn }: { turn: Turn }) => workspaceApi.confirmProposal(buildId, turn.reply!.version, turn.reply!.proposal!),
        onSuccess: (next, { turn }) => {
            setTurns((ts) => ts.map((t) => (t.id === turn.id ? { ...t, state: 'confirmed', savedVersion: next.version.version } : t)));
            onChanged(next);
        },
    });

    const submit = (e: FormEvent) => {
        e.preventDefault();
        const text = message.trim();
        if (text.length < 2 || ask.isPending) return;
        const id = nextId;
        setNextId(id + 1);
        setTurns((ts) => [...ts, { id, question: text, reply: null, error: null, state: 'pending' }]);
        setMessage('');
        ask.mutate({ id, text });
    };

    const available = status.data?.available ?? false;
    const openCount = nodesOf(view, 'UNKNOWN').filter((n) => n.data.status === 'open').length;

    return (
        <div className="space-y-4" data-testid="workspace-assistant">
            <PanelCard title="Ask Make AI" icon={<Sparkles className="h-5 w-5" />}>
                <p className="text-sm text-fg-muted">
                    Scoped to <span className="font-mono text-fg">version {version}</span> of this build: {nodesOf(view, 'REQUIREMENT').length} requirements, {openCount} open question{openCount === 1 ? '' : 's'}. Answers are suggestions, not a quote, and nothing changes until you confirm it.
                </p>

                {status.isPending ? (
                    <Skeleton className="mt-4 h-24 w-full" />
                ) : status.isError ? (
                    <Notice tone="error" className="mt-4">
                        {errorMessage(status.error)}
                    </Notice>
                ) : !available ? (
                    <Notice tone="info" title="Make AI is unavailable" className="mt-4" testId="assistant-unavailable">
                        {status.data?.reason ?? 'Make AI cannot answer right now.'}
                    </Notice>
                ) : (
                    <form onSubmit={submit} className="mt-4 space-y-3" data-testid="assistant-form">
                        <Field label="Ask a question or request a change" hint="Sizes only change when you state them. Make AI will not guess a number for you.">
                            {({ id, describedBy }) => (
                                <TextArea
                                    id={id}
                                    aria-describedby={describedBy}
                                    value={message}
                                    maxLength={ASSISTANT_MAX_MESSAGE_CHARS}
                                    onChange={(e) => setMessage(e.target.value)}
                                    placeholder="e.g. Make it 20 mm wider, or: what material for outdoor use?"
                                    disabled={!isCurrent}
                                    data-testid="assistant-input"
                                />
                            )}
                        </Field>
                        <div className="flex flex-wrap gap-2">
                            {SUGGESTIONS.map((s) => (
                                <button
                                    key={s}
                                    type="button"
                                    onClick={() => setMessage(s)}
                                    className="rounded-full bg-graphite-850 px-3 py-1.5 text-xs text-fg-muted ring-1 ring-inset ring-graphite-700 hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                        <Button type="submit" loading={ask.isPending} disabled={!isCurrent || message.trim().length < 2} data-testid="assistant-ask">
                            <MessageSquareText className="h-4 w-4" aria-hidden />
                            Ask Make AI
                        </Button>
                    </form>
                )}
            </PanelCard>

            {turns.length > 0 && (
                <ol className="space-y-3" aria-label="Conversation" aria-live="polite" data-testid="assistant-turns">
                    {turns.map((t) => (
                        <li key={t.id} className="space-y-2">
                            <p className="ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-md bg-graphite-750 px-3.5 py-2 text-sm text-fg">{t.question}</p>
                            <div className="max-w-[95%] rounded-2xl rounded-bl-md bg-graphite-900 p-3.5 text-sm ring-1 ring-graphite-700" data-testid="assistant-reply">
                                {t.state === 'pending' && <p className="text-fg-muted">Make AI is reading the build…</p>}
                                {t.error && <p className="text-ember">{t.error}</p>}
                                {t.reply && (
                                    <>
                                        <p className="whitespace-pre-line text-fg">{t.reply.answer}</p>
                                        {t.reply.citedKeys.length > 0 && <p className="mt-2 font-mono text-[11px] text-fg-subtle">Based on {t.reply.citedKeys.join(', ')}</p>}
                                        {t.reply.guardNote && (
                                            <Notice tone="warning" className="mt-3" testId="assistant-guard-note">
                                                {t.reply.guardNote}
                                            </Notice>
                                        )}
                                        {t.reply.proposal && (
                                            <div className="mt-3 rounded-xl bg-graphite-850 p-3 ring-1 ring-inset ring-signal/30" data-testid="assistant-proposal">
                                                <p className="eyebrow">Proposed change</p>
                                                <p className="mt-1 text-fg">{proposalText(t.reply.proposal)}</p>
                                                {t.state === 'confirmed' ? (
                                                    <p className="mt-2 flex items-center gap-1.5 text-signal" data-testid="assistant-confirmed">
                                                        <Check className="h-4 w-4" aria-hidden /> Saved as version {t.savedVersion}.
                                                    </p>
                                                ) : t.state === 'dismissed' ? (
                                                    <p className="mt-2 text-fg-subtle">Dismissed. Nothing changed.</p>
                                                ) : (
                                                    <div className="mt-3 flex flex-wrap gap-2">
                                                        <Button size="sm" onClick={() => confirm.mutate({ turn: t })} loading={confirm.isPending && confirm.variables?.turn.id === t.id} disabled={!isCurrent || t.reply.version !== version} data-testid="assistant-confirm">
                                                            <Check className="h-4 w-4" aria-hidden />
                                                            Confirm as version {version + 1}
                                                        </Button>
                                                        <Button size="sm" variant="ghost" onClick={() => setTurns((ts) => ts.map((x) => (x.id === t.id ? { ...x, state: 'dismissed' } : x)))}>
                                                            <X className="h-4 w-4" aria-hidden />
                                                            Dismiss
                                                        </Button>
                                                    </div>
                                                )}
                                                {t.reply.version !== version && t.state === 'done' && <p className="mt-2 text-xs text-amber">The build changed since this suggestion. Ask again to apply it to version {version}.</p>}
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        </li>
                    ))}
                </ol>
            )}
            {confirm.isError && <Notice tone="error">{errorMessage(confirm.error)}</Notice>}

            <ManualRequirement view={view} isCurrent={isCurrent} onChanged={onChanged} />
        </div>
    );
}

function ManualRequirement({ view, isCurrent, onChanged }: { view: BuildGraphView; isCurrent: boolean; onChanged: (view: BuildGraphView) => void }) {
    const buildId = view.build.id;
    const version = latestVersion(view);
    const [text, setText] = useState('');
    const [category, setCategory] = useState<RequirementCategory>('other');
    const [saved, setSaved] = useState<number | null>(null);
    const add = useMutation({
        mutationFn: () => workspaceApi.addRequirement(buildId, version, text.trim(), category),
        onSuccess: (next) => {
            setSaved(next.version.version);
            setText('');
            onChanged(next);
        },
    });
    return (
        <PanelCard title="Add a requirement yourself" icon={<PlusCircle className="h-5 w-5" />} testId="assistant-manual">
            <form
                className="space-y-3"
                onSubmit={(e) => {
                    e.preventDefault();
                    if (text.trim().length >= 3) add.mutate();
                }}
            >
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
                    <Field label="Requirement" hint="In your own words, with any sizes you need (e.g. “Fits a 120 mm fan”).">
                        {({ id, describedBy }) => (
                            <TextInput id={id} aria-describedby={describedBy} value={text} maxLength={300} onChange={(e) => setText(e.target.value)} disabled={!isCurrent} data-testid="assistant-manual-text" />
                        )}
                    </Field>
                    <Field label="Type">
                        {({ id }) => (
                            <SelectInput id={id} value={category} onChange={(e) => setCategory(e.target.value as RequirementCategory)} disabled={!isCurrent} data-testid="assistant-manual-category">
                                {REQUIREMENT_CATEGORIES.map((c) => (
                                    <option key={c} value={c}>
                                        {CATEGORY_LABEL[c]}
                                    </option>
                                ))}
                            </SelectInput>
                        )}
                    </Field>
                </div>
                <Button type="submit" variant="secondary" loading={add.isPending} disabled={!isCurrent || text.trim().length < 3} data-testid="assistant-manual-submit">
                    Add as version {version + 1}
                </Button>
                {saved && (
                    <p className="text-sm text-signal" role="status" data-testid="assistant-manual-saved">
                        Saved as version {saved}.
                    </p>
                )}
                {add.isError && <Notice tone="error">{errorMessage(add.error)}</Notice>}
            </form>
        </PanelCard>
    );
}
