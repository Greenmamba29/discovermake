'use client';

/** A photo with its reference mark and measurement lines drawn over it (read-only, review step). */
import type { DimensionView, ReconstructPhoto } from '@/contracts/reconstruct';
import { estimateMm } from '@/lib/reconstruct/measure';

const LINE_COLORS = ['#7dd3fc', '#fbbf24', '#f472b6', '#a78bfa', '#34d399', '#fb923c'];

export function PhotoOverlay({ photo, index, dims }: { photo: ReconstructPhoto; index: number; dims: DimensionView[] }) {
    const m = photo.measurements;
    const r = m ? Math.max(6, Math.round(Math.max(m.imageWidth, m.imageHeight) / 90)) : 6;
    const lines = m?.lines.map((l, i) => {
        const label = dims.find((d) => d.param === l.param)?.label ?? 'Unassigned';
        const est = photo.mmPerPx ? estimateMm(l, photo.mmPerPx) : null;
        return { l, i, label, est };
    });
    return (
        <figure className="overflow-hidden rounded-xl bg-graphite-900 ring-1 ring-graphite-700" data-testid="review-photo">
            <div className="relative">
                {photo.url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
                    <img src={photo.url} alt={`Photo ${index + 1} of the broken part with its measurements`} className="block h-auto w-full" />
                ) : (
                    <div className="aspect-[4/3]" />
                )}
                {m && (
                    <svg viewBox={`0 0 ${m.imageWidth} ${m.imageHeight}`} preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
                        {m.reference && <line x1={m.reference.a.x} y1={m.reference.a.y} x2={m.reference.b.x} y2={m.reference.b.y} stroke="#22c55e" strokeWidth={r / 3} strokeDasharray={`${r} ${r / 1.5}`} />}
                        {lines?.map(({ l, i, est }) => (
                            <g key={l.id}>
                                <line x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={r / 3} />
                                {est !== null && (
                                    <text x={(l.a.x + l.b.x) / 2} y={(l.a.y + l.b.y) / 2 - r * 1.5} fill={LINE_COLORS[i % LINE_COLORS.length]} fontSize={r * 2.2} textAnchor="middle" fontWeight={700} stroke="#0b0d10" strokeWidth={r / 4} paintOrder="stroke">
                                        ~{est.toFixed(1)}
                                    </text>
                                )}
                            </g>
                        ))}
                    </svg>
                )}
            </div>
            <figcaption className="px-3 py-2 text-xs text-fg-muted">
                {m?.reference ? `Scale from ${m.reference.preset.replace(/_/g, ' ')}. ` : 'No reference marked. '}
                {lines?.length ? lines.map(({ label, est }) => `${label}${est !== null ? ` ≈ ${est.toFixed(1)} mm` : ''}`).join(' · ') : 'No measurement lines.'} Estimates from photo; the caliper readings were used.
            </figcaption>
        </figure>
    );
}
