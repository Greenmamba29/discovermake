'use client';

/**
 * Reconstruct · steps 2-4 for one build: measure on the photo, confirm with a caliper, review
 * and order. One query (`GET /api/reconstruct/:buildId`) feeds every step; writes return the
 * fresh view.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Box, Camera, CheckCircle2, Hammer, Lock, Ruler } from 'lucide-react';
import { requiredDimensions, SHAFT_STANDARDS, type LengthUnit, type PhotoMeasurements, type ReconstructOptions, type ReconstructView, type ShaftStandardKey } from '@/contracts/reconstruct';
import { Button, ButtonLink } from '@/components/ui/button';
import { SelectInput, TextInput } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState, Notice } from '@/components/ui/state';
import { ApiClientError, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ConfirmTable } from './confirm-table';
import { MeasureTool } from './measure-tool';
import { PhotoOverlay } from './photo-overlay';
import { PrintQuoteCard } from './print-quote-card';
import { reconstructApi, reconstructQueryKey } from './reconstruct-api';
import { ReviewObject } from './review-object';
import { ReconstructStepper, type ReconstructStep } from './stepper';

type Step = Exclude<ReconstructStep, 'capture'>;
const TITLES: Record<Step, string> = { measure: 'Measure on the photo', confirm: 'Confirm with a caliper', review: 'Review and order' };

export function ReconstructFlow({ buildId, step: requested }: { buildId: string; step: string | null }) {
    const query = useQuery({ queryKey: reconstructQueryKey(buildId), queryFn: ({ signal }) => reconstructApi.view(buildId, signal) });
    const view = query.data;
    const step: Step = requested === 'measure' || requested === 'confirm' || requested === 'review' ? requested : view?.cadVersion ? 'review' : view?.allConfirmed ? 'confirm' : 'measure';
    const href = (s: ReconstructStep) => `/reconstruct/${buildId}?step=${s}`;

    return (
        <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6 sm:px-6 sm:pt-10" data-testid={`reconstruct-${step}`}>
            <p className="eyebrow">Reconstruct{view ? ` · ${view.displayId}` : ''}</p>
            <h1 className="mt-2 font-display text-2xl font-extrabold tracking-tight sm:text-4xl">{TITLES[step]}</h1>
            {view && <p className="mt-1 text-sm text-fg-muted">{view.name}</p>}
            <ReconstructStepper current={step} hrefFor={href} reachable={view?.cadVersion ? 3 : view?.allConfirmed ? 2 : 1} />
            <div className="mt-6">
                {query.isPending ? (
                    <Skeleton className="h-[420px] w-full rounded-2xl" />
                ) : query.isError || !view ? (
                    <ErrorState message={errorMessage(query.error)} action={<Button variant="secondary" onClick={() => query.refetch()}>Try again</Button>} />
                ) : (
                    <>
                        {!view.canEdit && (
                            <Notice tone="info" title="View only" className="mb-4">
                                Only the person who started this reconstruction can change it.
                            </Notice>
                        )}
                        {view.passport && (
                            <Notice tone="info" title={`Replacing part from order ${view.passport.orderNumber}`} className="mb-4">
                                Originally {view.passport.materialName}, {view.passport.processName.toLowerCase()}.
                            </Notice>
                        )}
                        {step === 'measure' && <MeasureStep view={view} next={href('confirm')} />}
                        {step === 'confirm' && <ConfirmStep view={view} next={href('review')} />}
                        {step === 'review' && <ReviewStep view={view} back={href('confirm')} />}
                    </>
                )}
            </div>
        </div>
    );
}

function useSetView(buildId: string) {
    const qc = useQueryClient();
    return (v: ReconstructView) => qc.setQueryData(reconstructQueryKey(buildId), v);
}

// ---------------------------------------------------------------------------
// Step 2: measure
// ---------------------------------------------------------------------------

function MeasureStep({ view, next }: { view: ReconstructView; next: string }) {
    const router = useRouter();
    const setView = useSetView(view.buildId);
    const [active, setActive] = useState(view.photos[0]?.attachmentId ?? null);
    const [drafts, setDrafts] = useState<Record<string, PhotoMeasurements>>(() => Object.fromEntries(view.photos.filter((p) => p.measurements).map((p) => [p.attachmentId, p.measurements!])));
    const [dirty, setDirty] = useState(false);
    const [suggestions, setSuggestions] = useState<string | null>(null);
    const dims = useMemo(() => requiredDimensions(view.partType, view.options), [view.partType, view.options]);
    const save = useMutation({
        mutationFn: () => reconstructApi.saveMeasurements(view.buildId, Object.values(drafts)),
        onSuccess: (v) => {
            setView(v);
            setDirty(false);
        },
    });
    const detect = useMutation({ mutationFn: (attachmentId: string) => reconstructApi.segment(view.buildId, attachmentId), onSuccess: (r) => setSuggestions(r.suggestions.map((s) => `${s.param.replace(/_mm$/, '').replace(/_/g, ' ')} ≈ ${s.valueMm.toFixed(1)} mm`).join(' · ') || 'No dimensions suggested.') });
    const photo = view.photos.find((p) => p.attachmentId === active) ?? null;

    if (!view.photos.length) {
        return (
            <Notice tone="warning" title="No photos yet" action={<ButtonLink href="/reconstruct" variant="secondary" size="sm">Start again with photos</ButtonLink>}>
                Measuring needs a photo of the part next to a reference object. You can also skip straight to caliper readings.
            </Notice>
        );
    }
    const proceed = async () => {
        if (dirty && view.canEdit) await save.mutateAsync();
        router.push(next);
    };
    return (
        <div className="space-y-4">
            {view.photos.length > 1 && (
                <div role="tablist" aria-label="Photos" className="flex gap-2 overflow-x-auto pb-1">
                    {view.photos.map((p, i) => (
                        <button key={p.attachmentId} role="tab" type="button" aria-selected={p.attachmentId === active} onClick={() => setActive(p.attachmentId)} className={cn('shrink-0 rounded-lg px-3 py-1.5 text-sm ring-1 ring-inset', p.attachmentId === active ? 'bg-signal/10 ring-signal' : 'ring-graphite-700')}>
                            <Camera className="mr-1 inline h-3.5 w-3.5" aria-hidden /> Photo {i + 1}
                        </button>
                    ))}
                </div>
            )}
            {photo && (
                <MeasureTool
                    key={photo.attachmentId}
                    photo={photo}
                    value={drafts[photo.attachmentId] ?? null}
                    dims={dims}
                    readOnly={!view.canEdit}
                    onChange={(m) => {
                        setDrafts((d) => ({ ...d, [m.attachmentId]: m }));
                        setDirty(true);
                    }}
                    onAutoDetect={view.autoDetect && view.canEdit ? () => detect.mutate(photo.attachmentId) : undefined}
                    autoDetecting={detect.isPending}
                />
            )}
            {suggestions && <Notice tone="info" title="Auto-detect suggestions (estimates, not confirmed)">{suggestions}</Notice>}
            {(save.error || detect.error) && <Notice tone="error">{errorMessage(save.error ?? detect.error)}</Notice>}
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                {view.canEdit && (
                    <Button variant="secondary" onClick={() => save.mutate()} disabled={!dirty} loading={save.isPending} data-testid="measure-save">
                        Save measurements
                    </Button>
                )}
                <Button onClick={proceed} loading={save.isPending} data-testid="measure-continue">
                    Continue to caliper readings <ArrowRight className="h-4 w-4" aria-hidden />
                </Button>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Step 3: confirm (choices + caliper table + Generate)
// ---------------------------------------------------------------------------

function OptionsPanel({ view }: { view: ReconstructView }) {
    const setView = useSetView(view.buildId);
    const update = useMutation({ mutationFn: (options: Partial<ReconstructOptions>) => reconstructApi.update(view.buildId, { options }), onSuccess: setView });
    const o = view.options;
    const disabled = !view.canEdit || update.isPending;
    const field = 'flex flex-col gap-1 text-sm font-medium';
    return (
        <section aria-labelledby="options-heading" className="rounded-xl bg-graphite-900 p-4 ring-1 ring-graphite-700" data-testid="reconstruct-options">
            <h2 id="options-heading" className="font-display text-lg font-bold">
                About the part
            </h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {view.partType === 'knob' && (
                    <>
                        <label className={field}>
                            Shaft
                            <SelectInput value={o.shaft} disabled={disabled} onChange={(e) => update.mutate({ shaft: e.target.value as ReconstructOptions['shaft'] })} data-testid="option-shaft">
                                {(Object.keys(SHAFT_STANDARDS) as ShaftStandardKey[]).map((k) => (
                                    <option key={k} value={k}>
                                        Standard: {SHAFT_STANDARDS[k].label}
                                    </option>
                                ))}
                                <option value="measured">I will measure the shaft</option>
                            </SelectInput>
                        </label>
                        {o.shaft === 'measured' && (
                            <label className={field}>
                                Shaft type
                                <SelectInput value={o.measuredBoreType} disabled={disabled} onChange={(e) => update.mutate({ measuredBoreType: e.target.value as 'd_shaft' | 'round' })}>
                                    <option value="d_shaft">D-shaft (one flat side)</option>
                                    <option value="round">Round</option>
                                </SelectInput>
                            </label>
                        )}
                        <label className={field}>
                            Bore depth
                            <SelectInput value={o.boreDepth} disabled={disabled} onChange={(e) => update.mutate({ boreDepth: e.target.value as 'cap' | 'measured' })}>
                                <option value="cap">Up to 2 mm under the top</option>
                                <option value="measured">I will measure the shaft engagement</option>
                            </SelectInput>
                        </label>
                        <label className={field}>
                            Grip flutes on the old knob
                            <TextInput
                                type="number"
                                min={0}
                                max={60}
                                defaultValue={o.gripRibs}
                                disabled={disabled}
                                onBlur={(e) => {
                                    const n = Math.max(0, Math.min(60, Math.round(Number(e.target.value) || 0)));
                                    if (n !== o.gripRibs) update.mutate({ gripRibs: n });
                                }}
                                data-testid="option-ribs"
                            />
                        </label>
                        <label className="flex items-center gap-2 text-sm font-medium">
                            <input type="checkbox" className="h-4 w-4 accent-signal" checked={o.pointerNotch} disabled={disabled} onChange={(e) => update.mutate({ pointerNotch: e.target.checked })} data-testid="option-notch" />
                            Pointer notch on top
                        </label>
                    </>
                )}
                {view.partType === 'spacer' && (
                    <label className="flex items-center gap-2 text-sm font-medium">
                        <input type="checkbox" className="h-4 w-4 accent-signal" checked={o.flanged} disabled={disabled} onChange={(e) => update.mutate({ flanged: e.target.checked })} data-testid="option-flanged" />
                        It has a flange
                    </label>
                )}
                {view.partType === 'bracket' && (
                    <>
                        <label className={field}>
                            Shape
                            <SelectInput value={o.bracketShape} disabled={disabled} onChange={(e) => update.mutate({ bracketShape: e.target.value as 'flat' | 'l' | 'z' })} data-testid="option-bracket-shape">
                                <option value="flat">Flat plate</option>
                                <option value="l">L (one bend)</option>
                                <option value="z">Z (two bends)</option>
                            </SelectInput>
                        </label>
                        {o.bracketShape === 'flat' && (
                            <label className="flex items-center gap-2 text-sm font-medium">
                                <input type="checkbox" className="h-4 w-4 accent-signal" checked={o.bracketHoles} disabled={disabled} onChange={(e) => update.mutate({ bracketHoles: e.target.checked })} />
                                Two mounting holes
                            </label>
                        )}
                    </>
                )}
            </div>
            {update.error && <p className="mt-2 text-xs text-ember">{errorMessage(update.error)}</p>}
        </section>
    );
}

function ConfirmStep({ view, next }: { view: ReconstructView; next: string }) {
    const router = useRouter();
    const setView = useSetView(view.buildId);
    const [unavailable, setUnavailable] = useState(false);
    const [questions, setQuestions] = useState<string[]>([]);
    const generate = useMutation({
        mutationFn: () => reconstructApi.generate(view.buildId),
        onSuccess: (r) => {
            if (r.status === 'needs_input') setQuestions(r.questions);
            else router.push(next);
        },
        onError: (err) => {
            if (err instanceof ApiClientError && err.status === 503) setUnavailable(true);
        },
    });
    const confirm = async (param: Parameters<typeof reconstructApi.confirm>[1][number]['param'], value: number, unit: LengthUnit) => {
        setView(await reconstructApi.confirm(view.buildId, [{ param, value, unit }]));
    };
    const missing = view.dimensions.filter((d) => !d.confirmedAt).length;
    return (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0 space-y-4">
                <OptionsPanel view={view} />
                <ConfirmTable rows={view.dimensions} onConfirm={confirm} disabled={!view.canEdit} />
            </div>
            <aside className="space-y-4" aria-label="Generate">
                <section className="rounded-xl bg-graphite-900 p-4 ring-1 ring-graphite-700" data-testid="generate-panel">
                    <h2 className="flex items-center gap-2 font-display text-lg font-bold">
                        <Hammer className="h-5 w-5" aria-hidden /> Generate the part
                    </h2>
                    <p className="mt-1 text-sm text-fg-muted">
                        {missing ? `${missing} reading${missing === 1 ? '' : 's'} still to confirm. Nothing is generated from a photo estimate.` : 'Every critical size is confirmed. Generate builds the CAD from your readings only.'}
                    </p>
                    {view.plan.status === 'ready' && (
                        <ul className="mt-3 space-y-1 text-xs text-fg-muted" data-testid="plan-trace">
                            {view.plan.trace.slice(0, 8).map((t) => (
                                <li key={t.field}>
                                    <span className="font-mono text-fg">{t.field.replace(/_mm$/, '')}</span> = {String(t.value)} · <span className={t.source === 'caliper' ? 'text-signal' : ''}>{t.source.replace('_', ' ')}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                    <Button className="mt-4 w-full" onClick={() => { setUnavailable(false); setQuestions([]); generate.mutate(); }} disabled={!view.canEdit || !view.allConfirmed} loading={generate.isPending} data-testid="generate-cad">
                        {view.allConfirmed ? 'Generate CAD' : (
                            <>
                                <Lock className="h-4 w-4" aria-hidden /> Confirm every reading first
                            </>
                        )}
                    </Button>
                    {view.cadVersion && (
                        <ButtonLink href={next} variant="secondary" className="mt-2 w-full" data-testid="go-review">
                            See the generated part
                        </ButtonLink>
                    )}
                </section>
                {unavailable && (
                    <Notice tone="warning" title="CAD service unavailable" testId="cad-unavailable">
                        The CAD service is not running right now. Your confirmed readings are saved: come back and press Generate again.
                    </Notice>
                )}
                {questions.length > 0 && (
                    <Notice tone="warning" title="Needs another look" testId="generate-questions">
                        <ul className="list-disc pl-4">
                            {questions.map((q) => (
                                <li key={q}>{q}</li>
                            ))}
                        </ul>
                    </Notice>
                )}
                {generate.error && !unavailable && <Notice tone="error">{errorMessage(generate.error)}</Notice>}
            </aside>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Step 4: review & order
// ---------------------------------------------------------------------------

function ReviewStep({ view, back }: { view: ReconstructView; back: string }) {
    if (!view.cadVersion) {
        return (
            <Notice tone="info" title="No CAD yet" action={<ButtonLink href={back} size="sm" variant="secondary">Go to caliper readings</ButtonLink>}>
                Confirm every reading and press Generate to see the part and its price.
            </Notice>
        );
    }
    const printed = view.plan.status === 'ready' ? view.plan.printed : view.sheetPartId === null;
    return (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0 space-y-6">
                <section aria-labelledby="object-heading">
                    <h2 id="object-heading" className="mb-3 flex items-center gap-2 font-display text-lg font-bold">
                        <Box className="h-5 w-5" aria-hidden /> Generated part
                    </h2>
                    <ReviewObject buildId={view.buildId} />
                </section>
                <section aria-labelledby="dims-heading" data-testid="review-dimensions">
                    <h2 id="dims-heading" className="flex items-center gap-2 font-display text-lg font-bold">
                        <Ruler className="h-5 w-5" aria-hidden /> Confirmed dimensions
                    </h2>
                    <div className="mt-3 overflow-x-auto rounded-xl ring-1 ring-graphite-700">
                        <table className="w-full min-w-[420px] text-left text-sm">
                            <thead className="bg-graphite-900 text-xs text-fg-muted">
                                <tr>
                                    <th scope="col" className="px-3 py-2 font-medium">Dimension</th>
                                    <th scope="col" className="px-3 py-2 font-medium">Estimate from photo</th>
                                    <th scope="col" className="px-3 py-2 font-medium">Caliper</th>
                                    <th scope="col" className="px-3 py-2 font-medium">Difference</th>
                                </tr>
                            </thead>
                            <tbody>
                                {view.dimensions.map((d) => (
                                    <tr key={d.param} className="border-t border-graphite-800">
                                        <th scope="row" className="px-3 py-2 font-medium">{d.label}</th>
                                        <td className="px-3 py-2 font-mono">{d.estimateMm !== null ? `${d.estimateMm.toFixed(2)} mm` : '—'}</td>
                                        <td className="px-3 py-2 font-mono text-signal">
                                            <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                                            {d.caliperMm !== null ? `${d.caliperMm.toFixed(2)} mm` : 'missing'}
                                        </td>
                                        <td className={cn('px-3 py-2 font-mono', d.deltaWarning && 'text-amber')}>{d.deltaPct !== null ? `${d.deltaPct.toFixed(1)}%` : '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
                {view.photos.length > 0 && (
                    <section aria-labelledby="photos-review-heading">
                        <h2 id="photos-review-heading" className="font-display text-lg font-bold">
                            Your photos
                        </h2>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            {view.photos.map((p, i) => (
                                <PhotoOverlay key={p.attachmentId} photo={p} index={i} dims={view.dimensions} />
                            ))}
                        </div>
                    </section>
                )}
            </div>
            <aside aria-label="Price and order" className="space-y-4">
                {printed ? (
                    <PrintQuoteCard view={view} />
                ) : view.sheetPartId ? (
                    <section className="rounded-xl bg-graphite-900 p-4 ring-1 ring-graphite-700" data-testid="sheet-quote-card">
                        <h2 className="font-display text-lg font-bold">Laser cut and bent</h2>
                        <p className="mt-1 text-sm text-fg-muted">This replacement is a sheet-metal part: configure the material and get the binding laser quote.</p>
                        <ButtonLink href={`/parts/${view.sheetPartId}`} className="mt-3 w-full">
                            Get the instant quote
                        </ButtonLink>
                    </section>
                ) : null}
                <Link href={back} className="block text-center text-sm text-fg-muted hover:text-fg">
                    Change a reading
                </Link>
            </aside>
        </div>
    );
}
