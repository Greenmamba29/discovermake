'use client';

/**
 * Measure on the photo (R6): mark a reference object of known size to set the mm/px scale, then
 * draw measurement lines (diameter, length, hole spacing, thickness) to get ESTIMATES.
 *
 * The photo is drawn at its natural pixel size inside an SVG canvas (viewBox = image pixels), so
 * every point is stored in image pixels whatever the screen size. Input:
 *   - touch / mouse: tap two points to place a segment (after "Mark reference" / "Add line"),
 *     or drag any handle;
 *   - keyboard: every handle is focusable; arrow keys move it 1 px (Shift: 10 px);
 *   - numbers: every line's estimate is an editable number (moves its end point).
 * Estimates are labelled "estimate from photo"; the caliper step decides.
 */
import { useCallback, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Plus, Ruler, ScanSearch, Trash2 } from 'lucide-react';
import {
    MEASUREMENT_KINDS,
    PERSPECTIVE_CAVEAT,
    REFERENCE_PRESETS,
    type DimensionDef,
    type MeasurementKind,
    type MeasurementLine,
    type PhotoMeasurements,
    type PixelPoint,
    type ReferencePresetKey,
} from '@/contracts/reconstruct';
import { Button } from '@/components/ui/button';
import { SelectInput, TextInput } from '@/components/ui/field';
import { distancePx, estimateMm, estimateUncertaintyMm, nudge, scaleFromReference, setLineLength } from '@/lib/reconstruct/measure';
import { cn } from '@/lib/utils';

const KIND_LABEL: Record<MeasurementKind, string> = { diameter: 'Diameter', length: 'Length', hole_spacing: 'Hole spacing', thickness: 'Thickness' };
const LINE_COLORS = ['#7dd3fc', '#fbbf24', '#f472b6', '#a78bfa', '#34d399', '#fb923c'];

type Target = { kind: 'reference' } | { kind: 'line'; id: string };
type Placing = { target: Target; point: 'a' | 'b' } | null;

export type MeasureToolProps = {
    photo: { attachmentId: string; url: string | null; filename: string };
    value: PhotoMeasurements | null;
    dims: DimensionDef[];
    onChange: (next: PhotoMeasurements) => void;
    readOnly?: boolean;
    /** Shows "Auto-detect" when the GPU worker is configured. */
    onAutoDetect?: () => void;
    autoDetecting?: boolean;
};

function defaultSegment(w: number, h: number, offsetY = 0): { a: PixelPoint; b: PixelPoint } {
    const y = Math.round(h * (0.5 + offsetY));
    return { a: { x: Math.round(w * 0.35), y }, b: { x: Math.round(w * 0.65), y } };
}

