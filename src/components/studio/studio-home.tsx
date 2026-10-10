'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { CalendarPlus, Radio } from 'lucide-react';
import { CHANNEL_CATEGORIES, SHOW_FORMATS, type ChannelCategory, type ChannelView, type ShowView, type StudioOverview } from '@/contracts/live';
import { Button, buttonClass } from '@/components/ui/button';
import { Field, SelectInput, TextArea, TextInput } from '@/components/ui/field';
import { Notice } from '@/components/ui/state';
import { PageSkeleton } from '@/components/ui/skeleton';
import { ApiClientError, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { liveApi } from '@/components/live/live-api';
import { LiveBadge } from '@/components/live/live-badge';
import { CATEGORY_LABELS } from '@/components/live/live-home';
import { StudioNav } from '@/components/media/studio-nav';
import { GoLiveChecklist } from './go-live-checklist';

export const FORMAT_LABELS: Record<(typeof SHOW_FORMATS)[number], string> = {
    creator_live: 'Creator Live: show an invention',
    product_live: 'Product Live: several products',
    live_drop: 'Live Drop: sell Build Slots',
    build_live: 'Build Live: customers watch their build',
    factory_live: 'Factory Live: a shop cell',
};

/** Pull `bld_…` ids out of pasted ids or build links. */
export function parseBuildIds(text: string): string[] {
    return [...new Set(text.match(/bld_[A-Za-z0-9_-]+/g) ?? [])].slice(0, 10);
}

export function StudioHome() {
    const studio = useQuery({ queryKey: ['studio'], queryFn: () => liveApi.studio(), retry: false });

    if (studio.isLoading) return <PageSkeleton label="Opening Creator Studio" />;
    if (studio.error instanceof ApiClientError && studio.error.status === 401) {
        return (
            <div className="mx-auto w-full max-w-xl px-4 py-16 text-center sm:px-6">
                <p className="eyebrow">Creator Studio</p>
                <h1 className="mt-2 font-display font-wide text-3xl font-extrabold">Sign in to go live</h1>
                <p className="mt-2 text-fg-muted">Creator Studio is where you set up your channel, plan shows and run the control room.</p>
                <Link href="/signin?next=/studio" className={buttonClass('primary', 'md', 'mt-6')}>
                    Sign in
                </Link>
            </div>
        );
    }
    if (studio.error || !studio.data) {
        return (
            <div className="mx-auto w-full max-w-xl px-4 py-16 sm:px-6">
                <h1 className="font-display text-2xl font-bold">Creator Studio</h1>
                <Notice tone="error" className="mt-4">
                    {errorMessage(studio.error)}
                </Notice>
            </div>
        );
    }
    const data = studio.data;
    return (
        <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6">
            <p className="eyebrow">Creator Studio</p>
            <h1 className="mt-1 font-display font-wide text-3xl font-extrabold">{data.channel ? data.channel.name : 'Your channel'}</h1>
            {data.channel && (
                <p className="mt-1 text-sm text-fg-muted">
                    <Link href={`/c/${data.channel.handle}`} className="underline-offset-2 hover:underline" data-testid="studio-channel-link">
                        @{data.channel.handle}
                    </Link>{' '}
                    · {data.channel.followerCount} followers
                </p>
            )}
            {data.viewer.isCreator && (
                <div className="mt-4">
                    <StudioNav />
                </div>
            )}
            <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
                <div className="min-w-0 space-y-6">
                    {!data.viewer.isCreator ? <BecomeCreator onDone={() => void studio.refetch()} /> : <ChannelForm channel={data.channel} onSaved={() => void studio.refetch()} />}
                    {data.channel && <ShowPlanner onCreated={() => void studio.refetch()} />}
                    {data.channel && <ShowList shows={data.shows} />}
                </div>
                <aside className="space-y-4">
                    <GoLiveChecklist checklist={data.checklist} />
                    {data.nextShowId && (
                        <Link href={`/studio/shows/${data.nextShowId}`} className={buttonClass('primary', 'md', 'w-full')} data-testid="open-next-control-room">
                            <Radio className="h-4 w-4" aria-hidden /> Open the control room
                        </Link>
                    )}
                </aside>
            </div>
        </div>
    );
}

function BecomeCreator({ onDone }: { onDone: () => void }) {
    const [handle, setHandle] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const submit = async (e: FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            await liveApi.becomeCreator(handle.trim().toLowerCase());
            onDone();
        } catch (err) {
            setError(err instanceof ApiClientError && err.status === 404 ? 'Creator sign-up opens with accounts. Ask the team to enable your creator role.' : errorMessage(err));
        } finally {
            setBusy(false);
        }
    };
    return (
        <form onSubmit={submit} className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700 sm:p-5" data-testid="become-creator">
            <h2 className="font-display text-xl font-bold">Become a creator</h2>
            <p className="mt-1 text-sm text-fg-muted">Pick your public handle. You can set up your channel right after.</p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
                <Field label="Handle" hint="3–24 lowercase letters, numbers or underscores." className="flex-1">
                    {({ id, describedBy }) => <TextInput id={id} aria-describedby={describedBy} value={handle} onChange={(e) => setHandle(e.target.value)} data-testid="creator-handle" />}
                </Field>
                <Button type="submit" loading={busy} disabled={!/^[a-z0-9_]{3,24}$/.test(handle.trim().toLowerCase())}>
                    Become a creator
                </Button>
            </div>
            {error && <Notice tone="warning" className="mt-3">{error}</Notice>}
        </form>
    );
}

