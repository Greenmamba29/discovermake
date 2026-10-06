'use client';

import { useState } from 'react';
import { Ruler } from 'lucide-react';
import type { PartUnits, PartView } from '@/contracts';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/state';
import { FlatPattern } from '@/components/part/part-preview';
import { api, errorMessage } from '@/lib/api';

/** Units confirm prompt for NEEDS_INPUT parts (the DXF has no reliable $INSUNITS). */
export function UnitsPrompt({ part, onAnalyzed }: { part: PartView; onAnalyzed: (p: PartView) => void }) {
    const [busy, setBusy] = useState<PartUnits | null>(null);
    const [error, setError] = useState<string | null>(null);
    const w = part.preview?.widthMm ?? null;
    const h = part.preview?.heightMm ?? null;

    const choose = async (units: PartUnits) => {
        setBusy(units);
        setError(null);
        try {
            onAnalyzed(await api.analyzePart(part.id, { units }));
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(null);
        }
    };

    const fmt = (v: number) => (v >= 100 ? v.toFixed(0) : v.toFixed(2));
    return (
        <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6" data-testid="units-prompt">
            <p className="eyebrow">{part.buildDisplayId} · {part.filename}</p>
            <h1 className="mt-2 font-display font-wide text-3xl font-extrabold">Which units is this drawing in?</h1>
            <p className="mt-3 text-fg-muted">The file does not say whether it was drawn in millimetres or inches. Pick one so we can size and price it correctly.</p>
            {part.preview && (
                <div className="mt-6 h-56 rounded-2xl bg-graphite-900 p-6 ring-1 ring-graphite-700">
                    <FlatPattern preview={part.preview} />
                </div>
            )}
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {(['mm', 'in'] as const).map((u) => (
                    <Button key={u} variant="secondary" size="lg" className="h-auto flex-col items-start py-4 text-left" loading={busy === u} disabled={busy !== null} onClick={() => choose(u)} data-testid={`units-${u}`}>
                        <span className="flex items-center gap-2 text-base">
                            <Ruler className="h-4 w-4" aria-hidden /> {u === 'mm' ? 'Millimetres' : 'Inches'}
                        </span>
                        {w != null && h != null && (
                            <span className="font-mono text-xs font-normal text-fg-muted">
                                {u === 'mm' ? `${fmt(w)} × ${fmt(h)} mm (${fmt(w / 25.4)} × ${fmt(h / 25.4)} in)` : `${fmt(w)} × ${fmt(h)} in (${fmt(w * 25.4)} × ${fmt(h * 25.4)} mm)`}
                            </span>
                        )}
                    </Button>
                ))}
            </div>
            {error && (
                <Notice tone="error" className="mt-4" title="Could not re-analyze the file">
                    {error}
                </Notice>
            )}
        </div>
    );
}
