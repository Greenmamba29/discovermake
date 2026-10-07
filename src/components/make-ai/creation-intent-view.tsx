'use client';

import { useState, type ReactNode } from 'react';
import { CheckCircle2, CircleHelp, Layers, ListChecks, ShieldAlert, UploadCloud, Users, Wrench } from 'lucide-react';
import type { CreationIntent, CreationIntentKind, IntentUnknown, MakeAiRiskClass } from '@/contracts/make-ai';
import { ButtonLink } from '@/components/ui/button';
import { Notice } from '@/components/ui/state';
import { cn } from '@/lib/utils';
import { ContinueToBuild } from './continue-to-build';

const INTENT_LABEL: Record<CreationIntentKind, string> = {
    create: 'New product',
    modify: 'Modify a product',
    reconstruct: 'Reconstruct',
    manufacture: 'Manufacture a design',
};

const RISK: Record<MakeAiRiskClass, { label: string; className: string }> = {
    standard: { label: 'Standard', className: 'bg-graphite-750 text-fg-muted ring-graphite-600' },
    elevated: { label: 'Needs specialist review', className: 'bg-amber/10 text-amber ring-amber/30' },
    regulated: { label: 'Out of scope', className: 'bg-ember/10 text-ember ring-ember/40' },
};

/** The "AI estimate — not a quote" label. Always visible next to any Make AI output. */
export function EstimateBadge({ className }: { className?: string }) {
    return (
        <span
            className={cn('inline-flex items-center gap-1.5 rounded-full bg-amber/10 px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-amber ring-1 ring-inset ring-amber/30', className)}
            data-testid="make-ai-estimate-badge"
        >
            AI estimate — not a quote
        </span>
    );
}

function Tag({ children, className }: { children: ReactNode; className?: string }) {
    return <span className={cn('inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] ring-1 ring-inset', className)}>{children}</span>;
}

function Card({ id, title, icon, children, className }: { id: string; title: string; icon: ReactNode; children: ReactNode; className?: string }) {
    return (
        <section aria-labelledby={id} className={cn('rounded-2xl bg-graphite-900 p-5 ring-1 ring-graphite-700 sm:p-6', className)}>
            <h3 id={id} className="flex items-center gap-2 font-display text-lg font-bold">
                <span className="text-fg-subtle" aria-hidden>
                    {icon}
                </span>
                {title}
            </h3>
            <div className="mt-4">{children}</div>
        </section>
    );
}

function RequirementsChecklist({ intent }: { intent: CreationIntent }) {
    // Buyer-stated requirements start ticked; inferred ones wait for the buyer to confirm.
    const [checked, setChecked] = useState<Record<string, boolean>>(() => Object.fromEntries(intent.requirements.map((r) => [r.id, r.source === 'user'])));
    if (intent.requirements.length === 0) return <p className="text-sm text-fg-muted">No requirements yet. Add more detail to your description.</p>;
    const confirmed = intent.requirements.filter((r) => checked[r.id]).length;
    return (
        <>
            <p className="mb-3 font-mono text-xs text-fg-subtle" aria-live="polite">
                {confirmed} of {intent.requirements.length} confirmed
            </p>
            <ul className="space-y-2">
                {intent.requirements.map((r) => {
                    const inputId = `req-${r.id}`;
                    return (
                        <li key={r.id} className="flex gap-3 rounded-xl bg-graphite-850 p-3 ring-1 ring-inset ring-graphite-700">
                            <input
                                id={inputId}
                                type="checkbox"
                                className="mt-0.5 h-4 w-4 shrink-0 accent-signal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
                                checked={Boolean(checked[r.id])}
                                onChange={(e) => setChecked((c) => ({ ...c, [r.id]: e.target.checked }))}
                            />
                            <label htmlFor={inputId} className="min-w-0 flex-1 cursor-pointer text-sm">
                                <span className="text-fg">{r.text}</span>
                                <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                    <Tag className="text-fg-muted ring-graphite-600">{r.category}</Tag>
                                    <Tag className={r.source === 'user' ? 'text-signal ring-signal/30' : 'text-fg-subtle ring-graphite-600'}>{r.source === 'user' ? 'You said' : 'Inferred'}</Tag>
                                    <span className="font-mono text-[11px] text-fg-subtle">{Math.round(r.confidence * 100)}% sure</span>
                                </span>
                            </label>
                        </li>
                    );
                })}
            </ul>
        </>
    );
}

function UnknownCard({ unknown, index }: { unknown: IntentUnknown; index: number }) {
    const [accepted, setAccepted] = useState(false);
    const headingId = `unknown-${index}`;
    return (
        <li className="rounded-xl bg-graphite-850 p-4 ring-1 ring-inset ring-graphite-700">
            <p id={headingId} className="font-semibold text-fg">
                {unknown.question}
            </p>
            <p className="mt-1 text-sm text-fg-muted">{unknown.why_it_matters}</p>
            {unknown.suggested_default ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <p className="text-sm">
                        <span className="eyebrow mr-2">Suggested</span>
                        <span className="text-fg">{unknown.suggested_default}</span>
                    </p>
                    <button
                        type="button"
                        aria-pressed={accepted}
                        onClick={() => setAccepted((a) => !a)}
                        className={cn(
                            'inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold ring-1 ring-inset transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-signal',
                            accepted ? 'bg-signal/10 text-signal ring-signal/30' : 'bg-graphite-750 text-fg-muted ring-graphite-600 hover:text-fg',
                        )}
                    >
                        {accepted && <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}
                        {accepted ? 'Default accepted' : 'Use this default'}
                    </button>
                </div>
            ) : (
                <p className="mt-3 text-xs text-fg-subtle">No safe default: we need your answer.</p>
            )}
        </li>
    );
}

