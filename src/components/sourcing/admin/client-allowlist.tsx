'use client';

import { useState, type FormEvent } from 'react';
import { SOURCING_TOOL_NAMES } from '@/contracts/sourcing';
import { Button } from '@/components/ui/button';
import { Field, TextArea } from '@/components/ui/field';
import { errorMessage } from '@/lib/api';
import { normalizeCidr } from '@/lib/cidr';
import { sourcingApi, type SourcingClientRow } from '../api';

const TOOL_LABEL: Record<(typeof SOURCING_TOOL_NAMES)[number], string> = {
    next_job: 'Lease jobs (next_job)',
    get_job: 'Read jobs (get_job)',
    get_attachments: 'Download packages (get_attachments)',
    submit_supplier: 'Register suppliers (submit_supplier)',
    submit_offer: 'Submit offers (submit_offer)',
    update_negotiation: 'Log negotiations (update_negotiation)',
    attach_document: 'Attach documents (attach_document)',
    request_approval: 'Request approvals (request_approval)',
    complete_job: 'Complete jobs (complete_job)',
};

/** One-line summary of a client's allowlist for the clients list. */
export function allowlistSummary(c: Pick<SourcingClientRow, 'allowedTools' | 'allowedCidrs'>): string {
    const tools = c.allowedTools ? `${c.allowedTools.length} of ${SOURCING_TOOL_NAMES.length} tools` : 'all tools';
    const ips = c.allowedCidrs ? c.allowedCidrs.join(', ') : 'any IP';
    return `${tools} · ${ips}`;
}

/**
 * Per-workspace MCP allowlist: which of the nine tools the Accio workspace may list and call,
 * and which client IP ranges its token is accepted from. Everything checked and an empty IP
 * list mean "no restriction" (stored as null).
 */
export function ClientAllowlistEditor({ token, client, onSaved, onCancel }: { token: string; client: SourcingClientRow; onSaved: (row: SourcingClientRow) => void; onCancel: () => void }) {
    const [tools, setTools] = useState<Set<string>>(new Set(client.allowedTools ?? SOURCING_TOOL_NAMES));
    const [cidrs, setCidrs] = useState((client.allowedCidrs ?? []).join('\n'));
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const toggle = (t: string) =>
        setTools((prev) => {
            const next = new Set(prev);
            if (next.has(t)) next.delete(t);
            else next.add(t);
            return next;
        });

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        if (tools.size === 0) {
            setError('Allow at least one tool, or revoke the client instead.');
            return;
        }
        const lines = cidrs
            .split(/[\s,]+/)
            .map((l) => l.trim())
            .filter(Boolean);
        const bad = lines.find((l) => !normalizeCidr(l));
        if (bad) {
            setError(`"${bad}" is not an IP address or CIDR range (e.g. 203.0.113.0/24).`);
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const allTools = SOURCING_TOOL_NAMES.every((t) => tools.has(t));
            const row = await sourcingApi.adminUpdateClientAllowlist(token, client.clientId, {
                allowedTools: allTools ? null : SOURCING_TOOL_NAMES.filter((t) => tools.has(t)),
                allowedCidrs: lines.length ? lines : null,
            });
            onSaved(row);
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <form onSubmit={submit} noValidate className="mt-3 w-full space-y-3 rounded-xl bg-graphite-850 p-3 ring-1 ring-graphite-600" data-testid={`client-allowlist-form-${client.clientId}`}>
            <fieldset>
                <legend className="text-sm font-semibold">Tools this workspace may use</legend>
                <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                    {SOURCING_TOOL_NAMES.map((t) => (
                        <label key={t} className="flex min-w-0 items-center gap-2 text-sm">
                            <input type="checkbox" checked={tools.has(t)} onChange={() => toggle(t)} className="h-4 w-4 accent-signal" data-testid={`allow-tool-${t}`} />
                            <span className="min-w-0 break-words">{TOOL_LABEL[t]}</span>
                        </label>
                    ))}
                </div>
            </fieldset>
            <Field label="Allowed IP ranges" hint="One IP or CIDR per line, e.g. 203.0.113.0/24. Leave empty to accept any IP." error={error}>
                {({ id, describedBy, invalid }) => (
                    <TextArea id={id} rows={3} value={cidrs} onChange={(e) => setCidrs(e.target.value)} aria-describedby={describedBy} aria-invalid={invalid} className="font-mono text-xs" data-testid="allow-cidrs" />
                )}
            </Field>
            <div className="flex flex-wrap gap-2">
                <Button type="submit" size="sm" loading={busy} data-testid="client-allowlist-save">
                    Save allowlist
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
                    Cancel
                </Button>
            </div>
        </form>
    );
}
