'use client';

/**
 * Family (grown-ups): kid profiles and their controls, the grown-up PIN, "Hand to <kid>",
 * the requests inbox (Approve & pay through the normal checkout, or Not this time), the
 * activity log, and Prime Family.
 */
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import {
    defaultControlsFor,
    KID_AGE_BANDS,
    KID_AVATAR_EMOJI,
    KID_AVATARS,
    KID_STAGE_COPY,
    KidNickname,
    type FamilyRequestView,
    type FamilyView,
    type KidAgeBand,
    type KidAvatar,
    type KidProfileView,
} from '@/contracts/kids';
import { KID_TEMPLATE_IDS, KID_TEMPLATES } from '@/contracts/text-to-cad';
import { KidPreview, KID_COLOR_NAMES } from '@/components/kids/kid-preview';
import { familyApi } from '@/components/kids/kid-api';
import { Button } from '@/components/ui/button';
import { ConfirmAction } from '@/components/ui/confirm-action';
import { Field, SelectInput, TextArea, TextInput } from '@/components/ui/field';
import { Notice } from '@/components/ui/state';
import { errorMessage } from '@/lib/api';
import { dateTime, money } from '@/lib/format';
import { cn } from '@/lib/utils';

const LIMITS = [1000, 1500, 2500, 4000, 6000, 10000];

