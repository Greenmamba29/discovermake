'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, TextInput } from '@/components/ui/field';
import { Notice } from '@/components/ui/state';
import { api, errorMessage } from '@/lib/api';
import { useShopSession } from './use-shop-session';

export function ShopLogin() {
    const router = useRouter();
    const qc = useQueryClient();
    const session = useShopSession();
    const [token, setToken] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (session.data) router.replace('/shop/jobs');
    }, [session.data, router]);

    const onSubmit = async (e: FormEvent) => {
        e.preventDefault();
        const t = token.trim();
        if (t.length < 20) {
            setError('Paste the full console token. It starts with dmshop_.');
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const res = await api.shopLogin({ token: t });
            qc.setQueryData(['shop-session'], res);
            router.replace('/shop/jobs');
        } catch (err) {
            setError(errorMessage(err));
            setBusy(false);
        }
    };

    return (
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16 sm:px-6">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-graphite-800 text-signal ring-1 ring-graphite-600" aria-hidden>
                <KeyRound className="h-6 w-6" />
            </span>
            <h1 className="mt-5 font-display font-wide text-3xl font-extrabold">Partner shop sign in</h1>
            <p className="mt-2 text-fg-muted">Use the Shop Console token DiscoverMake issued to your shop. Sessions last 12 hours on this device.</p>
            <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
                <Field label="Console token" error={error} hint="Treat it like a password. Ask DiscoverMake ops to rotate it if it leaks.">
                    {({ id, describedBy, invalid }) => (
                        <TextInput
                            id={id}
                            type="password"
                            autoComplete="current-password"
                            spellCheck={false}
                            value={token}
                            onChange={(e) => setToken(e.target.value)}
                            placeholder="dmshop_…"
                            aria-describedby={describedBy}
                            aria-invalid={invalid}
                            data-testid="shop-token-input"
                            className="font-mono"
                        />
                    )}
                </Field>
                <Button type="submit" className="w-full" size="lg" loading={busy} data-testid="shop-login-submit">
                    Sign in
                </Button>
            </form>
            {session.isLoading && <p className="mt-4 text-center text-xs text-fg-subtle">Checking for an existing session…</p>}
            <Notice tone="info" className="mt-8">
                Not a partner yet? DiscoverMake works with vetted laser and fabrication shops in the US. Reach out through your DiscoverMake contact to get onboarded.
            </Notice>
        </div>
    );
}
