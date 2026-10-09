'use client';

/**
 * Object View (600-3, 300-2): the build's GLB in a 3D viewport with measurements, modelled on
 * the Microsoft Copilot 3D-object screen (Mobbin): a large viewport beside a properties panel
 * with Download and Recreate actions.
 *
 * - The GLB comes from the latest CAD record (`GET /api/builds/:id/cad`, signed URLs).
 * - three.js loads lazily (next/dynamic, ssr: false) and only when WebGL is available.
 * - Without WebGL, or without a GLB, it shows the 2D DXF flat pattern or a dimensioned
 *   isometric box; without CAD at all, an honest empty state.
 * - The dimensions are always available as text (and as the canvas's accessible name).
 */
import dynamic from 'next/dynamic';
import { Component, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Box, Boxes, Download, Grid3x3, Maximize2, RotateCcw, Ruler, Sparkles } from 'lucide-react';
import type { BuildGraphView } from '@/contracts';
import type { BuildCadArtifactView, BuildCadGenerated, CadFamily } from '@/contracts/cad';
import { FlatPattern } from '@/components/part/part-preview';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, Notice } from '@/components/ui/state';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { PanelCard } from '../panels';
import { cadQueryKey, workspaceApi } from '../workspace-api';
import type { WorkspaceSection } from '../workspace-model';
import { dimensionRows, dimensionSummary, distance3, formatBbox, formatLength, type LengthUnit, type Vec3 } from './geometry';
import { IsoBoxPreview, webglAvailable } from './static-preview';

const ObjectViewport3D = dynamic(() => import('./object-viewport-3d'), {
    ssr: false,
    loading: () => <div className="skeleton h-full w-full rounded-none" aria-hidden />,
});

const FAMILY_LABEL: Record<CadFamily, string> = { sheet_panel: 'Flat sheet panel', l_bracket: 'Bent L-bracket', enclosure: 'Enclosure with lid' };
const KIND_LABEL: Record<BuildCadArtifactView['kind'], string> = { STEP: 'CAD model', DXF: 'Flat pattern', GLB: '3D preview' };

class ViewerBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() {
        return { failed: true };
    }
    componentDidCatch(err: unknown) {
        console.warn('Object View: the 3D model could not be shown, falling back to 2D.', err);
    }
    render() {
        return this.state.failed ? this.props.fallback : this.props.children;
    }
}

const bboxOf = (record: BuildCadGenerated): Vec3 => record.metrics.bbox_mm as unknown as Vec3;

function useCad(buildId: string) {
    return useQuery({ queryKey: cadQueryKey(buildId), queryFn: ({ signal }) => workspaceApi.cad(buildId, signal) });
}

function ToggleButton({ pressed, onClick, children, testId, disabled }: { pressed: boolean; onClick: () => void; children: ReactNode; testId: string; disabled?: boolean }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={pressed}
            disabled={disabled}
            data-testid={testId}
            className={cn(
                'inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold ring-1 ring-inset transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-signal disabled:opacity-40',
                pressed ? 'bg-graphite-700 text-fg ring-graphite-500' : 'bg-graphite-850 text-fg-muted ring-graphite-700 hover:text-fg',
            )}
        >
            {children}
        </button>
    );
}

export function UnitToggle({ unit, onChange }: { unit: LengthUnit; onChange: (u: LengthUnit) => void }) {
    return (
        <div role="group" aria-label="Units" className="inline-flex gap-1 rounded-xl bg-graphite-900 p-1 ring-1 ring-graphite-700">
            {(['mm', 'in'] as const).map((u) => (
                <ToggleButton key={u} pressed={unit === u} onClick={() => onChange(u)} testId={`object-unit-${u}`}>
                    {u === 'mm' ? 'Millimetres' : 'Inches'}
                </ToggleButton>
            ))}
        </div>
    );
}

