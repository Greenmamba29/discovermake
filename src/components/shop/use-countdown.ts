'use client';

import { useEffect, useState } from 'react';

/** Remaining time until `iso` as "1h 04m", refreshed every 30 s; null when unset. */
export function useCountdown(iso: string | null): { label: string; expired: boolean } | null {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!iso) return;
        const t = setInterval(() => setNow(Date.now()), 30_000);
        return () => clearInterval(t);
    }, [iso]);
    if (!iso) return null;
    const ms = new Date(iso).getTime() - now;
    if (ms <= 0) return { label: 'expired', expired: true };
    const mins = Math.floor(ms / 60_000);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return { label: h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`, expired: false };
}
