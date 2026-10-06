'use client';

import { useRef, useState } from 'react';
import { Camera, CheckCircle2, Loader2, Trash2, XCircle } from 'lucide-react';
import type { InspectionCheck, InspectionPlanView, InspectionResultView, InspectionSubmitRequest } from '@/contracts';
import { Field, TextArea, TextInput } from '@/components/ui/field';
import { ConfirmAction } from '@/components/ui/confirm-action';
import { Notice } from '@/components/ui/state';
import { api, errorMessage, putSigned } from '@/lib/api';
import { cn } from '@/lib/utils';

const MEASURED = new Set(['DIMENSION', 'HOLE_DIAMETER', 'FLATNESS', 'BEND_ANGLE']);
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
type AllowedType = (typeof ALLOWED_TYPES)[number];

type Entry = { value: string; pass: boolean | null; note: string };
type Photo = { uid: number; name: string; key: string | null; status: 'uploading' | 'done' | 'error'; error?: string };

function unit(check: InspectionCheck) {
    return check.kind === 'BEND_ANGLE' ? '°' : 'mm';
}

/** Client-side preview of the tolerance check. The server recomputes PASS/FAIL authoritatively. */
function withinTolerance(check: InspectionCheck, value: number): boolean | null {
    if (check.nominalMm == null) return null;
    const lo = check.nominalMm - (check.tolMinusMm ?? 0);
    const hi = check.nominalMm + (check.tolPlusMm ?? 0);
    return value >= lo - 1e-9 && value <= hi + 1e-9;
}