function Dimensions({ record, unit }: { record: BuildCadGenerated; unit: LengthUnit }) {
    const bbox = bboxOf(record);
    const rows = dimensionRows(bbox, unit);
    const volumeCm3 = record.metrics.volume_mm3 / 1000;
    return (
        <>
            <dl className="divide-y divide-graphite-700 rounded-xl bg-graphite-850 px-3 ring-1 ring-inset ring-graphite-700" data-testid="object-dimensions" aria-label="Overall dimensions">
                {rows.map((r) => (
                    <div key={r.axis} className="flex items-baseline justify-between gap-3 py-2">
                        <dt className="text-sm text-fg-muted">
                            <span className="font-mono text-xs text-fg-subtle">{r.axis}</span> {r.label}
                        </dt>
                        <dd className="font-mono text-sm tabular text-fg" data-testid={`object-dim-${r.axis}`}>
                            {r.text}
                        </dd>
                    </div>
                ))}
            </dl>
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
                <span>
                    Volume <span className="font-mono text-fg">{unit === 'in' ? `${(volumeCm3 / 16.387064).toFixed(2)} in³` : `${volumeCm3.toFixed(1)} cm³`}</span>
                </span>
                {record.metrics.thickness_mm ? (
                    <span>
                        Thickness <span className="font-mono text-fg">{formatLength(record.metrics.thickness_mm, unit)}</span>
                    </span>
                ) : null}
                {record.metrics.bend_count ? <span>{record.metrics.bend_count} bend{record.metrics.bend_count === 1 ? '' : 's'}</span> : null}
            </p>
        </>
    );
}

function DownloadPanel({ artifacts }: { artifacts: BuildCadArtifactView[] }) {
    const order: BuildCadArtifactView['kind'][] = ['STEP', 'DXF', 'GLB'];
    const sorted = [...artifacts].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
    return (
        <ul className="space-y-2" data-testid="object-downloads">
            {sorted.map((a) => (
                <li key={a.filename}>
                    <a
                        href={a.url}
                        download={a.filename}
                        className="flex items-center justify-between gap-3 rounded-xl bg-graphite-850 px-3 py-2.5 text-sm ring-1 ring-inset ring-graphite-700 hover:ring-signal focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal"
                        data-testid={`object-download-${a.kind}`}
                    >
                        <span className="flex min-w-0 items-center gap-2">
                            <Download className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden />
                            <span className="min-w-0 truncate">
                                <span className="font-semibold">{a.kind}</span> <span className="text-fg-muted">{KIND_LABEL[a.kind]}</span>
                                <span className="sr-only"> download</span>
                            </span>
                        </span>
                        <span className="shrink-0 font-mono text-xs text-fg-subtle">{Math.max(1, Math.round(a.bytes / 1024))} KB</span>
                    </a>
                </li>
            ))}
        </ul>
    );
}

/** 2D fallback: the DXF flat pattern when there is one, else the dimensioned box. */
function Fallback({ record, unit, reason }: { record: BuildCadGenerated; unit: LengthUnit; reason: string }) {
    const part = useQuery({ queryKey: ['part', record.partId], queryFn: () => api.getPart(record.partId!), enabled: Boolean(record.partId), retry: false });
    const bbox = bboxOf(record);
    const preview = part.data?.preview ?? null;
    return (
        <div className="flex h-full w-full flex-col" data-testid="object-fallback">
            <div className="flex min-h-0 flex-1 items-center justify-center p-6">
                {preview ? (
                    <FlatPattern preview={preview} />
                ) : (
                    <IsoBoxPreview bbox={bbox} unit={unit} label={`Bounding box drawing. ${dimensionSummary(bbox, unit)}`} className="h-full max-h-[320px] w-full" />
                )}
            </div>
            <p className="px-4 pb-3 text-center text-xs text-fg-muted" data-testid="object-fallback-reason">
                {preview ? 'Showing the 2D flat pattern. ' : 'Showing the bounding box. '}
                {reason}
            </p>
        </div>
    );
}

