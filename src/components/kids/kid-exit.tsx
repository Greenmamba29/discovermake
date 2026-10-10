'use client';

/** Leave Kids mode: the grown-up types their 4-digit PIN on a big keypad. */
import { useState } from 'react';
import { Delete } from 'lucide-react';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { kidsApi } from './kid-api';

export function KidExit() {
    const [pin, setPin] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function submit(value: string) {
        setBusy(true);
        setError(null);
        try {
            const { url } = await kidsApi.exit(value);
            window.location.assign(url);
        } catch (err) {
            setError(errorMessage(err));
            setPin('');
            setBusy(false);
        }
    }

    function press(d: string) {
        if (busy || pin.length >= 4) return;
        const next = pin + d;
        setPin(next);
        if (next.length === 4) void submit(next);
    }

    return (
        <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-5 px-4 py-6" data-testid="kid-exit">
            <h1 className="text-center text-3xl font-extrabold text-ink">Grown-ups only</h1>
            <p className="text-center text-lg text-ink-muted">Hand the device to your grown-up. They type their PIN to leave Kids mode.</p>
            <label htmlFor="kid-pin" className="sr-only">
                Grown-up PIN
            </label>
            <input
                id="kid-pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                pattern="[0-9]*"
                maxLength={4}
                value={pin}
                onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, '').slice(0, 4);
                    setPin(v);
                    if (v.length === 4) void submit(v);
                }}
                className="h-16 w-48 rounded-2xl bg-paper-raised text-center text-4xl tracking-[0.5em] text-ink ring-2 ring-inset ring-paper-line focus:outline-none focus:ring-ink"
                data-testid="kid-pin-input"
            />
            <div className="flex gap-3" aria-hidden>
                {[0, 1, 2, 3].map((i) => (
                    <span key={i} className={cn('h-4 w-4 rounded-full', i < pin.length ? 'bg-ink' : 'bg-paper-line')} />
                ))}
            </div>
            {error && (
                <p className="text-center text-lg font-bold text-[#a8431a]" role="alert" data-testid="kid-pin-error">
                    {error}
                </p>
            )}
            <div className="grid w-full grid-cols-3 gap-3" role="group" aria-label="PIN keypad">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                    <button key={d} type="button" onClick={() => press(d)} disabled={busy} className="h-16 rounded-2xl bg-paper-raised text-2xl font-extrabold text-ink ring-2 ring-inset ring-paper-line hover:bg-white disabled:opacity-60" data-testid={`kid-pin-${d}`}>
                        {d}
                    </button>
                ))}
                <span aria-hidden />
                <button type="button" onClick={() => press('0')} disabled={busy} className="h-16 rounded-2xl bg-paper-raised text-2xl font-extrabold text-ink ring-2 ring-inset ring-paper-line hover:bg-white disabled:opacity-60" data-testid="kid-pin-0">
                    0
                </button>
                <button type="button" onClick={() => setPin((v) => v.slice(0, -1))} disabled={busy} className="flex h-16 items-center justify-center rounded-2xl text-ink hover:bg-ink/5" aria-label="Delete one digit" data-testid="kid-pin-delete">
                    <Delete className="h-7 w-7" aria-hidden />
                </button>
            </div>
        </div>
    );
}
