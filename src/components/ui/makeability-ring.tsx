import { cn } from '@/lib/utils';

/** Makeability ring (DFM score 0..100). Green = signal; amber/ember below thresholds. */
export function MakeabilityRing({ score, size = 72, blocking = false, className }: { score: number; size?: number; blocking?: boolean; className?: string }) {
    const stroke = 6;
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const pct = Math.max(0, Math.min(100, score));
    const color = blocking ? '#f0884b' : pct >= 80 ? '#5fe08a' : pct >= 50 ? '#f2b544' : '#f0884b';
    return (
        <div className={cn('relative inline-flex shrink-0 items-center justify-center', className)} style={{ width: size, height: size }} role="img" aria-label={`Makeability ${pct} out of 100${blocking ? ', blocking issues' : ''}`}>
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
                <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#272b2a" strokeWidth={stroke} />
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    fill="none"
                    stroke={color}
                    strokeWidth={stroke}
                    strokeLinecap="round"
                    strokeDasharray={c}
                    strokeDashoffset={c * (1 - pct / 100)}
                    style={{ transition: 'stroke-dashoffset 400ms ease-out' }}
                />
            </svg>
            <span className="absolute font-mono text-sm font-bold tabular" style={{ color }}>
                {pct}
            </span>
        </div>
    );
}
