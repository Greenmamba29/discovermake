'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { ChevronRight, Fingerprint, KeyRound, LogOut, Sparkles } from 'lucide-react';
import type { MeResponse } from '@/contracts/account';
import { Button, ButtonLink } from '@/components/ui/button';
import { ConfirmAction } from '@/components/ui/confirm-action';
import { Field, TextInput } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { Notice } from '@/components/ui/state';
import { errorMessage, ApiClientError } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { accountApi, useInvalidateAccount, useMe } from './account-api';
import { INTENT_LABELS, interestLabel, ROLE_LABELS } from './labels';
import { addPasskey, passkeyErrorMessage, passkeysSupported } from './passkey-client';

/** /me: profile, creator handle, passkeys, preferences, sign out (ADR-0009). */
export function MeScreen() {
    const me = useMe();
    const viewer = me.data?.viewer ?? null;
    return (
        <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
            <p className="eyebrow">Account</p>
            <h1 className="mt-2 font-display font-wide text-3xl font-extrabold">{viewer ? viewer.displayName || 'Your account' : 'Me'}</h1>
            {me.isPending ? (
                <div className="mt-8 space-y-4" role="status" aria-live="polite">
                    <span className="sr-only">Loading your account…</span>
                    <Skeleton className="h-28" />
                    <Skeleton className="h-40" />
                </div>
            ) : me.isError ? (
                <Notice tone="error" className="mt-8" title="We could not load your account">
                    {errorMessage(me.error)}
                </Notice>
            ) : viewer ? (
                <SignedIn me={me.data!} />
            ) : (
                <SignedOut />
            )}
        </div>
    );
}

function SignedOut() {
    return (
        <section className="mt-8 rounded-2xl bg-graphite-900 p-6 ring-1 ring-graphite-700" aria-labelledby="signed-out-heading" data-testid="me-signed-out">
            <h2 id="signed-out-heading" className="font-display text-xl font-bold">
                Sign in to keep your builds
            </h2>
            <p className="mt-2 text-fg-muted">Your builds, quotes and orders from this browser are saved to your account when you sign in. No password needed.</p>
            <div className="mt-5 flex flex-wrap gap-3">
                <ButtonLink href="/signin?next=/me" size="lg" data-testid="me-signin">
                    Sign in
                </ButtonLink>
                <ButtonLink href="/builds" variant="secondary" size="lg">
                    My builds
                </ButtonLink>
            </div>
        </section>
    );
}

function Card({ title, id, children, action }: { title: string; id: string; children: React.ReactNode; action?: React.ReactNode }) {
    return (
        <section className="rounded-2xl bg-graphite-900 p-5 ring-1 ring-graphite-700 sm:p-6" aria-labelledby={id}>
            <div className="mb-4 flex items-center justify-between gap-3">
                <h2 id={id} className="font-display text-lg font-bold">
                    {title}
                </h2>
                {action}
            </div>
            {children}
        </section>
    );
}