export function ObjectView({ view, onGo }: { view: BuildGraphView; onGo: (s: WorkspaceSection) => void }) {
    const buildId = view.build.id;
    const cad = useCad(buildId);
    const [webgl, setWebgl] = useState<boolean | null>(null);
    const [unit, setUnit] = useState<LengthUnit>('mm');
    const [showBox, setShowBox] = useState(true);
    const [wireframe, setWireframe] = useState(false);
    const [measuring, setMeasuring] = useState(false);
    const [points, setPoints] = useState<Vec3[]>([]);
    const [resetSignal, setResetSignal] = useState(0);
    const [loaded, setLoaded] = useState<Vec3 | null>(null);
    useEffect(() => setWebgl(webglAvailable()), []);

    const record = cad.data ?? null;
    const glb = record?.artifacts.find((a) => a.kind === 'GLB') ?? null;
    const expected = useMemo(() => (record ? bboxOf(record) : null), [record]);
    const onPick = useCallback((p: Vec3) => setPoints((prev) => (prev.length >= 2 ? [p] : [...prev, p])), []);
    const onLoaded = useCallback((size: Vec3) => setLoaded(size), []);

    if (cad.isPending) return <Skeleton className="h-[420px] w-full rounded-2xl" />;
    if (cad.isError) {
        return (
            <Notice tone="error" title="Could not load the 3D model" action={<Button size="sm" variant="secondary" onClick={() => cad.refetch()}>Try again</Button>}>
                {errorMessage(cad.error)}
            </Notice>
        );
    }
    if (!record) {
        return (
            <EmptyState
                title="Generate CAD to see the 3D model"
                icon={<Box className="h-8 w-8" aria-hidden />}
                action={
                    <Button onClick={() => onGo('overview')} data-testid="object-go-cad">
                        Go to CAD
                    </Button>
                }
            >
                <span data-testid="object-empty">The Object View shows the model once CAD is generated from an approved version, with its dimensions and downloads.</span>
            </EmptyState>
        );
    }

    const bbox = bboxOf(record);
    const summary = dimensionSummary(bbox, unit);
    const use3d = webgl === true && Boolean(glb);
    const reason = !glb ? 'This CAD version has no 3D preview file.' : webgl === false ? '3D needs WebGL, which this browser has turned off.' : '';
    const distance = points.length === 2 ? distance3(points[0]!, points[1]!) : null;

    return (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]" data-testid="object-view">
            <section aria-label="3D model" className="min-w-0 space-y-3">
                <div className="relative h-[340px] overflow-hidden rounded-2xl bg-graphite-900 ring-1 ring-graphite-700 sm:h-[440px]" data-testid="object-viewport">
                    {webgl === null ? (
                        <div className="skeleton h-full w-full rounded-none" aria-hidden />
                    ) : use3d && glb ? (
                        <ViewerBoundary fallback={<Fallback record={record} unit={unit} reason="The 3D model could not be shown." />}>
                            <ObjectViewport3D
                                url={glb.url}
                                expectedBboxMm={expected}
                                unit={unit}
                                showBox={showBox}
                                wireframe={wireframe}
                                measuring={measuring}
                                points={points}
                                resetSignal={resetSignal}
                                label={`3D model of ${view.build.name}. ${summary}`}
                                onPick={onPick}
                                onLoaded={onLoaded}
                            />
                            {!loaded && <p className="pointer-events-none absolute inset-x-0 top-3 text-center text-xs text-fg-muted">Loading the 3D model…</p>}
                        </ViewerBoundary>
                    ) : (
                        <Fallback record={record} unit={unit} reason={reason} />
                    )}
                    <p className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-graphite-950/80 px-2 py-1 font-mono text-[11px] text-fg-muted" aria-hidden>
                        {formatBbox(bbox, unit)}
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="3D view controls">
                    <ToggleButton pressed={measuring} onClick={() => { setMeasuring((m) => !m); setPoints([]); }} disabled={!use3d} testId="object-measure">
                        <Ruler className="h-3.5 w-3.5" aria-hidden /> Measure
                    </ToggleButton>
                    <ToggleButton pressed={wireframe} onClick={() => setWireframe((w) => !w)} disabled={!use3d} testId="object-wireframe">
                        <Grid3x3 className="h-3.5 w-3.5" aria-hidden /> Wireframe
                    </ToggleButton>
                    <ToggleButton pressed={showBox} onClick={() => setShowBox((s) => !s)} disabled={!use3d} testId="object-bbox">
                        <Boxes className="h-3.5 w-3.5" aria-hidden /> Bounding box
                    </ToggleButton>
                    <Button size="sm" variant="secondary" onClick={() => { setResetSignal((n) => n + 1); setPoints([]); }} disabled={!use3d} data-testid="object-reset">
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reset view
                    </Button>
                    <UnitToggle unit={unit} onChange={setUnit} />
                </div>
                <p className="text-sm text-fg-muted" aria-live="polite" data-testid="object-measure-readout">
                    {measuring
                        ? distance !== null
                            ? `Distance between the two points: ${formatLength(distance, unit)}. Click again to start a new measurement.`
                            : points.length === 1
                              ? 'Now click a second point on the part.'
                              : 'Click two points on the part to measure the distance between them.'
                        : use3d
                          ? 'Drag to orbit, scroll or pinch to zoom.'
                          : ''}
                </p>
            </section>

            <aside className="min-w-0 space-y-4" aria-label="Properties and downloads">
                <PanelCard title="Properties" icon={<Maximize2 className="h-5 w-5" />} testId="object-properties">
                    <p className="mb-3 text-sm">
                        <span className="font-semibold">{FAMILY_LABEL[record.family]}</span>
                        <span className="text-fg-muted"> · version {record.version}</span>
                    </p>
                    <Dimensions record={record} unit={unit} />
                    <p className="sr-only" data-testid="object-summary">
                        {summary}
                    </p>
                    {loaded && Math.abs(Math.max(...loaded) - Math.max(...bbox)) > 1 && (
                        <p className="mt-2 text-xs text-amber">The 3D preview measures {formatBbox(loaded, unit)}; the CAD numbers above are authoritative.</p>
                    )}
                </PanelCard>
                <PanelCard title="Download" icon={<Download className="h-5 w-5" />} testId="object-download-panel">
                    <DownloadPanel artifacts={record.artifacts} />
                </PanelCard>
                <PanelCard title="Recreate" icon={<Sparkles className="h-5 w-5" />}>
                    <p className="text-sm text-fg-muted">Ask Make AI for a change, then approve the new version and generate CAD again. Sizes only change when you state them.</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" onClick={() => onGo('assistant')} data-testid="object-ask-make-ai">
                            <Sparkles className="h-3.5 w-3.5" aria-hidden /> Ask Make AI
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => onGo('overview')}>
                            Regenerate CAD
                        </Button>
                    </div>
                </PanelCard>
            </aside>
        </div>
    );
}

