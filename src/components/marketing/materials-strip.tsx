'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** Live materials strip from GET /api/catalog (buyer-safe: names, swatches, thickness range). */
export function MaterialsStrip() {
    const { data, isLoading, isError } = useQuery({ queryKey: ['catalog'], queryFn: api.catalog, staleTime: 5 * 60_000 });

    if (isError) {
        return <p className="text-sm text-ink-muted">Aluminum, steel, stainless, brass, acrylic, birch plywood and walnut. Open the configurator to see every thickness.</p>;
    }
    if (isLoading || !data) {
        return (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-busy="true" aria-label="Loading materials">
                {Array.from({ length: 8 }).map((_, i) => (
                    <li key={i} className="skeleton h-[92px]" />
                ))}
            </ul>
        );
    }
    return (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {data.materials.map((m) => {
                const t = m.thicknessOptions;
                const min = Math.min(...t.map((o) => o.thicknessMm));
                const max = Math.max(...t.map((o) => o.thicknessMm));
                return (
                    <li key={m.id} className="flex items-center gap-3 rounded-xl bg-paper-raised p-3 ring-1 ring-paper-line">
                        <span className="h-12 w-12 shrink-0 rounded-lg ring-1 ring-black/10" style={{ background: `linear-gradient(135deg, ${m.swatchHex}, ${m.swatchHex}cc 60%, #ffffff55)` }} aria-hidden />
                        <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-ink">{m.name}</span>
                            <span className="block font-mono text-[11px] text-ink-subtle">
                                {min.toFixed(1)}–{max.toFixed(1)} mm · {t.length} {t.length === 1 ? 'gauge' : 'gauges'}
                            </span>
                        </span>
                    </li>
                );
            })}
        </ul>
    );
}