function ChannelForm({ channel, onSaved }: { channel: ChannelView | null; onSaved: () => void }) {
    const [editing, setEditing] = useState(!channel);
    const [name, setName] = useState(channel?.name ?? '');
    const [handle, setHandle] = useState(channel?.handle ?? '');
    const [bio, setBio] = useState(channel?.bio ?? '');
    const [categories, setCategories] = useState<ChannelCategory[]>(channel?.categories ?? []);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (channel && !editing) {
        return (
            <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700" data-testid="channel-summary">
                <div className="min-w-0">
                    <h2 className="font-display text-lg font-bold">Channel</h2>
                    <p className="text-sm text-fg-muted">
                        {channel.name} · @{channel.handle} · {channel.categories.map((c) => CATEGORY_LABELS[c]).join(', ') || 'No categories'}
                    </p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                    Edit channel
                </Button>
            </section>
        );
    }

    const toggle = (c: ChannelCategory) => setCategories((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : cur.length >= 3 ? cur : [...cur, c]));
    const submit = async (e: FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            await liveApi.upsertChannel({ name: name.trim(), handle: handle.trim().toLowerCase(), kind: 'creator', categories, bio: bio.trim() || undefined });
            setEditing(false);
            onSaved();
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(false);
        }
    };
    return (
        <form onSubmit={submit} className="space-y-4 rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700 sm:p-5" data-testid="channel-form">
            <h2 className="font-display text-xl font-bold">{channel ? 'Edit your channel' : 'Set up your channel'}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Channel name">{({ id }) => <TextInput id={id} value={name} onChange={(e) => setName(e.target.value)} data-testid="channel-name" />}</Field>
                <Field label="Handle" hint="Shown as @handle.">
                    {({ id, describedBy }) => <TextInput id={id} aria-describedby={describedBy} value={handle} onChange={(e) => setHandle(e.target.value)} data-testid="channel-handle" />}
                </Field>
            </div>
            <fieldset>
                <legend className="text-sm font-medium">Categories (up to 3)</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                    {CHANNEL_CATEGORIES.map((c) => (
                        <button
                            key={c}
                            type="button"
                            aria-pressed={categories.includes(c)}
                            onClick={() => toggle(c)}
                            className={cn('h-9 rounded-full px-3.5 text-sm font-semibold ring-1 ring-inset', categories.includes(c) ? 'bg-fg text-graphite-950 ring-fg' : 'text-fg-muted ring-graphite-600')}
                            data-testid={`channel-category-${c}`}
                        >
                            {CATEGORY_LABELS[c]}
                        </button>
                    ))}
                </div>
            </fieldset>
            <Field label="Bio" optional>
                {({ id }) => <TextArea id={id} value={bio} maxLength={280} onChange={(e) => setBio(e.target.value)} data-testid="channel-bio" />}
            </Field>
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" loading={busy} data-testid="channel-save">
                Save channel
            </Button>
        </form>
    );
}

