'use client';

import { useState, type FormEvent } from 'react';
import { Check, Copy, KeyRound } from 'lucide-react';
import type { CreateSourcingClientResponse } from '@/contracts';
import { Button } from '@/components/ui/button';
import { ConfirmAction } from '@/components/ui/confirm-action';
import { Field, TextInput } from '@/components/ui/field';
import { Notice } from '@/components/ui/state';
import { errorMessage } from '@/lib/api';
import { sourcingApi } from '../api';

/**
 * Accio clients (MCP bearer tokens): create one per Accio Work workspace and revoke it.
 * The token is shown exactly once; only its sha256 is stored server-side.
 */
export function ClientsPanel({ token }: { token: string }) {
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [created, setCreated] = useState<CreateSourcingClientResponse | null>(null);
    const [copied, setCopied] = useState(false);
    const [session, setSession] = useState<{ clientId: string; name: string; revoked: boolean }[]>([]);
    const [revokeId, setRevokeId] = useState('');
    const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

    const create = async (e: FormEvent) => {
        e.preventDefault();
        if (!name.trim()) {
            setError('Name the workspace, e.g. "Accio Work · sheet metal".');
            return;
        }
        setBusy(true);
        setError(null);
        setCopied(false);
        try {
            const res = await sourcingApi.adminCreateClient(token, name.trim());
            setCreated(res);
            setSession((s) => [{ clientId: res.clientId, name: res.name, revoked: false }, ...s]);
            setName('');
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(false);
        }
    };

    const copy = async () => {
        if (!created) return;
        try {
            await navigator.clipboard.writeText(created.token);
            setCopied(true);
        } catch {
            setCopied(false);
            setNotice({ tone: 'error', text: 'Copy failed. Select the token and copy it manually.' });
        }
    };

    const revoke = async (clientId: string) => {
        setNotice(null);
        try {
            await sourcingApi.adminRevokeClient(token, clientId);
            setSession((s) => s.map((c) => (c.clientId === clientId ? { ...c, revoked: true } : c)));
            if (created?.clientId === clientId) setCreated(null);
            setNotice({ tone: 'success', text: `Client ${clientId} revoked. Its token stops working immediately.` });
            setRevokeId('');
        } catch (err) {
            setNotice({ tone: 'error', text: errorMessage(err) });
        }
    };

    return (
        <div className="space-y-6">
            <form onSubmit={create} noValidate className="space-y-3 rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700">
                <h2 className="font-display text-lg font-bold">New Accio client</h2>
                <p className="text-sm text-fg-muted">Creates a bearer token for one Accio Work workspace to call the DiscoverMake Sourcing MCP server.</p>
                <Field label="Workspace name" error={error}>
                    {({ id, describedBy, invalid }) => (
                        <TextInput id={id} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} aria-describedby={describedBy} aria-invalid={invalid} data-testid="client-name-input" />
                    )}
                </Field>
                <Button type="submit" loading={busy} data-testid="client-create">
                    <KeyRound className="h-4 w-4" aria-hidden /> Create client
                </Button>
            </form>

            {created && (
                <div className="space-y-2 rounded-2xl bg-signal/10 p-4 ring-1 ring-inset ring-signal/30" data-testid="client-token-once" role="status">
                    <p className="font-semibold">Token for {created.name}</p>
                    <p className="text-sm text-fg-muted">Copy it now. It is shown once and cannot be retrieved again.</p>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <code className="min-w-0 flex-1 break-all rounded-lg bg-graphite-900 px-3 py-2 font-mono text-xs text-fg ring-1 ring-graphite-700" data-testid="client-token">
                            {created.token}
                        </code>
                        <Button variant="secondary" size="sm" onClick={copy} data-testid="client-token-copy">
                            {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                            {copied ? 'Copied' : 'Copy token'}
                        </Button>
                    </div>
                    <p className="font-mono text-[11px] text-fg-subtle">client {created.clientId}</p>
                    <Button variant="ghost" size="sm" onClick={() => setCreated(null)}>
                        I saved it, hide token
                    </Button>
                </div>
            )}

            {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

            {session.length > 0 && (
                <div>
                    <h2 className="eyebrow mb-2">Created in this session</h2>
                    <ul className="divide-y divide-graphite-700 rounded-2xl bg-graphite-900 ring-1 ring-graphite-700">
                        {session.map((c) => (
                            <li key={c.clientId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                                <div className="min-w-0 flex-1">
                                    <p className="font-semibold">{c.name}</p>
                                    <p className="font-mono text-[11px] text-fg-subtle">{c.clientId}</p>
                                </div>
                                {c.revoked ? (
                                    <span className="text-xs text-fg-subtle">Revoked</span>
                                ) : (
                                    <ConfirmAction label="Revoke" confirmLabel="Revoke now" prompt="Revoke this client? Its token stops working immediately." variant="caution" size="sm" onConfirm={() => revoke(c.clientId)} testId={`client-revoke-${c.clientId}`} />
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <div className="space-y-2 rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700">
                <h2 className="font-display text-lg font-bold">Revoke a client</h2>
                <Field label="Client id" hint="Starts with scl_. Revoking cannot be undone.">
                    {({ id, describedBy }) => <TextInput id={id} className="font-mono" value={revokeId} onChange={(e) => setRevokeId(e.target.value)} aria-describedby={describedBy} placeholder="scl_…" data-testid="client-revoke-id" />}
                </Field>
                <ConfirmAction
                    label="Revoke client"
                    confirmLabel="Revoke now"
                    prompt="Revoke this client? Its token stops working immediately."
                    variant="caution"
                    size="sm"
                    disabled={!/^scl_[A-Za-z0-9_-]+$/.test(revokeId.trim())}
                    onConfirm={() => revoke(revokeId.trim())}
                    testId="client-revoke-by-id"
                />
            </div>
        </div>
    );
}
