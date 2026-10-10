'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { ExternalLink } from 'lucide-react';
import { LICENSE_LABELS, LICENSE_TEXT, REMIX_LICENSES, ROYALTY_PCT_DEFAULT, ROYALTY_PCT_MAX, type RemixLicense, type StudioPublicationRow } from '@/contracts/media';
import { Button, buttonClass } from '@/components/ui/button';
import { Field, SelectInput, TextArea, TextInput } from '@/components/ui/field';
import { EmptyState, Notice } from '@/components/ui/state';
import { PageSkeleton } from '@/components/ui/skeleton';
import { ApiClientError, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { PreviewArt } from './build-card';
import { mediaApi } from './media-api';
import { StudioNav } from './studio-nav';

/** `/studio/publish`: publish builds with a remix licence and royalty % (workflow 08 publishing). */
export function PublishScreen() {
    const pubs = useQuery({ queryKey: ['media-publications'], queryFn: () => mediaApi.publications(), retry: false });
    if (pubs.error instanceof ApiClientError && pubs.error.status === 401) {
        return (
            <div className="mx-auto w-full max-w-xl px-4 py-16 text-center sm:px-6">
                <h1 className="font-display font-wide text-3xl font-extrabold">Sign in to publish</h1>
                <Link href="/signin?next=/studio/publish" className={buttonClass('primary', 'md', 'mt-6')}>
                    Sign in
                </Link>
            </div>
        );
    }
    return (
        <div className="mx-auto w-full max-w-4xl px-4 pb-16 pt-6 sm:px-6" data-testid="publish-screen">
            <p className="eyebrow">Creator Studio</p>
            <h1 className="mt-1 font-display font-wide text-3xl font-extrabold">Publishing</h1>
            <p className="mt-2 max-w-2xl text-fg-muted">Public builds appear in Discover and on your channel. Pick how others may remix them and the royalty you earn on every Make This or remix order.</p>
            <div className="mt-4">
                <StudioNav />
            </div>
            {pubs.isLoading ? (
                <PageSkeleton label="Loading your builds" />
            ) : pubs.error || !pubs.data ? (
                <Notice tone="error" className="mt-4">
                    {errorMessage(pubs.error)}
                </Notice>
            ) : pubs.data.rows.length === 0 ? (
                <div className="mt-6">
                    <EmptyState title="No builds yet" action={<Link href="/make" className={buttonClass('primary')}>Make something</Link>}>
                        Builds you make while signed in show up here, ready to publish.
                    </EmptyState>
                </div>
            ) : (
                <ul className="mt-6 space-y-4">
                    {pubs.data.rows.map((r) => (
                        <PublishRow key={r.buildId} row={r} />
                    ))}
                </ul>
            )}
        </div>
    );
}

function PublishRow({ row }: { row: StudioPublicationRow }) {
    const qc = useQueryClient();
    const pub = row.publication;
    const [open, setOpen] = useState(false);
    const [visibility, setVisibility] = useState<'private' | 'public'>(pub?.visibility ?? 'public');
    const [license, setLicense] = useState<RemixLicense>(pub?.license ?? 'commercial');
    const [royalty, setRoyalty] = useState(String(pub?.royaltyPct ?? ROYALTY_PCT_DEFAULT));
    const [title, setTitle] = useState(pub?.title ?? row.name);
    const [description, setDescription] = useState(pub?.description ?? '');
    const [tags, setTags] = useState((pub?.tags ?? []).join(', '));
    const [cover, setCover] = useState<string>(pub?.coverUrl ? (row.images[0]?.id ?? '') : '');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
    const isPublic = pub?.visibility === 'public';
    const formId = `publish-${row.buildId}`;

    const save = async (e: FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setMessage(null);
        try {
            const saved = await mediaApi.publish(row.buildId, {
                visibility,
                license,
                royaltyPct: Math.max(0, Math.min(ROYALTY_PCT_MAX, Math.round(Number(royalty) || 0))),
                title: title.trim() || undefined,
                description: description.trim() || undefined,
                tags: tags
                    .split(/[,\s]+/)
                    .map((t) => t.trim().toLowerCase().replace(/^#/, ''))
                    .filter(Boolean)
                    .slice(0, 8),
                coverAttachmentId: cover || null,
            });
            setMessage({ tone: 'success', text: saved.visibility === 'public' ? 'Published. It is live in Discover and on your channel.' : 'Saved as private.' });
            await qc.invalidateQueries({ queryKey: ['media-publications'] });
        } catch (err) {
            setMessage({ tone: 'error', text: errorMessage(err) });
        } finally {
            setBusy(false);
        }
    };

    return (
        <li className="overflow-hidden rounded-2xl bg-graphite-900 ring-1 ring-graphite-700" data-testid="publish-row" data-build-id={row.buildId} data-visibility={pub?.visibility ?? 'unpublished'}>
            <div className="flex items-center gap-3 p-3">
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl">
                    <PreviewArt svg={row.previewSvg} size={row.previewSize} title={row.name} className="h-full p-1" />
                </div>
                <div className="min-w-0 flex-1">
                    <h2 className="truncate font-semibold">{pub?.title ?? row.name}</h2>
                    <p className="text-xs text-fg-muted">
                        <span className="font-mono">{row.displayId}</span> · {row.origin === 'clone' ? 'copy' : row.origin}
                        {pub ? ` · ${LICENSE_LABELS[pub.license]} · ${pub.royaltyPct}%` : ''}
                    </p>
                    <span className={cn('mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold', isPublic ? 'bg-signal/15 text-signal' : 'bg-graphite-800 text-fg-muted')} data-testid="publish-status">
                        {isPublic ? 'Public' : pub ? 'Private' : 'Not published'}
                    </span>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                    {isPublic && (
                        <Link href={`/b/${row.buildId}`} className="inline-flex items-center gap-1 text-xs font-semibold text-fg underline-offset-2 hover:underline" data-testid="publish-view">
                            View <ExternalLink className="h-3 w-3" aria-hidden />
                        </Link>
                    )}
                    <Button size="sm" variant="secondary" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={formId} data-testid="publish-toggle">
                        {open ? 'Close' : pub ? 'Edit' : 'Publish'}
                    </Button>
                </div>
            </div>
            {open && (
                <form id={formId} onSubmit={save} className="space-y-4 border-t border-graphite-700 p-4" data-testid="publish-form">
                    {!row.canPublish && (
                        <Notice tone="warning" title="This build can stay private only">
                            {row.publishBlockedReason}
                        </Notice>
                    )}
                    <fieldset>
                        <legend className="text-sm font-medium">Visibility</legend>
                        <div className="mt-2 flex gap-2">
                            {(['public', 'private'] as const).map((v) => (
                                <label key={v} className={cn('inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl px-4 text-sm ring-1 ring-inset', visibility === v ? 'bg-signal/10 ring-signal/50' : 'ring-graphite-600')}>
                                    <input type="radio" name={`vis-${row.buildId}`} value={v} checked={visibility === v} onChange={() => setVisibility(v)} disabled={v === 'public' && !row.canPublish} data-testid={`publish-visibility-${v}`} />
                                    {v === 'public' ? 'Public' : 'Private'}
                                </label>
                            ))}
                        </div>
                    </fieldset>
                    <fieldset>
                        <legend className="text-sm font-medium">Remix licence</legend>
                        <div className="mt-2 grid gap-2 sm:grid-cols-3">
                            {REMIX_LICENSES.map((l) => (
                                <label key={l} className={cn('flex cursor-pointer gap-2 rounded-xl p-3 text-sm ring-1 ring-inset', license === l ? 'bg-signal/10 ring-signal/50' : 'ring-graphite-600')}>
                                    <input type="radio" name={`lic-${row.buildId}`} value={l} checked={license === l} onChange={() => setLicense(l)} className="mt-0.5" data-testid={`publish-license-${l}`} />
                                    <span>
                                        <span className="block font-semibold">{LICENSE_LABELS[l]}</span>
                                        <span className="text-xs text-fg-muted">{LICENSE_TEXT[l]}</span>
                                    </span>
                                </label>
                            ))}
                        </div>
                    </fieldset>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Royalty on Make This and remix orders (%)" hint={`0–${ROYALTY_PCT_MAX}%, paid from the platform fee`}>
                            {({ id, describedBy }) => <TextInput id={id} aria-describedby={describedBy} inputMode="numeric" value={royalty} onChange={(e) => setRoyalty(e.target.value)} data-testid="publish-royalty" />}
                        </Field>
                        <Field label="Title">{({ id }) => <TextInput id={id} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} data-testid="publish-title" />}</Field>
                    </div>
                    <Field label="Description" optional>
                        {({ id }) => <TextArea id={id} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={3} data-testid="publish-description" />}
                    </Field>
                    <Field label="Tags" hint="Up to 8, separated by commas. Interests like desk-setup or lighting help people find it." optional>
                        {({ id, describedBy }) => <TextInput id={id} aria-describedby={describedBy} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="desk-setup, lighting" data-testid="publish-tags" />}
                    </Field>
                    <Field label="Cover" hint={row.images.length ? 'An image you attached to the build.' : 'Attach a photo in the build workspace to use it as the cover; until then the part preview is shown.'}>
                        {({ id, describedBy }) => (
                            <SelectInput id={id} aria-describedby={describedBy} value={cover} onChange={(e) => setCover(e.target.value)} data-testid="publish-cover">
                                <option value="">Part preview</option>
                                {row.images.map((i) => (
                                    <option key={i.id} value={i.id}>
                                        {i.filename}
                                    </option>
                                ))}
                            </SelectInput>
                        )}
                    </Field>
                    {message && <Notice tone={message.tone} testId="publish-message">{message.text}</Notice>}
                    <Button type="submit" loading={busy} data-testid="publish-save">
                        {visibility === 'public' ? 'Publish' : 'Save as private'}
                    </Button>
                </form>
            )}
        </li>
    );
}
