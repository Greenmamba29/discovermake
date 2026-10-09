'use client';

/**
 * Reconstruct · step 1: capture (Mobbin: camera capture with guided steps). Phones open the rear
 * camera straight away (`capture="environment"`); desktops pick files. 1-6 photos of the broken
 * part next to a reference object (credit card, quarter or ruler), what it is, and a short note.
 * Continue creates the build, then uploads each photo through the attachment routes (signed
 * upload + magic-byte checks) and opens the measuring step.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, CreditCard, ImagePlus, Lightbulb, Package, Trash2, Wrench } from 'lucide-react';
import { PART_TYPE_LABELS, RECONSTRUCT_PART_TYPES, type PassportPrefill, type ReconstructPartType } from '@/contracts/reconstruct';
import { MAX_IMAGE_ATTACHMENT_BYTES } from '@/contracts/workspace';
import { Button } from '@/components/ui/button';
import { Field, TextArea } from '@/components/ui/field';
import { Notice } from '@/components/ui/state';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { reconstructApi } from './reconstruct-api';
import { ReconstructStepper } from './stepper';

export const MAX_PHOTOS = 6;
const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif';
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

type Picked = { key: string; file: File; preview: string; status: 'ready' | 'uploading' | 'done' | 'error'; progress: number; error?: string };

export function CaptureScreen({ prefill }: { prefill: PassportPrefill | null }) {
    const router = useRouter();
    const [partType, setPartType] = useState<ReconstructPartType>(prefill?.suggestedPartType ?? 'knob');
    const [description, setDescription] = useState('');
    const [photos, setPhotos] = useState<Picked[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const cameraRef = useRef<HTMLInputElement>(null);
    const libraryRef = useRef<HTMLInputElement>(null);
    const previews = useRef<string[]>([]);

    useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);

    const add = (files: FileList | null) => {
        if (!files) return;
        setError(null);
        const next: Picked[] = [];
        for (const file of Array.from(files)) {
            if (file.type && !IMAGE_TYPES.has(file.type)) {
                setError(`${file.name} is not a photo (JPEG, PNG, WebP or HEIC).`);
                continue;
            }
            if (file.size > MAX_IMAGE_ATTACHMENT_BYTES) {
                setError(`${file.name} is larger than 15 MB.`);
                continue;
            }
            const preview = URL.createObjectURL(file);
            previews.current.push(preview);
            next.push({ key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`, file, preview, status: 'ready', progress: 0 });
        }
        setPhotos((prev) => {
            const merged = [...prev, ...next];
            if (merged.length > MAX_PHOTOS) setError(`Up to ${MAX_PHOTOS} photos: the first ${MAX_PHOTOS} are kept.`);
            return merged.slice(0, MAX_PHOTOS);
        });
    };
    const remove = (key: string) => setPhotos((prev) => prev.filter((p) => p.key !== key));
    const patch = (key: string, p: Partial<Picked>) => setPhotos((prev) => prev.map((x) => (x.key === key ? { ...x, ...p } : x)));

    const canContinue = photos.length > 0 && !busy;
    const start = async () => {
        setBusy(true);
        setError(null);
        try {
            const created = await reconstructApi.create({ partType, description, passportId: prefill?.passportId ?? null });
            for (const p of photos) {
                patch(p.key, { status: 'uploading' });
                try {
                    await reconstructApi.uploadPhoto(created.buildId, p.file, (f) => patch(p.key, { progress: f }));
                    patch(p.key, { status: 'done', progress: 1 });
                } catch (err) {
                    patch(p.key, { status: 'error', error: errorMessage(err) });
                    throw err;
                }
            }
            router.push(created.url);
        } catch (err) {
            setError(errorMessage(err));
            setBusy(false);
        }
    };

    const tips = useMemo(
        () => [
            { icon: CreditCard, text: 'Lay a credit card, a US quarter or a ruler flat next to the part, in the same plane.' },
            { icon: Camera, text: 'Shoot straight down from about 30 cm, part and reference both in focus, no flash glare.' },
            { icon: Wrench, text: 'Keep the broken pieces and a caliper or ruler nearby: you confirm every size in step 3.' },
        ],
        [],
    );

    return (
        <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6 sm:px-6 sm:pt-10" data-testid="reconstruct-capture">
            <p className="eyebrow">Reconstruct</p>
            <h1 className="mt-2 font-display text-2xl font-extrabold tracking-tight sm:text-4xl">Rebuild a broken part from a photo</h1>
            <p className="mt-2 text-sm text-fg-muted sm:text-base">Photograph it next to a card or coin, measure it on the photo, confirm the sizes with a caliper, and get a binding price for a new one.</p>
            <ReconstructStepper current="capture" />

            {prefill && (
                <Notice tone="info" title={`Replacing part from order ${prefill.orderNumber}`} className="mt-5" testId="reconstruct-passport">
                    {prefill.buildName} · originally {prefill.materialName}, {prefill.processName.toLowerCase()}.
                    {prefill.printMaterialSlug ? ' The same print material is preselected.' : ''}
                </Notice>
            )}

            <section aria-labelledby="part-type-heading" className="mt-6">
                <h2 id="part-type-heading" className="font-display text-lg font-bold">
                    What broke?
                </h2>
                <div role="radiogroup" aria-labelledby="part-type-heading" className="mt-3 grid gap-2 sm:grid-cols-3">
                    {RECONSTRUCT_PART_TYPES.map((t) => {
                        const checked = partType === t;
                        return (
                            <button
                                key={t}
                                type="button"
                                role="radio"
                                aria-checked={checked}
                                onClick={() => setPartType(t)}
                                className={cn('rounded-xl p-3 text-left ring-1 ring-inset transition-colors', checked ? 'bg-signal/10 ring-signal' : 'bg-graphite-900 ring-graphite-700 hover:ring-graphite-500')}
                                data-testid={`part-type-${t}`}
                            >
                                <span className="flex items-center gap-2 font-semibold">
                                    {t === 'bracket' ? <Package className="h-4 w-4" aria-hidden /> : <Wrench className="h-4 w-4" aria-hidden />}
                                    {PART_TYPE_LABELS[t].title}
                                </span>
                                <span className="mt-1 block text-xs text-fg-muted">{PART_TYPE_LABELS[t].body}</span>
                            </button>
                        );
                    })}
                </div>
            </section>

            <section aria-labelledby="photos-heading" className="mt-6">
                <div className="flex items-baseline justify-between gap-2">
                    <h2 id="photos-heading" className="font-display text-lg font-bold">
                        Photos
                    </h2>
                    <span className="text-xs text-fg-muted" data-testid="photo-count">
                        {photos.length} of {MAX_PHOTOS}
                    </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {photos.map((p, i) => (
                        <figure key={p.key} className="relative overflow-hidden rounded-xl bg-graphite-900 ring-1 ring-graphite-700" data-testid="capture-photo" data-status={p.status}>
                            {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
                            <img src={p.preview} alt={`Photo ${i + 1} of the broken part`} className="aspect-[4/3] w-full object-cover" />
                            <figcaption className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs">
                                <span className="truncate text-fg-muted">{p.status === 'uploading' ? `Uploading ${Math.round(p.progress * 100)}%` : p.status === 'error' ? (p.error ?? 'Upload failed') : p.file.name}</span>
                                <button type="button" onClick={() => remove(p.key)} disabled={busy} className="rounded p-1 text-fg-muted hover:bg-graphite-800 hover:text-fg disabled:opacity-50" aria-label={`Remove photo ${i + 1}`}>
                                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                                </button>
                            </figcaption>
                        </figure>
                    ))}
                    {photos.length < MAX_PHOTOS && (
                        <div className="flex aspect-[4/3] flex-col items-stretch justify-center gap-2 rounded-xl border border-dashed border-graphite-600 p-3">
                            <Button onClick={() => cameraRef.current?.click()} disabled={busy} data-testid="capture-camera">
                                <Camera className="h-4 w-4" aria-hidden /> Take a photo
                            </Button>
                            <Button variant="secondary" size="sm" onClick={() => libraryRef.current?.click()} disabled={busy} data-testid="capture-library">
                                <ImagePlus className="h-4 w-4" aria-hidden /> Choose photos
                            </Button>
                        </div>
                    )}
                </div>
                <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-label="Take a photo with the camera" data-testid="capture-camera-input" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
                <input ref={libraryRef} type="file" accept={IMAGE_ACCEPT} multiple className="sr-only" tabIndex={-1} aria-label="Choose photos of the broken part" data-testid="capture-input" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
            </section>

            <ul className="mt-5 space-y-2 rounded-xl bg-graphite-900 p-4 ring-1 ring-graphite-700" aria-label="Photo tips">
                <li className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                    <Lightbulb className="h-4 w-4" aria-hidden /> For a good measurement
                </li>
                {tips.map((t) => (
                    <li key={t.text} className="flex gap-2 text-sm text-fg-muted">
                        <t.icon className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" aria-hidden /> {t.text}
                    </li>
                ))}
            </ul>

            <Field label="What happened?" optional hint="For the record only: sizes come from your caliper readings, never from this note." className="mt-5">
                {({ id, describedBy }) => (
                    <TextArea id={id} aria-describedby={describedBy} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="The stove knob cracked and fell off its shaft." data-testid="capture-description" />
                )}
            </Field>

            {error && (
                <Notice tone="error" className="mt-4">
                    {error}
                </Notice>
            )}

            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-fg-subtle">Photos stay private to this build.</p>
                <Button size="lg" onClick={start} disabled={!canContinue} loading={busy} data-testid="capture-continue">
                    Continue to measuring
                </Button>
            </div>
        </div>
    );
}