export function QaForm({ jobId, plan, onSubmitted }: { jobId: string; plan: InspectionPlanView; onSubmitted: (r: InspectionResultView) => void }) {
    const [entries, setEntries] = useState<Record<string, Entry>>(() => Object.fromEntries(plan.checks.map((c) => [c.id, { value: '', pass: null, note: '' }])));
    const [photos, setPhotos] = useState<Photo[]>([]);
    const [inspector, setInspector] = useState('');
    const [notes, setNotes] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const setEntry = (id: string, patch: Partial<Entry>) => setEntries((e) => ({ ...e, [id]: { ...e[id], ...patch } }));

    const nextUid = useRef(0);
    const addPhotos = async (files: FileList | null) => {
        if (!files) return;
        const update = (uid: number, patch: Partial<Photo>) => setPhotos((list) => list.map((ph) => (ph.uid === uid ? { ...ph, ...patch } : ph)));
        await Promise.all(
            Array.from(files)
                .slice(0, Math.max(0, 10 - photos.length))
                .map(async (file) => {
                    const uid = nextUid.current++;
                    const type = file.type as AllowedType;
                    if (!ALLOWED_TYPES.includes(type)) {
                        setPhotos((p) => [...p, { uid, name: file.name, key: null, status: 'error', error: 'Use JPEG, PNG, WebP or PDF' }]);
                        return;
                    }
                    setPhotos((p) => [...p, { uid, name: file.name, key: null, status: 'uploading' }]);
                    try {
                        const res = await api.qaUpload(jobId, { filename: file.name, contentType: type, sizeBytes: file.size });
                        await putSigned(res.upload, file);
                        update(uid, { key: res.key, status: 'done' });
                    } catch (err) {
                        update(uid, { status: 'error', error: errorMessage(err) });
                    }
                }),
        );
    };

    const build = (): { body: InspectionSubmitRequest | null; problems: string[] } => {
        const problems: string[] = [];
        const measurements: InspectionSubmitRequest['measurements'] = [];
        for (const c of plan.checks) {
            const e = entries[c.id];
            if (MEASURED.has(c.kind)) {
                const v = Number(e.value);
                if (e.value.trim() === '' || !Number.isFinite(v)) {
                    problems.push(`Enter a measured value for “${c.label}”.`);
                    continue;
                }
                const tol = withinTolerance(c, v);
                measurements.push({ checkId: c.id, measuredValue: v, pass: tol ?? true, note: e.note.trim() || undefined });
            } else {
                if (e.pass === null) {
                    problems.push(`Mark “${c.label}” as pass or fail.`);
                    continue;
                }
                measurements.push({ checkId: c.id, pass: e.pass, note: e.note.trim() || undefined });
            }
        }
        const keys = photos.filter((p) => p.status === 'done' && p.key).map((p) => p.key!) as string[];
        if (keys.length === 0) problems.push('Add at least one inspection photo.');
        if (photos.some((p) => p.status === 'uploading')) problems.push('Wait for photos to finish uploading.');
        if (!inspector.trim()) problems.push('Enter the inspector’s name.');
        if (problems.length) return { body: null, problems };
        return { body: { measurements, photoKeys: keys, inspectorName: inspector.trim(), notes: notes.trim() || undefined }, problems };
    };

    const submit = async () => {
        const { body, problems } = build();
        if (!body) {
            setError(problems.join(' '));
            return;
        }
        setSubmitting(true);
        setError(null);
        try {
            onSubmitted(await api.submitInspection(jobId, body));
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <section aria-labelledby="qa-heading" className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700 sm:p-5" data-testid="qa-form">
            <h2 id="qa-heading" className="font-display text-lg font-bold">
                Inspection
            </h2>
            <p className="mt-1 text-sm text-fg-muted">
                Inspect {plan.sampleSize} {plan.sampleSize === 1 ? 'part' : 'parts'} against the plan. Every check needs a result; DiscoverMake computes pass or fail from your measurements. Nothing ships until inspection passes.
            </p>
            <ol className="mt-4 space-y-3">
                {plan.checks.map((c, i) => {
                    const e = entries[c.id];
                    const measured = MEASURED.has(c.kind);
                    const v = Number(e.value);
                    const tol = measured && e.value.trim() !== '' && Number.isFinite(v) ? withinTolerance(c, v) : null;
                    return (
                        <li key={c.id} className="rounded-xl bg-graphite-850 p-3 ring-1 ring-graphite-700" data-testid={`qa-check-${c.id}`}>
                            <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-fg">
                                        {i + 1}. {c.label}
                                        {c.critical && <span className="ml-2 rounded bg-amber/15 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-amber">Critical</span>}
                                    </p>
                                    <p className="text-xs text-fg-muted">{c.instructions}</p>
                                    {c.nominalMm != null && (
                                        <p className="mt-0.5 font-mono text-[11px] text-fg-subtle">
                                            nominal {c.nominalMm.toFixed(2)} {unit(c)} · +{(c.tolPlusMm ?? 0).toFixed(2)} / −{(c.tolMinusMm ?? 0).toFixed(2)}
                                        </p>
                                    )}
                                </div>
                                {measured ? (
                                    <div className="flex items-center gap-2">
                                        <label className="sr-only" htmlFor={`m-${c.id}`}>
                                            Measured {c.label} in {unit(c)}
                                        </label>
                                        <TextInput
                                            id={`m-${c.id}`}
                                            type="number"
                                            inputMode="decimal"
                                            step="0.01"
                                            className="h-10 w-28 font-mono"
                                            value={e.value}
                                            onChange={(ev) => setEntry(c.id, { value: ev.target.value })}
                                            data-testid={`qa-measure-${c.id}`}
                                        />
                                        <span className="text-xs text-fg-subtle">{unit(c)}</span>
                                        {tol !== null && (tol ? <CheckCircle2 className="h-5 w-5 text-signal" aria-label="Within tolerance" /> : <XCircle className="h-5 w-5 text-ember" aria-label="Out of tolerance" />)}
                                    </div>
                                ) : (
                                    <div className="flex gap-1 rounded-lg bg-graphite-900 p-1 ring-1 ring-graphite-700" role="radiogroup" aria-label={`${c.label} result`}>
                                        {([true, false] as const).map((val) => (
                                            <button
                                                key={String(val)}
                                                type="button"
                                                role="radio"
                                                aria-checked={e.pass === val}
                                                onClick={() => setEntry(c.id, { pass: val })}
                                                className={cn(
                                                    'h-8 rounded-md px-3 text-xs font-semibold',
                                                    e.pass === val ? (val ? 'bg-signal text-signal-ink' : 'bg-ember text-ember-ink') : 'text-fg-muted hover:text-fg',
                                                )}
                                                data-testid={`qa-${val ? 'pass' : 'fail'}-${c.id}`}
                                            >
                                                {val ? 'Pass' : 'Fail'}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </li>
                    );
                })}
            </ol>

            <div className="mt-5">
                <p className="text-sm font-medium text-fg">Inspection photos</p>
                <p className="text-xs text-fg-subtle">At least one photo of the inspected parts. JPEG, PNG, WebP or PDF up to 15 MB.</p>
                <label className="mt-2 inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl bg-graphite-750 px-4 text-sm font-semibold text-fg ring-1 ring-inset ring-graphite-600 hover:bg-graphite-700 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-signal">
                    <Camera className="h-4 w-4" aria-hidden /> Add photos
                    <input
                        type="file"
                        multiple
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        className="sr-only"
                        onChange={(e) => {
                            void addPhotos(e.target.files);
                            e.target.value = '';
                        }}
                        data-testid="qa-photo-input"
                    />
                </label>
                {photos.length > 0 && (
                    <ul className="mt-3 space-y-1.5">
                        {photos.map((p) => (
                            <li key={p.uid} className="flex items-center gap-2 text-sm" data-testid="qa-photo" data-status={p.status}>
                                {p.status === 'uploading' && <Loader2 className="h-4 w-4 animate-spin text-fg-muted" aria-hidden />}
                                {p.status === 'done' && <CheckCircle2 className="h-4 w-4 text-signal" aria-hidden />}
                                {p.status === 'error' && <XCircle className="h-4 w-4 text-ember" aria-hidden />}
                                <span className="min-w-0 flex-1 truncate text-fg">{p.name}</span>
                                {p.error && <span className="text-xs text-ember">{p.error}</span>}
                                {p.status !== 'uploading' && (
                                    <button type="button" className="rounded p-1 text-fg-subtle hover:text-fg" aria-label={`Remove ${p.name}`} onClick={() => setPhotos((list) => list.filter((x) => x.uid !== p.uid))}>
                                        <Trash2 className="h-4 w-4" aria-hidden />
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Field label="Inspector">
                    {({ id, describedBy }) => <TextInput id={id} autoComplete="name" value={inspector} onChange={(e) => setInspector(e.target.value)} aria-describedby={describedBy} data-testid="qa-inspector" />}
                </Field>
                <Field label="Notes" optional>
                    {({ id, describedBy }) => <TextArea id={id} className="min-h-[44px]" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} aria-describedby={describedBy} />}
                </Field>
            </div>

            {error && (
                <Notice tone="error" className="mt-4" title="Inspection not submitted" testId="qa-error">
                    {error}
                </Notice>
            )}
            <div className="mt-5">
                <ConfirmAction
                    label="Submit inspection"
                    confirmLabel="Submit results"
                    prompt="Submit these results? A failed critical check opens a rework job; a pass unlocks shipping."
                    onConfirm={submit}
                    loading={submitting}
                    testId="qa-submit"
                    className="w-full sm:w-auto"
                />
            </div>
        </section>
    );
}