/**
 * Renders a CreationIntent as cards: summary, requirements checklist, unknowns, materials + processes,
 * "Continue to Build" (when `intentId` is given and the request is in scope) and the DXF quote CTA.
 */
export function CreationIntentView({ intent, model, intentId }: { intent: CreationIntent; model?: string; intentId?: string }) {
    const risk = RISK[intent.risk_class];
    const refused = intent.risk_class === 'regulated' || Boolean(intent.refusal_note);
    return (
        <div className="space-y-5" data-testid="creation-intent">
            <section aria-labelledby="intent-summary" className="rounded-2xl bg-graphite-900 p-5 ring-1 ring-graphite-700 sm:p-6">
                <div className="flex flex-wrap items-center gap-2">
                    <EstimateBadge />
                    <Tag className="text-fg-muted ring-graphite-600">{INTENT_LABEL[intent.intent]}</Tag>
                    <Tag className={risk.className}>{risk.label}</Tag>
                </div>
                <h3 id="intent-summary" className="mt-4 font-display text-2xl font-extrabold tracking-tight first-letter:uppercase">
                    {intent.product_type}
                </h3>
                <p className="mt-2 text-fg-muted">{intent.summary}</p>
                {model && <p className="mt-3 font-mono text-[11px] text-fg-subtle">Drafted by Make AI ({model}). Check every detail before you rely on it.</p>}
            </section>

            {refused && (
                <Notice tone="warning" title="DiscoverMake can't make this">
                    {intent.refusal_note ?? 'This request is outside what DiscoverMake makes.'}
                </Notice>
            )}

            {!refused && (
                <>
                    <Card id="intent-requirements" title="Requirements" icon={<ListChecks className="h-5 w-5" />}>
                        <RequirementsChecklist intent={intent} />
                        {intent.constraints.length > 0 && (
                            <div className="mt-5">
                                <h4 className="eyebrow">Constraints</h4>
                                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-fg-muted">
                                    {intent.constraints.map((c) => (
                                        <li key={c}>{c}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </Card>

                    {intent.unknowns.length > 0 && (
                        <Card id="intent-unknowns" title={`Questions before we can make it (${intent.unknowns.length})`} icon={<CircleHelp className="h-5 w-5" />}>
                            <ul className="space-y-3">
                                {intent.unknowns.map((u, i) => (
                                    <UnknownCard key={`${i}-${u.question}`} unknown={u} index={i} />
                                ))}
                            </ul>
                        </Card>
                    )}

                    <div className="grid gap-5 md:grid-cols-2">
                        <Card id="intent-materials" title="Suggested materials" icon={<Layers className="h-5 w-5" />}>
                            {intent.materials_suggested.length === 0 ? (
                                <p className="text-sm text-fg-muted">No material suggestion yet.</p>
                            ) : (
                                <ul className="space-y-3">
                                    {intent.materials_suggested.map((m) => (
                                        <li key={m.material}>
                                            <p className="font-semibold text-fg">{m.material}</p>
                                            <p className="text-sm text-fg-muted">{m.why}</p>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </Card>
                        <Card id="intent-processes" title="Suggested processes" icon={<Wrench className="h-5 w-5" />}>
                            {intent.processes_suggested.length === 0 ? (
                                <p className="text-sm text-fg-muted">No process suggestion yet.</p>
                            ) : (
                                <ul className="flex flex-wrap gap-2">
                                    {intent.processes_suggested.map((p) => (
                                        <li key={p} className="rounded-lg bg-graphite-800 px-2.5 py-1.5 text-sm text-fg ring-1 ring-inset ring-graphite-600">
                                            {p}
                                        </li>
                                    ))}
                                </ul>
                            )}
                            {intent.required_specialists.length > 0 && (
                                <div className="mt-5">
                                    <h4 className="eyebrow flex items-center gap-1.5">
                                        <Users className="h-3.5 w-3.5" aria-hidden />
                                        Specialist review
                                    </h4>
                                    <p className="mt-2 text-sm text-fg-muted">{intent.required_specialists.join(', ')}</p>
                                </div>
                            )}
                        </Card>
                    </div>
                </>
            )}

            {intentId && !refused && (
                <section aria-labelledby="intent-build" className="flex flex-col gap-4 rounded-2xl bg-graphite-900 p-5 ring-1 ring-signal/30 sm:flex-row sm:items-center sm:justify-between sm:p-6">
                    <div>
                        <h3 id="intent-build" className="font-display text-lg font-bold">
                            Turn this plan into a build
                        </h3>
                        <p className="mt-1 text-sm text-fg-muted">Answer the open questions, review materials and approve a version in your Build Workspace.</p>
                    </div>
                    <ContinueToBuild intentId={intentId} className="shrink-0" />
                </section>
            )}

            <section aria-labelledby="intent-cta" className="flex flex-col gap-4 rounded-2xl bg-graphite-850 p-5 ring-1 ring-graphite-600 sm:flex-row sm:items-center sm:justify-between sm:p-6">
                <div>
                    <h3 id="intent-cta" className="font-display text-lg font-bold">
                        Ready for a real price?
                    </h3>
                    <p className="mt-1 flex items-start gap-1.5 text-sm text-fg-muted">
                        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" aria-hidden />
                        Make AI only drafts a plan. Binding prices come from a flat-pattern DXF upload.
                    </p>
                </div>
                <ButtonLink href="/make" variant={intentId && !refused ? 'secondary' : 'primary'} className="shrink-0">
                    <UploadCloud className="h-4 w-4" aria-hidden />
                    Have a DXF? Get an instant quote
                </ButtonLink>
            </section>
        </div>
    );
}