function defaultStart(): string {
    const d = new Date(Date.now() + 10 * 60_000);
    d.setSeconds(0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ShowPlanner({ onCreated }: { onCreated: () => void }) {
    const [title, setTitle] = useState('');
    const [format, setFormat] = useState<(typeof SHOW_FORMATS)[number]>('live_drop');
    const [start, setStart] = useState(defaultStart);
    const [hlsUrl, setHlsUrl] = useState('');
    const [builds, setBuilds] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const ids = parseBuildIds(builds);

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            await liveApi.createShow({ title: title.trim(), format, scheduledFor: new Date(start).toISOString(), hlsUrl: hlsUrl.trim() || undefined, featuredBuildIds: ids });
            setTitle('');
            setBuilds('');
            onCreated();
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(false);
        }
    };
    return (
        <form onSubmit={submit} className="space-y-4 rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700 sm:p-5" data-testid="show-planner">
            <h2 className="flex items-center gap-2 font-display text-xl font-bold">
                <CalendarPlus className="h-5 w-5 text-fg-muted" aria-hidden /> Plan a show
            </h2>
            <Field label="Title">{({ id }) => <TextInput id={id} value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} data-testid="show-title-input" />}</Field>
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Format">
                    {({ id }) => (
                        <SelectInput id={id} value={format} onChange={(e) => setFormat(e.target.value as typeof format)} data-testid="show-format">
                            {SHOW_FORMATS.map((f) => (
                                <option key={f} value={f}>
                                    {FORMAT_LABELS[f]}
                                </option>
                            ))}
                        </SelectInput>
                    )}
                </Field>
                <Field label="Starts">{({ id }) => <TextInput id={id} type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} data-testid="show-start" />}</Field>
            </div>
            <Field label="Builds to feature" hint={ids.length ? `${ids.length} build${ids.length === 1 ? '' : 's'} found` : 'Paste build links or ids (bld_…), one per line.'}>
                {({ id, describedBy }) => <TextArea id={id} aria-describedby={describedBy} value={builds} onChange={(e) => setBuilds(e.target.value)} data-testid="show-builds" />}
            </Field>
            <Field label="HLS source" optional hint="Owncast or MediaMTX playlist URL. Leave empty to use LiveKit (when connected) or a poster.">
                {({ id, describedBy }) => <TextInput id={id} aria-describedby={describedBy} type="url" value={hlsUrl} onChange={(e) => setHlsUrl(e.target.value)} data-testid="show-hls" />}
            </Field>
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" loading={busy} disabled={title.trim().length < 3} data-testid="show-create">
                Schedule show
            </Button>
        </form>
    );
}

function ShowList({ shows }: { shows: StudioOverview['shows'] }) {
    return (
        <section aria-labelledby="shows-heading" className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700" data-testid="studio-shows">
            <h2 id="shows-heading" className="font-display text-lg font-bold">
                Your shows
            </h2>
            {shows.length === 0 ? (
                <p className="mt-2 text-sm text-fg-muted">No shows yet. Plan your first one above.</p>
            ) : (
                <ul className="mt-2 divide-y divide-graphite-700">
                    {shows.map((s: ShowView) => (
                        <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3" data-testid="studio-show">
                            <div className="min-w-0">
                                <p className="truncate font-semibold">{s.title}</p>
                                <p className="flex items-center gap-2 text-xs text-fg-muted">
                                    <LiveBadge status={s.status} /> <span className="font-mono">{s.displayId}</span> · {new Date(s.scheduledFor).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                                </p>
                            </div>
                            <div className="flex gap-2">
                                <Link href={`/live/${s.id}`} className={buttonClass('ghost', 'sm')}>
                                    View
                                </Link>
                                {s.status !== 'ENDED' && s.status !== 'CANCELLED' && (
                                    <Link href={`/studio/shows/${s.id}`} className={buttonClass('secondary', 'sm')} data-testid="control-room-link">
                                        Control room
                                    </Link>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