function SignedIn({ me }: { me: MeResponse }) {
    const viewer = me.viewer!;
    const router = useRouter();
    const invalidate = useInvalidateAccount();
    const [signingOut, setSigningOut] = useState(false);
    const isCreator = viewer.roles.includes('creator');

    async function signOut() {
        setSigningOut(true);
        try {
            await accountApi.signOut();
        } finally {
            await invalidate();
            router.replace('/signin');
            router.refresh();
        }
    }

    return (
        <div className="mt-6 flex flex-col gap-5">
            <p className="text-fg-muted" data-testid="me-email">
                {viewer.email}
                {viewer.emailVerified && <span className="ml-2 rounded-full bg-signal/15 px-2 py-0.5 text-xs font-semibold text-signal">Verified</span>}
            </p>
            <ul className="flex flex-wrap gap-2" aria-label="Your roles">
                {viewer.roles.map((r) => (
                    <li key={r} className="rounded-full bg-graphite-750 px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-muted ring-1 ring-inset ring-graphite-600">
                        {ROLE_LABELS[r]}
                    </li>
                ))}
            </ul>

            <nav aria-label="Account shortcuts" className="overflow-hidden rounded-2xl bg-graphite-900 ring-1 ring-graphite-700">
                <ul className="divide-y divide-graphite-700">
                    <Shortcut href="/builds" label="My builds" hint="Reorder, remix or repair" />
                    <Shortcut href="/orders" label="Track an order" hint="Open a private order link" />
                    <Shortcut href="/me/membership" label="Prime membership" hint="Free shipping, priority slots, trial and renewal" />
                    <Shortcut href="/family" label="Family" hint="Kid profiles, Kids mode and requests to approve" />
                    {viewer.roles.includes('shop') && <Shortcut href="/shop" label="Shop Console" hint="Jobs and payouts" />}
                    {(viewer.roles.includes('ops') || viewer.roles.includes('admin')) && <Shortcut href="/admin" label="Ops board" hint="Orders, dispatch, sourcing" />}
                </ul>
            </nav>

            <ProfileCard me={me} />
            {isCreator ? (
                <Card title="Creator" id="creator-heading">
                    <p className="text-fg-muted">
                        You publish as <span className="font-mono font-semibold text-fg">@{viewer.handle}</span>.
                    </p>
                </Card>
            ) : (
                <CreatorCard />
            )}
            <PasskeysCard me={me} />
            <Card title="Preferences" id="prefs-heading">
                {me.preferences.intent || me.preferences.interests.length ? (
                    <div className="text-sm text-fg-muted" data-testid="me-preferences">
                        {me.preferences.intent && (
                            <p>
                                Here to: <span className="font-semibold text-fg">{INTENT_LABELS[me.preferences.intent]}</span>
                            </p>
                        )}
                        {me.preferences.interests.length > 0 && (
                            <ul className="mt-3 flex flex-wrap gap-2" aria-label="Interests">
                                {me.preferences.interests.map((i) => (
                                    <li key={i} className="rounded-full bg-graphite-800 px-3 py-1 text-xs text-fg ring-1 ring-inset ring-graphite-600">
                                        {interestLabel(i)}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                ) : (
                    <p className="text-sm text-fg-muted" data-testid="me-preferences">
                        No preferences yet. Pick what you like to make during onboarding and Discover will follow it.
                    </p>
                )}
            </Card>
            <div>
                <Button variant="secondary" onClick={signOut} loading={signingOut} data-testid="me-signout">
                    {!signingOut && <LogOut className="h-4 w-4" aria-hidden />}
                    Sign out
                </Button>
            </div>
        </div>
    );
}

function Shortcut({ href, label, hint }: { href: string; label: string; hint: string }) {
    return (
        <li>
            <Link href={href} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-graphite-850">
                <span>
                    <span className="block font-semibold text-fg">{label}</span>
                    <span className="block text-xs text-fg-subtle">{hint}</span>
                </span>
                <ChevronRight className="h-4 w-4 text-fg-subtle" aria-hidden />
            </Link>
        </li>
    );
}

function ProfileCard({ me }: { me: MeResponse }) {
    const invalidate = useInvalidateAccount();
    const [name, setName] = useState(me.viewer?.displayName ?? '');
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);
    const [pending, setPending] = useState(false);
    async function save(e: FormEvent) {
        e.preventDefault();
        setError(null);
        setSaved(false);
        if (!name.trim()) return setError('Enter a name, or leave it as it was.');
        setPending(true);
        try {
            await accountApi.updateProfile({ displayName: name.trim() });
            await invalidate();
            setSaved(true);
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setPending(false);
        }
    }
    return (
        <Card title="Profile" id="profile-heading">
            <form onSubmit={save} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <Field label="Display name" error={error} className="flex-1" hint="Shown on your builds and to shops.">
                    {({ id, describedBy, invalid }) => (
                        <TextInput id={id} value={name} maxLength={80} autoComplete="name" onChange={(e) => setName(e.target.value)} aria-describedby={describedBy} aria-invalid={invalid} data-testid="me-display-name" />
                    )}
                </Field>
                <Button type="submit" variant="secondary" loading={pending} className="sm:mt-7">
                    Save
                </Button>
            </form>
            {saved && (
                <p className="mt-2 text-xs text-signal" role="status">
                    Saved.
                </p>
            )}
        </Card>
    );
}

function CreatorCard() {
    const invalidate = useInvalidateAccount();
    const [handle, setHandle] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState(false);
    async function become(e: FormEvent) {
        e.preventDefault();
        setError(null);
        const value = handle.trim().replace(/^@/, '');
        if (!/^[a-z0-9_]{3,24}$/.test(value)) return setError('Use 3–24 lowercase letters, numbers or underscores.');
        setPending(true);
        try {
            await accountApi.updateProfile({ handle: value, becomeCreator: true });
            await invalidate();
        } catch (err) {
            const fe = err instanceof ApiClientError ? (err.details as { fieldErrors?: { handle?: string[] } } | undefined)?.fieldErrors?.handle?.[0] : undefined;
            setError(fe ?? errorMessage(err));
        } finally {
            setPending(false);
        }
    }
    return (
        <Card title="Become a creator" id="creator-heading">
            <p className="mb-4 text-sm text-fg-muted">Publish your designs so others can remix or make them. Pick a public handle to start.</p>
            <form onSubmit={become} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <Field label="Handle" error={error} className="flex-1" hint="Lowercase letters, numbers and underscores.">
                    {({ id, describedBy, invalid }) => (
                        <TextInput id={id} value={handle} maxLength={25} autoCapitalize="none" spellCheck={false} placeholder="your_handle" onChange={(e) => setHandle(e.target.value.toLowerCase())} aria-describedby={describedBy} aria-invalid={invalid} data-testid="me-handle" />
                    )}
                </Field>
                <Button type="submit" loading={pending} className="sm:mt-7" data-testid="me-become-creator">
                    {!pending && <Sparkles className="h-4 w-4" aria-hidden />}
                    Become a creator
                </Button>
            </form>
        </Card>
    );
}

function PasskeysCard({ me }: { me: MeResponse }) {
    const invalidate = useInvalidateAccount();
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [added, setAdded] = useState(false);
    const [supported, setSupported] = useState(true);
    useEffect(() => setSupported(passkeysSupported()), []);

    async function add() {
        setError(null);
        setAdded(false);
        setPending(true);
        try {
            await addPasskey();
            await invalidate();
            setAdded(true);
        } catch (err) {
            const msg = passkeyErrorMessage(err);
            if (msg) setError(msg);
        } finally {
            setPending(false);
        }
    }

    async function remove(id: string) {
        setError(null);
        try {
            await accountApi.deletePasskey(id);
            await invalidate();
        } catch (err) {
            setError(errorMessage(err));
        }
    }

    return (
        <Card
            title="Passkeys"
            id="passkeys-heading"
            action={
                <Button size="sm" onClick={add} loading={pending} disabled={!supported} data-testid="me-add-passkey">
                    {!pending && <Fingerprint className="h-4 w-4" aria-hidden />}
                    Add a passkey
                </Button>
            }
        >
            <p className="text-sm text-fg-muted">Sign in with your fingerprint, face or screen lock instead of an email code.</p>
            {!supported && <p className="mt-2 text-xs text-fg-subtle">This browser does not support passkeys.</p>}
            {error && (
                <Notice tone="error" className="mt-3">
                    {error}
                </Notice>
            )}
            {added && (
                <p className="mt-3 text-sm text-signal" role="status" data-testid="me-passkey-added">
                    Passkey added. Next time, sign in with it.
                </p>
            )}
            {me.passkeys.length > 0 && (
                <ul className="mt-4 divide-y divide-graphite-700 rounded-xl ring-1 ring-graphite-700" data-testid="me-passkeys">
                    {me.passkeys.map((p) => (
                        <li key={p.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                            <span className="flex min-w-0 items-center gap-3">
                                <KeyRound className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
                                <span className="min-w-0">
                                    <span className="block truncate font-medium">{p.name}</span>
                                    <span className="block text-xs text-fg-subtle">
                                        Added {dateTime(p.createdAt)}
                                        {p.lastUsedAt ? ` · last used ${dateTime(p.lastUsedAt)}` : ''}
                                    </span>
                                </span>
                            </span>
                            <ConfirmAction label="Remove" confirmLabel="Remove passkey" prompt={`Remove “${p.name}”?`} variant="ghost" size="sm" onConfirm={() => remove(p.id)} />
                        </li>
                    ))}
                </ul>
            )}
        </Card>
    );
}