export function FamilyScreen({ initial }: { initial: FamilyView }) {
    const [view, setView] = useState(initial);
    const refresh = async () => setView(await familyApi.get());
    const atMax = view.kids.length >= view.maxKids;

    return (
        <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6" data-testid="family-screen">
            <h1 className="text-3xl font-bold text-fg">Family</h1>
            <p className="mt-2 text-fg-muted">
                Kids design their own projects and ask you. You approve and pay with your own checkout. We only keep a nickname, an age band and an avatar for each kid: no email, photo, address, school or birthday.
            </p>

            <PinCard pinSet={view.pinSet} onSaved={refresh} />

            <section className="mt-8" aria-labelledby="kids-heading">
                <h2 id="kids-heading" className="text-xl font-semibold text-fg">
                    Kids ({view.kids.length} of {view.maxKids})
                </h2>
                {view.kids.length === 0 && <p className="mt-2 text-fg-muted">No kid profiles yet. Add one below.</p>}
                <ul className="mt-4 flex flex-col gap-4">
                    {view.kids.map((kid) => (
                        <KidCard key={kid.id} kid={kid} pinSet={view.pinSet} onChanged={refresh} />
                    ))}
                </ul>
                {atMax ? <p className="mt-4 text-sm text-fg-muted">A family can have up to {view.maxKids} kid profiles.</p> : <AddKid onAdded={refresh} />}
            </section>

            <Requests requests={view.requests} onChanged={refresh} />

            <section className="mt-10 rounded-2xl bg-graphite-900 p-5 ring-1 ring-graphite-700" aria-labelledby="prime-family-heading" data-testid="family-prime">
                <h2 id="prime-family-heading" className="text-lg font-semibold text-fg">
                    Prime Family
                </h2>
                <p className="mt-1 text-sm text-fg-muted">
                    {view.primeMember
                        ? `You’re a Prime member: your kids’ approved orders are your orders, so free standard shipping (orders from ${money(view.freeShippingThresholdCents)}), member pricing, guaranteed dates and priority slots apply automatically.`
                        : 'Prime members share free shipping with their kids’ approved orders. Family works without Prime too.'}
                </p>
                {!view.primeMember && (
                    <Link href="/prime" className="mt-2 inline-flex min-h-[44px] items-center text-sm font-semibold text-signal hover:underline">
                        About Prime
                    </Link>
                )}
            </section>

            <section className="mt-10" aria-labelledby="activity-heading">
                <h2 id="activity-heading" className="text-xl font-semibold text-fg">
                    Activity
                </h2>
                {view.activity.length === 0 ? (
                    <p className="mt-2 text-fg-muted">Nothing yet.</p>
                ) : (
                    <ul className="mt-3 divide-y divide-graphite-700 rounded-xl ring-1 ring-graphite-700" data-testid="family-activity">
                        {view.activity.map((a) => (
                            <li key={a.id} className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                                <span className="text-sm text-fg">{a.summary}</span>
                                <time className="text-xs text-fg-muted" dateTime={a.createdAt}>
                                    {dateTime(a.createdAt)}
                                </time>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <p className="mt-10 text-xs text-fg-muted">
                How we handle kids’ data:{' '}
                <Link href="/legal/privacy" className="font-semibold text-fg underline">
                    Privacy policy, Kids section
                </Link>
                .
            </p>
        </div>
    );
}

function PinCard({ pinSet, onSaved }: { pinSet: boolean; onSaved: () => Promise<void> }) {
    const [pin, setPin] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    async function save() {
        if (!/^\d{4}$/.test(pin)) {
            setError('Use exactly 4 digits.');
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await familyApi.setPin(pin);
            setPin('');
            toast.success('Grown-up PIN saved');
            await onSaved();
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(false);
        }
    }
    return (
        <section className="mt-6 rounded-2xl bg-graphite-900 p-5 ring-1 ring-graphite-700" aria-labelledby="pin-heading">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="pin-heading" className="text-lg font-semibold text-fg">
                    Grown-up PIN
                </h2>
                <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', pinSet ? 'bg-signal/15 text-signal' : 'bg-amber/15 text-amber')} data-testid="family-pin-status">
                    {pinSet ? 'Set' : 'Not set'}
                </span>
            </div>
            <p className="mt-1 text-sm text-fg-muted">You need this 4-digit PIN to leave Kids mode. Kids should not know it.</p>
            <form
                className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end"
                onSubmit={(e) => {
                    e.preventDefault();
                    void save();
                }}
            >
                <Field label={pinSet ? 'New PIN' : 'PIN'} error={error} className="sm:w-48">
                    {({ id, describedBy, invalid }) => (
                        <TextInput id={id} type="password" inputMode="numeric" autoComplete="new-password" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} aria-describedby={describedBy} aria-invalid={invalid} className="h-11" data-testid="family-pin-input" />
                    )}
                </Field>
                <Button type="submit" loading={busy} data-testid="family-pin-save">
                    {pinSet ? 'Change PIN' : 'Save PIN'}
                </Button>
            </form>
        </section>
    );
}

function AvatarPicker({ value, onChange, name }: { value: KidAvatar; onChange: (a: KidAvatar) => void; name: string }) {
    return (
        <div role="radiogroup" aria-label={name} className="grid grid-cols-4 gap-2 sm:grid-cols-8">
            {KID_AVATARS.map((a) => (
                <button key={a} type="button" role="radio" aria-checked={value === a} aria-label={a} onClick={() => onChange(a)} className={cn('flex h-12 items-center justify-center rounded-xl bg-graphite-850 text-2xl ring-1 ring-inset', value === a ? 'ring-2 ring-signal' : 'ring-graphite-600')} data-testid={`kid-avatar-${a}`}>
                    <span aria-hidden>{KID_AVATAR_EMOJI[a]}</span>
                </button>
            ))}
        </div>
    );
}

function AddKid({ onAdded }: { onAdded: () => Promise<void> }) {
    const [nickname, setNickname] = useState('');
    const [ageBand, setAgeBand] = useState<KidAgeBand>('10-12');
    const [avatar, setAvatar] = useState<KidAvatar>('fox');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    async function add() {
        const parsed = KidNickname.safeParse(nickname);
        if (!parsed.success) {
            setError(parsed.error.issues[0]?.message ?? 'Check the nickname.');
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await familyApi.addKid({ nickname: parsed.data, ageBand, avatar });
            setNickname('');
            toast.success(`Added ${parsed.data}`);
            await onAdded();
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(false);
        }
    }
    return (
        <form
            className="mt-6 flex flex-col gap-4 rounded-2xl bg-graphite-900 p-5 ring-1 ring-graphite-700"
            aria-labelledby="add-kid-heading"
            onSubmit={(e) => {
                e.preventDefault();
                void add();
            }}
            data-testid="family-add-kid"
        >
            <h3 id="add-kid-heading" className="text-lg font-semibold text-fg">
                Add a kid
            </h3>
            <Field label="Nickname" hint="A nickname, not a full name. Letters, numbers and spaces, 12 at most." error={error}>
                {({ id, describedBy, invalid }) => <TextInput id={id} value={nickname} maxLength={12} autoComplete="off" onChange={(e) => setNickname(e.target.value)} aria-describedby={describedBy} aria-invalid={invalid} className="h-11" data-testid="kid-nickname" />}
            </Field>
            <fieldset>
                <legend className="text-sm font-medium text-fg">Age band</legend>
                <div className="mt-1.5 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Age band">
                    {KID_AGE_BANDS.map((b) => (
                        <button key={b} type="button" role="radio" aria-checked={ageBand === b} onClick={() => setAgeBand(b)} className={cn('h-11 rounded-xl bg-graphite-850 text-sm font-semibold text-fg ring-1 ring-inset', ageBand === b ? 'ring-2 ring-signal' : 'ring-graphite-600')} data-testid={`kid-age-${b}`}>
                            {b}
                        </button>
                    ))}
                </div>
            </fieldset>
            <fieldset>
                <legend className="text-sm font-medium text-fg">Avatar</legend>
                <div className="mt-1.5">
                    <AvatarPicker value={avatar} onChange={setAvatar} name="Avatar" />
                </div>
            </fieldset>
            <p className="text-xs text-fg-muted">
                Defaults for {ageBand}: {defaultControlsFor(ageBand).liveViewing ? 'Live viewing on' : 'Live viewing off'}, {defaultControlsFor(ageBand).discoverBrowsing ? 'Ideas (kid-safe Discover) on' : 'Kid Projects only'}, {money(defaultControlsFor(ageBand).spendingLimitCents)} per request. You can change these after.
            </p>
            <Button type="submit" loading={busy} className="sm:self-start" data-testid="kid-add">
                Add kid
            </Button>
        </form>
    );
}

function Toggle({ checked, onChange, label, hint, testId }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string; testId: string }) {
    return (
        <label className="flex min-h-[44px] cursor-pointer items-start gap-3">
            <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-5 w-5 accent-signal" data-testid={testId} />
            <span>
                <span className="block text-sm font-medium text-fg">{label}</span>
                <span className="block text-xs text-fg-muted">{hint}</span>
            </span>
        </label>
    );
}

function KidCard({ kid, pinSet, onChanged }: { kid: KidProfileView; pinSet: boolean; onChanged: () => Promise<void> }) {
    const [open, setOpen] = useState(false);
    const [limit, setLimit] = useState(kid.spendingLimitCents);
    const [templates, setTemplates] = useState(kid.allowedTemplates);
    const [live, setLive] = useState(kid.liveViewing);
    const [discover, setDiscover] = useState(kid.discoverBrowsing);
    const [busy, setBusy] = useState<'save' | 'hand' | 'delete' | null>(null);
    const slug = kid.nickname.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    async function save() {
        setBusy('save');
        try {
            await familyApi.updateKid(kid.id, { spendingLimitCents: limit, allowedTemplates: templates, liveViewing: live, discoverBrowsing: discover });
            toast.success(`Saved ${kid.nickname}’s settings`);
            await onChanged();
        } catch (err) {
            toast.error(errorMessage(err));
        } finally {
            setBusy(null);
        }
    }
    async function handOff() {
        setBusy('hand');
        try {
            const { url } = await familyApi.handOff(kid.id);
            window.location.assign(url);
        } catch (err) {
            toast.error(errorMessage(err));
            setBusy(null);
        }
    }
    async function remove() {
        setBusy('delete');
        try {
            await familyApi.deleteKid(kid.id);
            toast.success('Deleted the profile and all of its data');
            await onChanged();
        } catch (err) {
            toast.error(errorMessage(err));
            setBusy(null);
        }
    }

    return (
        <li className="rounded-2xl bg-graphite-900 p-5 ring-1 ring-graphite-700" data-testid={`kid-card-${slug}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-graphite-800 text-2xl" aria-hidden>
                        {KID_AVATAR_EMOJI[kid.avatar]}
                    </span>
                    <div>
                        <h3 className="text-lg font-semibold text-fg">{kid.nickname}</h3>
                        <p className="text-sm text-fg-muted">
                            Age {kid.ageBand} · up to {money(kid.spendingLimitCents)} a request{kid.pendingRequests ? ` · ${kid.pendingRequests} waiting` : ''}
                        </p>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => setOpen((o) => !o)} aria-expanded={open} data-testid={`kid-settings-${slug}`}>
                        Settings
                    </Button>
                    <Button onClick={handOff} loading={busy === 'hand'} disabled={!pinSet} data-testid={`kid-handoff-${slug}`}>
                        Hand to {kid.nickname}
                    </Button>
                </div>
            </div>
            {!pinSet && <p className="mt-2 text-xs text-amber">Set a grown-up PIN first: you need it to leave Kids mode.</p>}
            {open && (
                <div className="mt-4 flex flex-col gap-4 border-t border-graphite-700 pt-4">
                    <Field label="Spending limit per request" hint="Kids can only ask for things up to this price. You still approve every one.">
                        {({ id, describedBy }) => (
                            <SelectInput id={id} value={limit} onChange={(e) => setLimit(Number(e.target.value))} aria-describedby={describedBy} data-testid={`kid-limit-${slug}`}>
                                {[...new Set([...LIMITS, kid.spendingLimitCents])]
                                    .sort((a, b) => a - b)
                                    .map((c) => (
                                        <option key={c} value={c}>
                                            {money(c)}
                                        </option>
                                    ))}
                            </SelectInput>
                        )}
                    </Field>
                    <fieldset>
                        <legend className="text-sm font-medium text-fg">Projects {kid.nickname} can make</legend>
                        <div className="mt-1.5 grid gap-1 sm:grid-cols-2">
                            {KID_TEMPLATE_IDS.map((t) => (
                                <label key={t} className="flex min-h-[44px] items-center gap-3 text-sm text-fg">
                                    <input type="checkbox" className="h-5 w-5 accent-signal" checked={templates.includes(t)} onChange={(e) => setTemplates((cur) => (e.target.checked ? [...cur, t] : cur.filter((x) => x !== t)))} data-testid={`kid-template-${slug}-${t}`} />
                                    {KID_TEMPLATES[t].title} <span className="text-xs text-fg-muted">({KID_TEMPLATES[t].ages})</span>
                                </label>
                            ))}
                        </div>
                    </fieldset>
                    <Toggle checked={live} onChange={setLive} label="Live viewing" hint="Watch only: no chat, no questions, no buying." testId={`kid-live-${slug}`} />
                    <Toggle checked={discover} onChange={setDiscover} label="Ideas (kid-safe Discover)" hint="Only builds our team marked kid-safe. Off: Kid Projects only." testId={`kid-discover-${slug}`} />
                    <div className="flex flex-wrap gap-2">
                        <Button onClick={save} loading={busy === 'save'} data-testid={`kid-save-${slug}`}>
                            Save settings
                        </Button>
                        <ConfirmAction
                            label={`Delete ${kid.nickname}`}
                            confirmLabel="Delete everything"
                            prompt={`Delete ${kid.nickname}’s profile and all of its designs, requests and activity? This cannot be undone.`}
                            onConfirm={remove}
                            variant="caution"
                            loading={busy === 'delete'}
                            testId={`kid-delete-${slug}`}
                        />
                    </div>
                </div>
            )}
        </li>
    );
}

function optionWords(r: FamilyRequestView): string {
    const o = r.options;
    return [o.label ? `“${o.label}”` : null, KID_COLOR_NAMES[o.color].toLowerCase(), o.size, o.angle, o.shape, o.cups ? `${o.cups} cups` : null].filter(Boolean).join(' · ');
}

function Requests({ requests, onChanged }: { requests: FamilyRequestView[]; onChanged: () => Promise<void> }) {
    return (
        <section className="mt-10 scroll-mt-20" id="requests" aria-labelledby="requests-heading">
            <h2 id="requests-heading" className="text-xl font-semibold text-fg">
                Requests
            </h2>
            {requests.length === 0 ? (
                <p className="mt-2 text-fg-muted">When a kid taps “Ask a grown-up”, it shows up here and we email you.</p>
            ) : (
                <ul className="mt-4 flex flex-col gap-4" data-testid="family-requests">
                    {requests.map((r) => (
                        <RequestCard key={r.id} r={r} onChanged={onChanged} />
                    ))}
                </ul>
            )}
        </section>
    );
}

function RequestCard({ r, onChanged }: { r: FamilyRequestView; onChanged: () => Promise<void> }) {
    const [busy, setBusy] = useState<'approve' | 'decline' | null>(null);
    const [declining, setDeclining] = useState(false);
    const [note, setNote] = useState('');
    const paid = r.order && !['PENDING_PAYMENT', 'PAYMENT_FAILED'].includes(r.order.status);
    async function approve() {
        setBusy('approve');
        try {
            const { checkoutUrl } = await familyApi.approve(r.id);
            window.location.assign(checkoutUrl);
        } catch (err) {
            toast.error(errorMessage(err));
            setBusy(null);
        }
    }
    async function decline() {
        setBusy('decline');
        try {
            await familyApi.decline(r.id, note.trim() || undefined);
            setDeclining(false);
            await onChanged();
        } catch (err) {
            toast.error(errorMessage(err));
        } finally {
            setBusy(null);
        }
    }
    return (
        <li className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700" data-testid="family-request" data-status={r.status}>
            <div className="flex flex-col gap-4 sm:flex-row">
                <div className="w-full shrink-0 sm:w-44">
                    <KidPreview template={r.template} options={r.options} title={`${r.kidNickname}’s ${r.templateTitle.toLowerCase()}`} />
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-sm text-fg-muted">
                        <span aria-hidden>{KID_AVATAR_EMOJI[r.kidAvatar]} </span>
                        {r.kidNickname} asked
                    </p>
                    <h3 className="text-lg font-semibold text-fg">{r.templateTitle}</h3>
                    <p className="text-sm text-fg-muted">{optionWords(r)}</p>
                    <p className="mt-1 text-base font-semibold text-fg" data-testid="family-request-price">
                        {money(r.priceCents, r.currency)} <span className="text-xs font-normal text-fg-muted">binding 3D-print quote, plus shipping</span>
                    </p>
                    <p className="mt-1 text-sm text-fg" data-testid="family-request-stage">
                        {r.status === 'pending' ? 'Waiting for you' : r.status === 'declined' ? 'You said not this time' : paid ? `${KID_STAGE_COPY[r.stage]} · order ${r.order!.orderNumber}` : 'Approved, not paid yet'}
                    </p>
                    {r.note && <p className="mt-1 text-xs text-fg-muted">Your note: “{r.note}”</p>}
                    {!paid && r.status !== 'declined' && (
                        <div className="mt-3 flex flex-wrap gap-2">
                            <Button onClick={approve} loading={busy === 'approve'} data-testid="family-approve">
                                {r.status === 'approved' ? 'Pay now' : 'Approve & pay'}
                            </Button>
                            {r.status === 'pending' && !declining && (
                                <Button variant="secondary" onClick={() => setDeclining(true)} data-testid="family-decline">
                                    Not this time
                                </Button>
                            )}
                        </div>
                    )}
                    {declining && (
                        <div className="mt-3 flex flex-col gap-2">
                            <Field label="A kind note (optional)" hint="Your kid sees this in My things.">
                                {({ id, describedBy }) => <TextArea id={id} rows={2} maxLength={140} value={note} onChange={(e) => setNote(e.target.value)} aria-describedby={describedBy} data-testid="family-decline-note" />}
                            </Field>
                            <div className="flex gap-2">
                                <Button variant="ghost" onClick={() => setDeclining(false)}>
                                    Cancel
                                </Button>
                                <Button variant="secondary" onClick={decline} loading={busy === 'decline'} data-testid="family-decline-confirm">
                                    Send “Not this time”
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
            {r.status === 'pending' && (
                <Notice tone="info" className="mt-3">
                    Approving takes you to your normal checkout. If you have Prime, free shipping and guaranteed dates apply automatically.
                </Notice>
            )}
        </li>
    );
}
