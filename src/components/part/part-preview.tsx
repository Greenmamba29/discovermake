'use client';

import dynamic from 'next/dynamic';
import { Component, useEffect, useState, type ReactNode } from 'react';
import { Box, Layers } from 'lucide-react';
import type { MaterialCategory, PartFeatures, PartPreview as PartPreviewData } from '@/contracts';
import { cn } from '@/lib/utils';

const PartViewer3D = dynamic(() => import('./part-viewer-3d'), {
    ssr: false,
    loading: () => <div className="skeleton h-full w-full rounded-none" aria-hidden />,
});

class ViewerBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() {
        return { failed: true };
    }
    componentDidCatch(err: unknown) {
        console.warn('3D preview unavailable, showing the flat pattern instead.', err);
    }
    render() {
        return this.state.failed ? this.props.fallback : this.props.children;
    }
}

function webglAvailable(): boolean {
    try {
        const c = document.createElement('canvas');
        return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
    } catch {
        return false;
    }
}

/** Flat-pattern SVG (server-provided path, already y-flipped; viewBox = 0 0 width height). */
export function FlatPattern({ preview, className, tone = 'graphite' }: { preview: PartPreviewData; className?: string; tone?: 'graphite' | 'paper' }) {
    const pad = Math.max(preview.widthMm, preview.heightMm) * 0.06;
    return (
        <svg
            viewBox={`${-pad} ${-pad} ${preview.widthMm + pad * 2} ${preview.heightMm + pad * 2}`}
            className={cn('h-full w-full', className)}
            role="img"
            aria-label={`Flat pattern, ${preview.widthMm.toFixed(1)} by ${preview.heightMm.toFixed(1)} millimetres`}
            preserveAspectRatio="xMidYMid meet"
        >
            <path d={preview.svgPath} fillRule="evenodd" fill={tone === 'paper' ? '#151716' : '#a9afab'} stroke={tone === 'paper' ? '#151716' : '#eceeeb'} strokeWidth={Math.max(preview.widthMm, preview.heightMm) / 600} />
            {preview.bendLines.map(([a, b], i) => (
                <line
                    key={i}
                    x1={a[0]}
                    y1={preview.heightMm - a[1]}
                    x2={b[0]}
                    y2={preview.heightMm - b[1]}
                    stroke="#5fe08a"
                    strokeWidth={Math.max(preview.widthMm, preview.heightMm) / 250}
                    strokeDasharray={`${preview.widthMm / 60} ${preview.widthMm / 90}`}
                />
            ))}
        </svg>
    );
}

/** Text alternative for the 3D viewport (WCAG: every 3D view has a dimensions list). */
export function PartDimensions({ preview, features, thicknessLabel }: { preview: PartPreviewData; features: PartFeatures | null; thicknessLabel?: string | null }) {
    const rows: [string, string][] = [
        ['Width', `${preview.widthMm.toFixed(1)} mm (${(preview.widthMm / 25.4).toFixed(2)} in)`],
        ['Height', `${preview.heightMm.toFixed(1)} mm (${(preview.heightMm / 25.4).toFixed(2)} in)`],
    ];
    if (thicknessLabel) rows.push(['Thickness', thicknessLabel]);
    if (features) {
        rows.push(['Cut length', `${(features.cutLengthMm / 1000).toFixed(2)} m`]);
        rows.push(['Holes and cutouts', String(features.innerContourCount)]);
        rows.push(['Pierces', String(features.pierceCount)]);
        rows.push(['Bend lines', String(features.bendCount)]);
        if (features.smallestHoleMm != null) rows.push(['Smallest hole', `Ø${features.smallestHoleMm.toFixed(2)} mm`]);
    }
    return (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3" data-testid="part-dimensions">
            {rows.map(([k, v]) => (
                <div key={k} className="min-w-0">
                    <dt className="eyebrow">{k}</dt>
                    <dd className="mt-0.5 truncate font-mono text-fg tabular">{v}</dd>
                </div>
            ))}
        </dl>
    );
}

/** Object-first viewport: 3D extrusion (default) or flat pattern, with a WebGL-safe fallback. */
export function PartPreview({
    preview,
    thicknessMm,
    color,
    category,
    className,
}: {
    preview: PartPreviewData;
    thicknessMm: number;
    color?: string;
    category?: MaterialCategory | null;
    className?: string;
}) {
    const [mode, setMode] = useState<'3d' | 'flat'>('3d');
    const [canWebgl, setCanWebgl] = useState<boolean | null>(null);
    useEffect(() => setCanWebgl(webglAvailable()), []);
    const flat = (
        <div className="flex h-full w-full items-center justify-center p-6">
            <FlatPattern preview={preview} />
        </div>
    );
    const show3d = mode === '3d' && canWebgl !== false;

    return (
        <div className={cn('relative overflow-hidden rounded-2xl bg-graphite-900 ring-1 ring-graphite-700', className)}>
            <div className="absolute inset-0">
                {canWebgl === null ? (
                    <div className="skeleton h-full w-full rounded-none" aria-hidden />
                ) : show3d ? (
                    <ViewerBoundary fallback={flat}>
                        <PartViewer3D preview={preview} thicknessMm={thicknessMm} color={color} category={category} />
                    </ViewerBoundary>
                ) : (
                    flat
                )}
            </div>
            <div className="absolute left-3 top-3 flex gap-1 rounded-xl bg-graphite-950/80 p-1 ring-1 ring-graphite-700 backdrop-blur" role="group" aria-label="Preview mode">
                <button
                    type="button"
                    onClick={() => setMode('3d')}
                    disabled={canWebgl === false}
                    aria-pressed={show3d}
                    className={cn('inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold', show3d ? 'bg-graphite-700 text-fg' : 'text-fg-muted hover:text-fg', 'disabled:opacity-40')}
                >
                    <Box className="h-3.5 w-3.5" aria-hidden /> 3D
                </button>
                <button
                    type="button"
                    onClick={() => setMode('flat')}
                    aria-pressed={!show3d}
                    className={cn('inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold', !show3d ? 'bg-graphite-700 text-fg' : 'text-fg-muted hover:text-fg')}
                >
                    <Layers className="h-3.5 w-3.5" aria-hidden /> Flat
                </button>
            </div>
            <p className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-graphite-950/70 px-2 py-1 font-mono text-[11px] text-fg-muted">
                {preview.widthMm.toFixed(1)} × {preview.heightMm.toFixed(1)} × {thicknessMm.toFixed(2)} mm
            </p>
            {show3d && <p className="pointer-events-none absolute bottom-3 right-3 hidden text-[11px] text-fg-subtle sm:block">Drag to orbit · scroll to zoom</p>}
        </div>
    );
}