/** Overview card: a light, static preview (no three.js) with the dimensions and a link into the Object View. */
export function ObjectViewCard({ view, onGo }: { view: BuildGraphView; onGo: (s: WorkspaceSection) => void }) {
    const cad = useCad(view.build.id);
    const record = cad.data ?? null;
    return (
        <PanelCard title="Object" icon={<Box className="h-5 w-5" />} testId="workspace-object-card">
            {cad.isPending ? (
                <Skeleton className="h-32 w-full" />
            ) : !record ? (
                <p className="text-sm text-fg-muted" data-testid="object-card-empty">
                    Generate CAD to see the 3D model.
                </p>
            ) : (
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                    <div className="h-32 w-full shrink-0 rounded-xl bg-graphite-850 p-2 ring-1 ring-inset ring-graphite-700 sm:w-48">
                        <IsoBoxPreview bbox={bboxOf(record)} unit="mm" label={`Bounding box drawing. ${dimensionSummary(bboxOf(record), 'mm')}`} className="h-full w-full" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">{FAMILY_LABEL[record.family]}</p>
                        <p className="mt-1 font-mono text-sm text-fg-muted" data-testid="object-card-dims">
                            {formatBbox(bboxOf(record), 'mm')}
                        </p>
                        <Button size="sm" className="mt-3" onClick={() => onGo('object')} data-testid="object-card-open">
                            Open the 3D view
                        </Button>
                    </div>
                </div>
            )}
        </PanelCard>
    );
}
