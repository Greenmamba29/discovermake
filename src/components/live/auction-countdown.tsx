'use client';

import { useEffect, useState } from 'react';
import { Timer } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Seconds left until `endsAt` (ticks every 250 ms); flags the anti-snipe window and extensions. */
export function AuctionCountdown({ endsAt, extensions, className }: { endsAt: string; extensions: number; className?: string }) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 250);
        return () => clearInterval(t);
    }, []);
    const left = Math.max(0, Math.ceil((new Date(endsAt).getTime() - now) / 1000));
    const mm = Math.floor(left / 60);
    const ss = String(left % 60).padStart(2, '0');
    return (
        <span className={cn('inline-flex items-center gap-1 font-mono text-sm tabular', left <= 10 ? 'text-live' : 'text-fg', className)} data-testid="auction-countdown" data-ends-at={endsAt} data-extensions={extensions}>
            <Timer className="h-4 w-4" aria-hidden />
            <span aria-label={`${left} seconds left`}>
                {mm}:{ss}
            </span>
            {extensions > 0 && <span className="text-xs text-fg-subtle">+{extensions * 15}s</span>}
        </span>
    );
}
