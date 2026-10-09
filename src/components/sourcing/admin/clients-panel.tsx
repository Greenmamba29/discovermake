'use client';

import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, KeyRound } from 'lucide-react';
import type { CreateSourcingClientResponse } from '@/contracts';
import { Button } from '@/components/ui/button';
import { ConfirmAction } from '@/components/ui/confirm-action';
import { Field, TextInput } from '@/components/ui/field';
import { Notice } from '@/components/ui/state';
import { errorMessage } from '@/lib/api';
import { sourcingApi } from '../api';
import { allowlistSummary, ClientAllowlistEditor } from './client-allowlist';

/**
 * Accio clients (MCP bearer tokens): create one per Accio Work workspace, limit it to some
 * tools and IP ranges (per-workspace allowlist), and revoke it.
 * The token is shown exactly once; only its sha256 is stored server-side.
 */
export function ClientsPanel({ token }: { token: string }) {
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [created, setCreated] = useState<CreateSourcingClientResponse | null>(null);
    const [copied, setCopied] = useState(false);
    const queryClient = useQueryClient();
    const clientsKey = ['sourcing-clients', token];
    const clients = useQuery({ queryKey: clientsKey, queryFn: () => sourcingApi.adminListClients(token) });
    // Cancel any in-flight load first so a list fetched before this write can't win.
    const refresh = async () => {
        await queryClient.cancelQueries({ queryKey: clientsKey });
        await queryClient.refetchQueries({ queryKey: clientsKey });
    };
    const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
    const [editing, setEditing] = useState<string | null>(null);

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
            void refresh();
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
            void refresh();
            if (created?.clientId === clientId) setCreated(null);
            setNotice({ tone: 'success', text: `Client ${clientId} revoked. Its token stops working immediately.` });
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

            <div>
                <h2 className="eyebrow mb-2">Accio clients</h2>
                {clients.isPending ? (
                    <p className="text-sm text-fg-muted">Loading clients…</p>
                ) : clients.isError ? (
                    <Notice tone="error">{errorMessage(clients.error)}</Notice>
                ) : clients.data.length === 0 ? (
                    <p className="text-sm text-fg-muted" data-testid="clients-empty">
                        No clients yet. Create one for each Accio Work workspace.
                    </p>
                ) : (
                    <ul className="divide-y divide-graphite-700 rounded-2xl bg-graphite-900 ring-1 ring-graphite-700" data-testid="clients-list">
                        {clients.data.map((c) => (
                            <li key={c.clientId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                                <div className="min-w-0 flex-1">
                                    <p className="font-semibold">{c.name}</p>
                                    <p className="font-mono text-[11px] text-fg-subtle">
                                        {c.clientId} · last used {c.lastUsedAt ? new Date(c.lastUsedAt).toLocaleString() : 'never'}
                                    </p>
                                    <p className="break-words text-xs text-fg-muted" data-testid={`client-allowlist-${c.clientId}`}>
                                        Allowlist: {allowlistSummary(c)}
                                    </p>
                                </div>
                                {c.revokedAt ? (
                                    <span className="text-xs text-fg-subtle">Revoked</span>
                                ) : (
                                    <div className="flex flex-wrap gap-2">
                                        <Button variant="secondary" size="sm" onClick={() => setEditing(editing === c.clientId ? null : c.clientId)} aria-expanded={editing === c.clientId} data-testid={`client-allowlist-edit-${c.clientId}`}>
                                            Allowlist
                                        </Button>
                                        <ConfirmAction label="Revoke" confirmLabel="Revoke now" prompt="Revoke this client? Its token stops working immediately and its leased jobs return to the queue." variant="caution" size="sm" onConfirm={() => revoke(c.clientId)} testId={`client-revoke-${c.clientId}`} />
                                    </div>
                                )}
                                {editing === c.clientId && !c.revokedAt && (
                                    <ClientAllowlistEditor
                                        token={token}
                                        client={c}
                                        onCancel={() => setEditing(null)}
                                        onSaved={(row) => {
                                            setEditing(null);
                                            void refresh();
                                            setNotice({ tone: 'success', text: `Allowlist for ${row.name} saved: ${allowlistSummary(row)}. It applies to the next MCP request.` });
                                        }}
                                    />
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
