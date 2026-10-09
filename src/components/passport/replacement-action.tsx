'use client';

/**
 * "Order a replacement" (1000-3) on the public passport: a fresh instant quote for the same
 * part design (same verified file, material, thickness, finish; quantity 1), then the
 * configurator. Needs nothing beyond the passport link; no buyer data goes in or out.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCcw } from 'lucide-react';
import { ReplacementResponse } from '@/contracts/workspace';
import { apiFetch, errorMessage } from '@/lib/api';

export function ReplacementAction({ passportId, summary, disabled }: { passportId: string; summary: string; disabled?: boolean }) {
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const order = async () => {
        setBusy(true);
        setError(null);
        try {
            const res = ReplacementResponse.parse(await apiFetch<unknown>(`/api/passport/${encodeURIComponent(passportId)}/replacement`, { body: { quantity: 1 } }));
            router.push(res.url);
        } catch (err) {
            setError(errorMessage(err));
            setBusy(false);
        }
    };
    return (
        <div className="rounded-2xl bg-paper-raised p-5 ring-1 ring-paper-line" data-testid="passport-replacement">
            <p className="flex items-center gap-2 font-semibold text-ink">
                <RefreshCcw className="h-5 w-5 text-ink-muted" aria-hidden /> Replacement part
            </p>
            <p className="mt-2 text-xs leading-relaxed text-ink-muted">{summary} Quantity 1. You get a fresh instant quote; nothing is charged until checkout.</p>
            <button
                type="button"
                onClick={order}
                disabled={busy || disabled}
                className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-xl bg-ink text-sm font-semibold text-paper hover:bg-black disabled:opacity-60"
                data-testid="passport-order-replacement"
            >
                {busy ? 'Preparing your quote…' : 'Order a replacement'}
            </button>
            {error && (
                <p className="mt-3 text-sm text-[#7a3109]" role="alert">
                    {error}
                </p>
            )}
        </div>
    );
}