export function MeasureTool({ photo, value, dims, onChange, readOnly, onAutoDetect, autoDetecting }: MeasureToolProps) {
    const uid = useId();
    const svgRef = useRef<SVGSVGElement>(null);
    const [natural, setNatural] = useState<{ width: number; height: number } | null>(value ? { width: value.imageWidth, height: value.imageHeight } : null);
    const [placing, setPlacing] = useState<Placing>(null);
    const [dragging, setDragging] = useState<{ target: Target; point: 'a' | 'b' } | null>(null);
    const [focused, setFocused] = useState<string | null>(null);
    const [preset, setPreset] = useState<ReferencePresetKey>(value?.reference?.preset ?? 'credit_card');
    const [rulerMm, setRulerMm] = useState<string>(value?.reference?.preset === 'ruler' ? String(value.reference.lengthMm) : '50');
    const [newKind, setNewKind] = useState<MeasurementKind>('diameter');
    const [message, setMessage] = useState('');

    const size = natural;
    const m: PhotoMeasurements | null = useMemo(() => (size ? (value ?? { attachmentId: photo.attachmentId, imageWidth: size.width, imageHeight: size.height, reference: null, lines: [] }) : null), [size, value, photo.attachmentId]);
    const mmPerPx = m ? scaleFromReference(m.reference) : null;
    const handleR = size ? Math.max(6, Math.round(Math.max(size.width, size.height) / 90)) : 8;
    const stroke = Math.max(2, handleR / 3);

    const presetLength = (p: ReferencePresetKey) => REFERENCE_PRESETS[p].lengthMm ?? (Number(rulerMm) > 0 ? Number(rulerMm) : 50);

    const update = useCallback((next: PhotoMeasurements) => onChange(next), [onChange]);

    const setPoint = (target: Target, point: 'a' | 'b', p: PixelPoint) => {
        if (!m) return;
        if (target.kind === 'reference') {
            if (!m.reference) return;
            update({ ...m, reference: { ...m.reference, [point]: p } });
        } else {
            update({ ...m, lines: m.lines.map((l) => (l.id === target.id ? { ...l, [point]: p } : l)) });
        }
    };

    const toImage = (clientX: number, clientY: number): PixelPoint | null => {
        const svg = svgRef.current;
        if (!svg || !size) return null;
        const r = svg.getBoundingClientRect();
        if (!r.width || !r.height) return null;
        return {
            x: Math.min(size.width, Math.max(0, Math.round(((clientX - r.left) / r.width) * size.width))),
            y: Math.min(size.height, Math.max(0, Math.round(((clientY - r.top) / r.height) * size.height))),
        };
    };

    const markReference = () => {
        if (!m || !size) return;
        const seg = m.reference ? { a: m.reference.a, b: m.reference.b } : defaultSegment(size.width, size.height, 0.3);
        update({ ...m, reference: { preset, ...seg, lengthMm: presetLength(preset) } });
        setPlacing({ target: { kind: 'reference' }, point: 'a' });
        setMessage(`Tap one end of the ${REFERENCE_PRESETS[preset].label.toLowerCase()}, then the other. You can also drag or arrow-key the handles.`);
    };

    const addLine = () => {
        if (!m || !size) return;
        const id = `l${Date.now().toString(36).slice(-6)}${m.lines.length}`;
        const param = dims.find((d) => d.kind === newKind && !m.lines.some((l) => l.param === d.param))?.param ?? null;
        const line: MeasurementLine = { id, kind: newKind, param, ...defaultSegment(size.width, size.height, -0.1 + 0.06 * (m.lines.length % 4)) };
        update({ ...m, lines: [...m.lines, line] });
        setPlacing({ target: { kind: 'line', id }, point: 'a' });
        setMessage('Tap the first edge of the feature, then the opposite edge.');
    };

    const onCanvasClick = (e: React.MouseEvent<SVGSVGElement>) => {
        if (readOnly || !placing || dragging) return;
        const p = toImage(e.clientX, e.clientY);
        if (!p) return;
        setPoint(placing.target, placing.point, p);
        if (placing.point === 'a') setPlacing({ ...placing, point: 'b' });
        else {
            setPlacing(null);
            setMessage(placing.target.kind === 'reference' ? 'Scale set. Now add a measurement line.' : 'Line placed. Assign it to a dimension below.');
        }
    };

    const onHandleDown = (target: Target, point: 'a' | 'b') => (e: ReactPointerEvent<SVGCircleElement>) => {
        if (readOnly) return;
        e.stopPropagation();
        (e.target as Element).setPointerCapture?.(e.pointerId);
        setDragging({ target, point });
    };
    const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
        if (!dragging) return;
        const p = toImage(e.clientX, e.clientY);
        if (p) setPoint(dragging.target, dragging.point, p);
    };
    const onPointerUp = () => setDragging(null);

    const onHandleKey = (target: Target, point: 'a' | 'b', current: PixelPoint) => (e: KeyboardEvent<SVGCircleElement>) => {
        if (readOnly || !size) return;
        const next = nudge(current, e.key, e.shiftKey, size);
        if (!next) return;
        e.preventDefault();
        setPoint(target, point, next);
    };

    const handles = useMemo(() => {
        if (!m) return [];
        const out: { id: string; target: Target; point: 'a' | 'b'; p: PixelPoint; color: string; label: string }[] = [];
        if (m.reference) {
            for (const point of ['a', 'b'] as const) out.push({ id: `ref-${point}`, target: { kind: 'reference' }, point, p: m.reference[point], color: '#22c55e', label: `Reference ${point === 'a' ? 'start' : 'end'}` });
        }
        m.lines.forEach((l, i) => {
            const name = dims.find((d) => d.param === l.param)?.label ?? `${KIND_LABEL[l.kind]} line ${i + 1}`;
            for (const point of ['a', 'b'] as const) out.push({ id: `${l.id}-${point}`, target: { kind: 'line', id: l.id }, point, p: l[point], color: LINE_COLORS[i % LINE_COLORS.length]!, label: `${name} ${point === 'a' ? 'start' : 'end'}` });
        });
        return out;
    }, [m, dims]);

    const caveatId = `${uid}-caveat`;
    return (
        <div className="space-y-4" data-testid="measure-tool">
            <div className="relative overflow-hidden rounded-2xl bg-graphite-900 ring-1 ring-graphite-700">
                {photo.url ? (
                    <div className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL; natural size is the measuring frame */}
                        <img
                            src={photo.url}
                            alt={`Photo of the broken part (${photo.filename})`}
                            className="block h-auto w-full select-none"
                            draggable={false}
                            onLoad={(e) => {
                                const img = e.currentTarget;
                                if (!natural && img.naturalWidth > 0) setNatural({ width: img.naturalWidth, height: img.naturalHeight });
                            }}
                            data-testid="measure-photo"
                        />
                        {size && m && (
                            <svg
                                ref={svgRef}
                                viewBox={`0 0 ${size.width} ${size.height}`}
                                preserveAspectRatio="none"
                                className={cn('absolute inset-0 h-full w-full touch-none', placing ? 'cursor-crosshair' : 'cursor-default')}
                                onClick={onCanvasClick}
                                onPointerMove={onPointerMove}
                                onPointerUp={onPointerUp}
                                onPointerCancel={onPointerUp}
                                role="group"
                                aria-label="Measurement canvas: reference and measurement lines on the photo"
                                aria-describedby={caveatId}
                                data-testid="measure-canvas"
                            >
                                {m.reference && (
                                    <g data-testid="measure-reference">
                                        <line x1={m.reference.a.x} y1={m.reference.a.y} x2={m.reference.b.x} y2={m.reference.b.y} stroke="#22c55e" strokeWidth={stroke} strokeDasharray={`${stroke * 3} ${stroke * 2}`} />
                                    </g>
                                )}
                                {m.lines.map((l, i) => {
                                    const c = LINE_COLORS[i % LINE_COLORS.length];
                                    const est = mmPerPx ? estimateMm(l, mmPerPx) : null;
                                    return (
                                        <g key={l.id}>
                                            <line x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} stroke={c} strokeWidth={stroke} />
                                            {est !== null && (
                                                <text x={(l.a.x + l.b.x) / 2} y={(l.a.y + l.b.y) / 2 - handleR * 1.5} fill={c} fontSize={handleR * 2.2} textAnchor="middle" fontWeight={700} stroke="#0b0d10" strokeWidth={handleR / 4} paintOrder="stroke">
                                                    ~{est.toFixed(1)} mm
                                                </text>
                                            )}
                                        </g>
                                    );
                                })}
                                {handles.map((h) => (
                                    <circle
                                        key={h.id}
                                        cx={h.p.x}
                                        cy={h.p.y}
                                        r={focused === h.id ? handleR * 1.4 : handleR}
                                        fill={h.color}
                                        fillOpacity={0.35}
                                        stroke={focused === h.id ? '#ffffff' : h.color}
                                        strokeWidth={stroke}
                                        tabIndex={readOnly ? -1 : 0}
                                        role="button"
                                        aria-label={`${h.label}, at ${Math.round(h.p.x)}, ${Math.round(h.p.y)} px. Arrow keys move it, Shift moves 10 px.`}
                                        className="cursor-grab outline-none"
                                        onPointerDown={onHandleDown(h.target, h.point)}
                                        onKeyDown={onHandleKey(h.target, h.point, h.p)}
                                        onFocus={() => setFocused(h.id)}
                                        onBlur={() => setFocused((f) => (f === h.id ? null : f))}
                                        data-testid={`handle-${h.id}`}
                                    />
                                ))}
                            </svg>
                        )}
                    </div>
                ) : (
                    <p className="p-6 text-sm text-fg-muted">This photo is still processing.</p>
                )}
            </div>
            <p className="text-sm text-fg-muted" aria-live="polite" data-testid="measure-hint">
                {message || (m?.reference ? 'Drag or arrow-key the handles to the exact edges.' : 'Start by marking the reference object.')}
            </p>

            {!readOnly && m && (
                <div className="grid gap-4 lg:grid-cols-2">
                    <section aria-labelledby={`${uid}-ref`} className="rounded-xl bg-graphite-900 p-4 ring-1 ring-graphite-700" data-testid="reference-panel">
                        <h3 id={`${uid}-ref`} className="flex items-center gap-2 font-semibold">
                            <Ruler className="h-4 w-4" aria-hidden /> 1. Reference object
                        </h3>
                        <label htmlFor={`${uid}-preset`} className="mt-3 block text-sm font-medium">
                            Known size
                        </label>
                        <SelectInput
                            id={`${uid}-preset`}
                            className="mt-1"
                            value={preset}
                            onChange={(e) => {
                                const p = e.target.value as ReferencePresetKey;
                                setPreset(p);
                                if (m.reference) update({ ...m, reference: { ...m.reference, preset: p, lengthMm: presetLength(p) } });
                            }}
                            data-testid="reference-preset"
                        >
                            {(Object.keys(REFERENCE_PRESETS) as ReferencePresetKey[]).map((k) => (
                                <option key={k} value={k}>
                                    {REFERENCE_PRESETS[k].label}
                                </option>
                            ))}
                        </SelectInput>
                        {preset === 'ruler' && (
                            <>
                                <label htmlFor={`${uid}-ruler`} className="mt-3 block text-sm font-medium">
                                    Distance between your two marks (mm)
                                </label>
                                <TextInput
                                    id={`${uid}-ruler`}
                                    className="mt-1"
                                    inputMode="decimal"
                                    value={rulerMm}
                                    onChange={(e) => {
                                        setRulerMm(e.target.value);
                                        const v = Number(e.target.value);
                                        if (m.reference && v > 0) update({ ...m, reference: { ...m.reference, lengthMm: v } });
                                    }}
                                    data-testid="reference-ruler-mm"
                                />
                            </>
                        )}
                        <p className="mt-2 text-xs text-fg-subtle">{REFERENCE_PRESETS[preset].note}</p>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                            <Button size="sm" onClick={markReference} data-testid="reference-mark">
                                {m.reference ? 'Re-mark reference' : 'Mark reference'}
                            </Button>
                            {onAutoDetect && (
                                <Button size="sm" variant="secondary" onClick={onAutoDetect} loading={autoDetecting} data-testid="auto-detect">
                                    <ScanSearch className="h-4 w-4" aria-hidden /> Auto-detect
                                </Button>
                            )}
                        </div>
                        <p className="mt-3 font-mono text-xs" data-testid="reference-scale">
                            {mmPerPx ? `Scale ${mmPerPx.toFixed(4)} mm/px · reference ${distancePx(m.reference!.a, m.reference!.b).toFixed(0)} px = ${m.reference!.lengthMm} mm` : 'No scale yet'}
                        </p>
                    </section>

                    <section aria-labelledby={`${uid}-lines`} className="rounded-xl bg-graphite-900 p-4 ring-1 ring-graphite-700" data-testid="lines-panel">
                        <h3 id={`${uid}-lines`} className="font-semibold">
                            2. Measurements
                        </h3>
                        <div className="mt-3 flex flex-wrap items-end gap-2">
                            <div className="min-w-0 flex-1">
                                <label htmlFor={`${uid}-kind`} className="block text-sm font-medium">
                                    New line
                                </label>
                                <SelectInput id={`${uid}-kind`} className="mt-1" value={newKind} onChange={(e) => setNewKind(e.target.value as MeasurementKind)} data-testid="line-kind">
                                    {MEASUREMENT_KINDS.map((k) => (
                                        <option key={k} value={k}>
                                            {KIND_LABEL[k]}
                                        </option>
                                    ))}
                                </SelectInput>
                            </div>
                            <Button size="md" variant="secondary" onClick={addLine} disabled={!mmPerPx} data-testid="line-add">
                                <Plus className="h-4 w-4" aria-hidden /> Add line
                            </Button>
                        </div>
                        {!mmPerPx && <p className="mt-2 text-xs text-fg-subtle">Mark the reference first: lines need a scale.</p>}
                        <ul className="mt-3 space-y-3">
                            {m.lines.map((l, i) => {
                                const est = mmPerPx ? estimateMm(l, mmPerPx) : null;
                                const unc = m.reference ? estimateUncertaintyMm(l, m.reference) : null;
                                return (
                                    <li key={l.id} className="rounded-lg bg-graphite-850 p-3 ring-1 ring-inset ring-graphite-700" data-testid="measure-line">
                                        <div className="flex items-center gap-2">
                                            <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: LINE_COLORS[i % LINE_COLORS.length] }} aria-hidden />
                                            <label htmlFor={`${uid}-${l.id}-param`} className="sr-only">
                                                What this line measures
                                            </label>
                                            <SelectInput
                                                id={`${uid}-${l.id}-param`}
                                                className="h-9 text-sm"
                                                value={l.param ?? ''}
                                                onChange={(e) => update({ ...m, lines: m.lines.map((x) => (x.id === l.id ? { ...x, param: (e.target.value || null) as MeasurementLine['param'] } : x)) })}
                                                data-testid="line-param"
                                            >
                                                <option value="">Not assigned ({KIND_LABEL[l.kind].toLowerCase()})</option>
                                                {dims.map((d) => (
                                                    <option key={d.param} value={d.param}>
                                                        {d.label}
                                                    </option>
                                                ))}
                                            </SelectInput>
                                            <button type="button" onClick={() => update({ ...m, lines: m.lines.filter((x) => x.id !== l.id) })} className="rounded p-2 text-fg-muted hover:bg-graphite-800 hover:text-fg" aria-label={`Delete line ${i + 1}`}>
                                                <Trash2 className="h-4 w-4" aria-hidden />
                                            </button>
                                        </div>
                                        <div className="mt-2 flex flex-wrap items-center gap-2">
                                            <label htmlFor={`${uid}-${l.id}-mm`} className="text-xs text-fg-muted">
                                                Estimate from photo (mm)
                                            </label>
                                            <TextInput
                                                id={`${uid}-${l.id}-mm`}
                                                className="h-9 w-28 font-mono text-sm"
                                                inputMode="decimal"
                                                disabled={!mmPerPx}
                                                key={`${l.id}-${est ?? 'none'}`}
                                                defaultValue={est !== null ? est.toFixed(2) : ''}
                                                onBlur={(e) => {
                                                    const v = Number(e.target.value.replace(',', '.'));
                                                    if (!mmPerPx || !(v > 0) || !size || v === est) return;
                                                    update({ ...m, lines: m.lines.map((x) => (x.id === l.id ? setLineLength(x, v, mmPerPx, size) : x)) });
                                                }}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                                }}
                                                data-testid="line-estimate"
                                            />
                                            {unc !== null && <span className="font-mono text-xs text-fg-subtle">± {unc.toFixed(2)} mm</span>}
                                            <span className="rounded-full bg-amber/15 px-2 py-0.5 text-[11px] font-semibold text-amber">estimate from photo</span>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    </section>
                </div>
            )}
            <p id={caveatId} className="rounded-lg bg-amber/10 p-3 text-xs leading-relaxed text-fg-muted ring-1 ring-inset ring-amber/30" data-testid="perspective-caveat">
                {PERSPECTIVE_CAVEAT}
            </p>
        </div>
    );
}
