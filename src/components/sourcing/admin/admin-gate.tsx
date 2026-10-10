'use client';

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Field, TextInput } from '@/components/ui/field';
import { ApiClientError, errorMessage } from '@/lib/api';
import { sourcingApi } from '../api';

/** Same sessionStorage key as the ops board, so one sign-in covers /admin and /admin/sourcing. */
export const ADMIN_TOKEN_KEY = 'dm.adminToken';

function readToken(): string | null {
    try {
        return window.sessionStorage.getItem(ADMIN_TOKEN_KEY);
    } catch {
        return null;
    }
}

export function isUnauthorized(err: unknown): boolean {
    return err instanceof ApiClientError && (err.status === 401 || err.status === 403);
}

/** Admin bearer token gate for the sourcing desk. The token lives in this tab only. */
export function AdminGate({ children }: { children: (token: string, signOut: () => void) => ReactNode }) {
    const [token, setToken] = useState<string | null>(null);
    const [ready, setReady] = useState(false);
    useEffect(() => {
        setToken(readToken());
        setReady(true);
    }, []);
    const signOut = useCallback(() => {
        try {
            window.sessionStorage.removeItem(ADMIN_TOKEN_KEY);
        } catch {
            /* ignore */
        }
        setToken(null);
    }, []);
    if (!ready) return null;
    if (!token) return <DeskLogin onToken={setToken} />;
    return <>{children(token, signOut)}</>;
}

function DeskLogin({ onToken }: { onToken: (t: string) => void }) {
    const [value, setValue] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const submit = async (e: FormEvent) => {
        e.preventDefault();
        const t = value.trim();
        setBusy(true);
        setError(null);
        try {
            await sourcingApi.adminApprovals(t, 'PENDING');
            try {
                window.sessionStorage.setItem(ADMIN_TOKEN_KEY, t);
            } catch {
                /* session-only fallback: keep it in memory */
            }
            onToken(t);
        } catch (err) {
            setError(isUnauthorized(err) ? 'That admin token was not accepted.' : errorMessage(err));
        } finally {
            setBusy(false);
        }
    };
    return (
        <div className="mx-auto w-full max-w-md px-4 py-16 sm:px-6">
            <p className="eyebrow">Operations</p>
            <h1 className="mt-2 font-display font-wide text-3xl font-extrabold">Sourcing desk</h1>
            <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
                <Field label="Admin token" error={error} hint="Kept in this tab only and cleared when you close it.">
                    {({ id, describedBy, invalid }) => (
                        <TextInput id={id} type="password" className="font-mono" value={value} onChange={(e) => setValue(e.target.value)} aria-describedby={describedBy} aria-invalid={invalid} data-testid="sourcing-admin-token-input" />
                    )}
                </Field>
                <Button type="submit" className="w-full" loading={busy} disabled={!value.trim()} data-testid="sourcing-admin-login-submit">
                    Open sourcing desk
                </Button>
            </form>
        </div>
    );
}
