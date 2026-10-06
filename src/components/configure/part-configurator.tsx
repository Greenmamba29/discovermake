'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Loader2, RefreshCw } from 'lucide-react';
import type { CatalogMaterial, CatalogResponse, CatalogService, CreateQuoteRequest, DfmViolation, PartView, QuoteView } from '@/contracts';
import { MAX_QUOTE_QUANTITY } from '@/contracts/quotes';
import { Button, ButtonLink } from '@/components/ui/button';
import { QtyStepper } from '@/components/ui/qty-stepper';
import { StatusPill } from '@/components/ui/status-pill';
import { Notice, ErrorState } from '@/components/ui/state';
import { PageSkeleton, Skeleton } from '@/components/ui/skeleton';
import { SelectInput } from '@/components/ui/field';
import { PartUploader } from '@/components/upload/part-uploader';
import { PartDimensions, PartPreview } from '@/components/part/part-preview';
import { DfmList, type DfmFixAction } from '@/components/part/dfm-list';
import { api, ApiClientError, errorMessage } from '@/lib/api';
import { money, plural } from '@/lib/format';
import { cn } from '@/lib/utils';
import { OptionGroup, OptionRow } from './option-group';
import { PricePanel } from './price-panel';
import { UnitsPrompt } from './units-prompt';

type ServiceSel = { featureCount?: number; option?: { key: string; value: string } };
type Config = {
    materialId: string | null;
    thicknessOptionId: string | null;
    /** 'none' = as cut, no finish (an explicit choice). */
    finish: string;
    services: Record<string, ServiceSel>;
    quantity: number;
};

const QUOTE_DEBOUNCE_MS = 450;

/** First option list of a service, e.g. `threads` -> { key: "thread", values }. The server accepts the singular key. */
function serviceOptionList(s: CatalogService): { key: string; label: string; values: string[] } | null {
    for (const [k, v] of Object.entries(s.options ?? {})) {
        if (Array.isArray(v) && v.every((x) => typeof x === 'string') && v.length) {
            const key = k.endsWith('s') ? k.slice(0, -1) : k;
            return { key, label: key.charAt(0).toUpperCase() + key.slice(1), values: v as string[] };
        }
    }
    return null;
}

/** Canonical form of a quote config for exact-match comparison (ids, counts, options only). */
function configKey(c: CreateQuoteRequest): string {
    const services = [...(c.services ?? [])]
        .map((s) => ({ id: s.serviceId, n: s.featureCount ?? null, o: Object.entries(s.options ?? {}).sort() }))
        .sort((a, b) => a.id.localeCompare(b.id));
    return JSON.stringify([c.partId, c.materialId, c.thicknessOptionId, c.finishServiceId ?? null, c.quantity, services]);
}

function fits(part: PartView, t: CatalogMaterial['thicknessOptions'][number]): boolean {
    const w = part.features?.bboxWidthMm ?? part.preview?.widthMm ?? 0;
    const h = part.features?.bboxHeightMm ?? part.preview?.heightMm ?? 0;
    return (w <= t.maxPartWidthMm && h <= t.maxPartHeightMm) || (h <= t.maxPartWidthMm && w <= t.maxPartHeightMm);
}

function toRequest(partId: string, c: Config, catalog: CatalogResponse): CreateQuoteRequest | null {
    if (!c.materialId || !c.thicknessOptionId) return null;
    const services: CreateQuoteRequest['services'] = [];
    for (const [serviceId, sel] of Object.entries(c.services)) {
        const svc = catalog.services.find((s) => s.id === serviceId);
        if (!svc) continue;
        const opt = serviceOptionList(svc);
        if (svc.requiresFeatureCount && !sel.featureCount) return null;
        if (svc.slug === 'tapping' && !sel.option) return null;
        services.push({
            serviceId,
            ...(svc.pricingUnit === 'PER_FEATURE' && sel.featureCount ? { featureCount: sel.featureCount } : {}),
            ...(opt && sel.option ? { options: { [sel.option.key]: sel.option.value } } : {}),
        });
    }
    return {
        partId,
        materialId: c.materialId,
        thicknessOptionId: c.thicknessOptionId,
        finishServiceId: c.finish === 'none' ? null : c.finish,
        services,
        quantity: c.quantity,
    };
}

export function PartConfigurator({ partId, fromQuoteId }: { partId: string; fromQuoteId?: string | null }) {
    const qc = useQueryClient();
    const partQuery = useQuery({
        queryKey: ['part', partId],
        queryFn: () => api.getPart(partId),
        refetchInterval: (q) => (q.state.data?.status === 'ANALYZING' ? 1500 : false),
    });
    const catalogQuery = useQuery({ queryKey: ['catalog'], queryFn: api.catalog, staleTime: 5 * 60_000 });

    const setPart = useCallback((p: PartView) => qc.setQueryData(['part', partId], p), [qc, partId]);

    if (partQuery.isLoading || catalogQuery.isLoading) return <PageSkeleton label="Loading your part" />;
    if (partQuery.error) {
        const notFound = partQuery.error instanceof ApiClientError && partQuery.error.status === 404;
        return (
            <ErrorState
                title={notFound ? 'Part not found' : 'Could not load this part'}
                message={notFound ? 'This part link does not exist. Upload the file again to get a new quote.' : errorMessage(partQuery.error)}
                action={<ButtonLink href="/make">Upload a part</ButtonLink>}
            />
        );
    }
    if (catalogQuery.error || !catalogQuery.data) {
        return <ErrorState title="Could not load materials" message={errorMessage(catalogQuery.error)} action={<Button onClick={() => catalogQuery.refetch()}>Try again</Button>} />;
    }
    const part = partQuery.data!;

    if (part.status === 'NEEDS_INPUT') return <UnitsPrompt part={part} onAnalyzed={setPart} />;
    if (part.status === 'ANALYZING') {
        return (
            <div className="mx-auto flex max-w-md flex-col items-center px-4 py-20 text-center" role="status" aria-live="polite">
                <Loader2 className="h-8 w-8 animate-spin text-signal" aria-hidden />
                <h1 className="mt-4 font-display text-2xl font-bold">Analyzing {part.filename}</h1>
                <p className="mt-2 text-fg-muted">Reading geometry, holes and bend lines. This takes a few seconds.</p>
            </div>
        );
    }
    if (part.status === 'AWAITING_UPLOAD' || part.status === 'FAILED') {
        return <PartProblem part={part} onAnalyzed={setPart} />;
    }
    return <Configurator part={part} catalog={catalogQuery.data} fromQuoteId={fromQuoteId ?? null} onPartChange={setPart} />;
}

function PartProblem({ part, onAnalyzed }: { part: PartView; onAnalyzed: (p: PartView) => void }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const failed = part.status === 'FAILED';
    return (
        <div className="mx-auto w-full max-w-2xl px-4 py-12 sm:px-6">
            <p className="eyebrow">
                {part.buildDisplayId} · {part.filename}
            </p>
            <h1 className="mt-2 font-display font-wide text-3xl font-extrabold">{failed ? 'We could not read this file' : 'This upload did not finish'}</h1>
            <Notice tone={failed ? 'error' : 'warning'} className="mt-5" testId="part-problem">
                {failed ? part.error ?? 'The file could not be parsed as a flat DXF.' : 'The file bytes never arrived. Analyze it again, or upload the file once more.'}
            </Notice>
            {!failed && (
                <Button
                    className="mt-4"
                    loading={busy}
                    onClick={async () => {
                        setBusy(true);
                        setError(null);
                        try {
                            onAnalyzed(await api.analyzePart(part.id, {}));
                        } catch (err) {
                            setError(errorMessage(err));
                        } finally {
                            setBusy(false);
                        }
                    }}
                >
                    <RefreshCw className="h-4 w-4" aria-hidden /> Analyze again
                </Button>
            )}
            {error && <p className="mt-3 text-sm text-ember" role="alert">{error}</p>}
            <div className="mt-10">
                <h2 className="mb-3 font-display text-lg font-bold">Upload a new file</h2>
                <PartUploader size="md" />
            </div>
        </div>
    );
}

function Configurator({ part, catalog, fromQuoteId, onPartChange }: { part: PartView; catalog: CatalogResponse; fromQuoteId: string | null; onPartChange: (p: PartView) => void }) {
    const router = useRouter();
    const hasBends = (part.features?.bendCount ?? 0) > 0;
    const bendingService = catalog.services.find((s) => s.slug === 'bending') ?? null;

    const [config, setConfig] = useState<Config>({ materialId: null, thicknessOptionId: null, finish: 'none', services: {}, quantity: 1 });
    const [quote, setQuote] = useState<QuoteView | null>(null);
    const [quoting, setQuoting] = useState(false);
    const [quoteError, setQuoteError] = useState<string | null>(null);
    const [unitsBusy, setUnitsBusy] = useState(false);
    const prefilled = useRef(false);

    const material = catalog.materials.find((m) => m.id === config.materialId) ?? null;
    const thickness = material?.thicknessOptions.find((t) => t.id === config.thicknessOptionId) ?? null;
    const compatible = useMemo(() => new Set(material?.compatibleServiceIds ?? []), [material]);
    const finishes = catalog.services.filter((s) => s.kind === 'FINISH' && compatible.has(s.id));
    const secondaryOps = catalog.services.filter((s) => s.kind === 'SECONDARY_OP' && compatible.has(s.id));

    // Reorder / "edit this quote": prefill from an existing quote's config (ids only).
    useEffect(() => {
        if (!fromQuoteId || prefilled.current) return;
        prefilled.current = true;
        api.getQuote(fromQuoteId)
            .then((q) => {
                if (q.partId !== part.id) return;
                const services: Record<string, ServiceSel> = {};
                for (const s of q.config.services) {
                    const svc = catalog.services.find((x) => x.id === s.serviceId);
                    const opt = svc ? serviceOptionList(svc) : null;
                    const [entry] = Object.entries(s.options ?? {});
                    services[s.serviceId] = { featureCount: s.featureCount, option: opt && entry ? { key: entry[0], value: entry[1] } : undefined };
                }
                setConfig({ materialId: q.config.materialId, thicknessOptionId: q.config.thicknessOptionId, finish: q.config.finishServiceId ?? 'none', services, quantity: q.config.quantity });
            })
            .catch(() => undefined);
    }, [fromQuoteId, part.id, catalog.services]);

    const selectMaterial = (m: CatalogMaterial) => {
        setConfig((c) => {
            const keepThickness = m.thicknessOptions.some((t) => t.id === c.thicknessOptionId);
            const ids = new Set(m.compatibleServiceIds);
            const services: Record<string, ServiceSel> = {};
            for (const [id, sel] of Object.entries(c.services)) if (ids.has(id)) services[id] = sel;
            if (hasBends && bendingService && ids.has(bendingService.id) && !services[bendingService.id]) services[bendingService.id] = {};
            // Pre-select the only thickness, or a bendable one that fits when the part has bends.
            let thicknessOptionId = keepThickness ? c.thicknessOptionId : null;
            if (!thicknessOptionId) {
                const usable = m.thicknessOptions.filter((t) => fits(part, t) && (!hasBends || t.bendable));
                if (usable.length === 1) thicknessOptionId = usable[0].id;
            }
            return { ...c, materialId: m.id, thicknessOptionId, finish: c.finish !== 'none' && ids.has(c.finish) ? c.finish : 'none', services };
        });
    };

    const toggleService = (s: CatalogService) =>
        setConfig((c) => {
            const services = { ...c.services };
            if (services[s.id]) delete services[s.id];
            else {
                const opt = serviceOptionList(s);
                services[s.id] = { featureCount: s.requiresFeatureCount ? 1 : undefined, option: opt && s.slug !== 'tapping' ? { key: opt.key, value: opt.values[0] } : undefined };
            }
            return { ...c, services };
        });

    const request = useMemo(() => toRequest(part.id, config, catalog), [part.id, config, catalog]);
    const requiredMissing = (config.materialId ? 0 : 1) + (config.thicknessOptionId ? 0 : 1);
    const detailsMissing = !request && requiredMissing === 0;

    // Debounced re-quote: every change creates a new immutable quote.
    const requestKey = request ? JSON.stringify(request) : null;
    useEffect(() => {
        if (!request) {
            setQuoteError(null);
            return;
        }
        const ctrl = new AbortController();
        setQuoting(true);
        setQuoteError(null);
        const t = setTimeout(() => {
            api.createQuote(request, ctrl.signal)
                .then((q) => {
                    setQuote(q);
                    setQuoting(false);
                })
                .catch((err) => {
                    if ((err as Error)?.name === 'AbortError') return;
                    setQuoteError(errorMessage(err));
                    setQuoting(false);
                });
        }, QUOTE_DEBOUNCE_MS);
        return () => {
            clearTimeout(t);
            ctrl.abort();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [requestKey]);

    // Show the last quote while a re-quote is in flight (same material + thickness), but only an
    // exact match for the current selection may be ordered.
    const sameBase = quote !== null && request !== null && quote.config.materialId === request.materialId && quote.config.thicknessOptionId === request.thicknessOptionId;
    const liveQuote = sameBase ? quote : null;
    const exactQuote = liveQuote && request && configKey(liveQuote.config) === configKey(request) ? liveQuote : null;
    const dfm = liveQuote?.dfm ?? part.dfm;
    const blockingCount = liveQuote ? liveQuote.dfm.violations.filter((v) => v.severity === 'BLOCKING').length : 0;

    const reanalyze = async (units: 'mm' | 'in') => {
        setUnitsBusy(true);
        try {
            onPartChange(await api.analyzePart(part.id, { units }));
            setQuote(null);
        } catch (err) {
            setQuoteError(errorMessage(err));
        } finally {
            setUnitsBusy(false);
        }
    };

    const fixAction = (v: DfmViolation): DfmFixAction | null => {
        const p = v.fix?.params ?? {};
        if (typeof p.thicknessOptionId === 'string') {
            const target = catalog.materials.find((m) => m.thicknessOptions.some((t) => t.id === p.thicknessOptionId));
            if (!target) return null;
            return {
                label: 'Apply',
                apply: () => setConfig((c) => ({ ...c, materialId: target.id, thicknessOptionId: p.thicknessOptionId as string })),
            };
        }
        if ((v.fix?.kind === 'ADD_SERVICE' || v.fix?.kind === 'REMOVE_SERVICE') && typeof p.serviceId === 'string') {
            const svc = catalog.services.find((s) => s.id === p.serviceId);
            if (!svc) return null;
            if (v.fix.kind === 'ADD_SERVICE') {
                if (!compatible.has(svc.id) || config.services[svc.id]) return null;
                return { label: `Add ${svc.name.toLowerCase()}`, apply: () => toggleService(svc) };
            }
            if (!config.services[svc.id]) return null;
            return { label: `Remove ${svc.name.toLowerCase()}`, apply: () => toggleService(svc) };
        }
        if (v.fix?.kind === 'SET_UNITS') {
            const other = part.units === 'in' ? 'mm' : 'in';
            return { label: `Use ${other === 'mm' ? 'millimetres' : 'inches'}`, apply: () => void reanalyze(other) };
        }
        return null;
    };

    // ---- CTA (DoorDash rule: count what is missing, then show the price) ----
    let cta: { label: string; enabled: boolean } = { label: '', enabled: false };
    if (requiredMissing > 0) cta = { label: `Make ${requiredMissing} required selection${requiredMissing > 1 ? 's' : ''}`, enabled: false };
    else if (detailsMissing) cta = { label: 'Complete the selected options', enabled: false };
    else if (quoteError && !quoting) cta = { label: 'Price unavailable', enabled: false };
    else if (quoting || !exactQuote) cta = { label: 'Updating price…', enabled: false };
    else if (exactQuote.orderable) cta = { label: `Continue to checkout · ${money(exactQuote.subtotalCents, exactQuote.currency)}`, enabled: true };
    else if (exactQuote.status === 'NEEDS_INPUT') cta = { label: `Fix ${plural(Math.max(blockingCount, 1), 'issue')} to continue`, enabled: false };
    else if (exactQuote.status === 'REVIEW') cta = { label: 'Needs shop review before ordering', enabled: false };
    else cta = { label: 'This quote can no longer be ordered', enabled: false };

    const goCheckout = () => exactQuote && cta.enabled && router.push(`/checkout/${exactQuote.id}`);
    const pillStatus = liveQuote && (liveQuote.status === 'READY' || liveQuote.status === 'REVIEW' || liveQuote.status === 'NEEDS_INPUT') ? liveQuote.status : part.universalStatus;

    return (
        <div className="mx-auto w-full max-w-7xl px-4 pb-32 pt-6 sm:px-6 lg:pb-12">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                    <p className="eyebrow">Step 2 of 4 · Configure · {part.buildDisplayId}</p>
                    <h1 className="mt-1 truncate font-display font-wide text-2xl font-extrabold sm:text-3xl">{part.filename}</h1>
                </div>
                <StatusPill status={pillStatus} />
            </div>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(380px,1fr)]">
                {/* Left: the object first */}
                <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
                    {part.preview ? (
                        <PartPreview
                            preview={part.preview}
                            thicknessMm={thickness?.thicknessMm ?? 1.5}
                            color={material?.swatchHex}
                            category={material?.category ?? null}
                            className="h-[46vh] min-h-[280px] lg:h-[58vh]"
                        />
                    ) : (
                        <Skeleton className="h-[46vh]" />
                    )}
                    {part.preview && (
                        <section aria-labelledby="dims-heading" className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700">
                            <h2 id="dims-heading" className="mb-3 text-sm font-semibold text-fg">
                                Part details
                            </h2>
                            <PartDimensions preview={part.preview} features={part.features} thicknessLabel={thickness?.label} />
                        </section>
                    )}
                    {part.features && !part.features.unitsFromFile && (
                        <Notice
                            tone="warning"
                            title={`We read this drawing in ${part.units === 'in' ? 'inches' : 'millimetres'}`}
                            testId="units-confirm"
                            action={
                                <Button variant="secondary" size="sm" loading={unitsBusy} onClick={() => reanalyze(part.units === 'in' ? 'mm' : 'in')}>
                                    Switch to {part.units === 'in' ? 'millimetres' : 'inches'}
                                </Button>
                            }
                        >
                            The file does not declare its units. Check the size above: {part.features.bboxWidthMm.toFixed(1)} × {part.features.bboxHeightMm.toFixed(1)} mm.
                        </Notice>
                    )}
                    <section aria-labelledby="dfm-heading" className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700">
                        <h2 id="dfm-heading" className="mb-3 text-sm font-semibold text-fg">
                            Manufacturability {liveQuote ? `· ${material?.name ?? ''} ${thickness?.label ?? ''}` : '· geometry'}
                        </h2>
                        <DfmList dfm={dfm} actionFor={fixAction} />
                    </section>
                </div>

                {/* Right: DoorDash option sheet */}
                <div className="space-y-4">
                    <div className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700 sm:p-5">
                        <OptionGroup id="grp-material" title="Material" rule="Required · Select 1" required satisfied={Boolean(material)}>
                            <div className="grid gap-2">
                                {catalog.materials.map((m) => {
                                    const anyFits = m.thicknessOptions.some((t) => fits(part, t));
                                    return (
                                        <OptionRow
                                            key={m.id}
                                            type="radio"
                                            name="material"
                                            value={m.id}
                                            checked={config.materialId === m.id}
                                            disabled={!anyFits}
                                            onChange={() => selectMaterial(m)}
                                            testId={`material-option-${m.id}`}
                                            leading={<span className="h-10 w-10 shrink-0 rounded-lg ring-1 ring-white/10" style={{ background: `linear-gradient(135deg, ${m.swatchHex}, ${m.swatchHex}aa 55%, #ffffff40)` }} aria-hidden />}
                                            title={m.name}
                                            detail={anyFits ? m.description : 'This part is larger than the largest sheet we cut in this material.'}
                                            meta={<span className="font-mono">{m.thicknessOptions.length} gauges</span>}
                                        />
                                    );
                                })}
                            </div>
                        </OptionGroup>

                        <OptionGroup id="grp-thickness" title="Thickness" rule={material ? 'Required · Select 1' : 'Choose a material first'} required satisfied={Boolean(thickness)}>
                            {material ? (
                                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                    {material.thicknessOptions.map((t) => {
                                        const ok = fits(part, t);
                                        const checked = config.thicknessOptionId === t.id;
                                        return (
                                            <label
                                                key={t.id}
                                                className={cn(
                                                    'flex cursor-pointer flex-col rounded-xl px-3 py-2.5 ring-1 ring-inset transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-signal',
                                                    checked ? 'bg-graphite-800 ring-signal' : 'ring-graphite-700 hover:bg-graphite-850',
                                                    !ok && 'cursor-not-allowed opacity-45',
                                                )}
                                                data-testid={`thickness-option-${t.id}`}
                                                data-checked={checked || undefined}
                                            >
                                                <input
                                                    type="radio"
                                                    name="thickness"
                                                    value={t.id}
                                                    className="sr-only"
                                                    checked={checked}
                                                    disabled={!ok}
                                                    onChange={() => setConfig((c) => ({ ...c, thicknessOptionId: t.id }))}
                                                />
                                                <span className="font-mono text-sm font-semibold text-fg">{t.label}</span>
                                                <span className="text-[11px] text-fg-subtle">
                                                    {t.thicknessMm.toFixed(2)} mm{!ok ? ' · too large' : hasBends && !t.bendable ? ' · no bending' : hasBends ? ' · bendable' : ''}
                                                </span>
                                            </label>
                                        );
                                    })}
                                </div>
                            ) : (
                                <p className="text-sm text-fg-subtle">Thickness options depend on the material.</p>
                            )}
                        </OptionGroup>

                        <OptionGroup id="grp-finish" title="Finish" rule="Required · Select 1" required satisfied>
                            <div className="grid gap-2">
                                <OptionRow
                                    type="radio"
                                    name="finish"
                                    value="none"
                                    checked={config.finish === 'none'}
                                    onChange={() => setConfig((c) => ({ ...c, finish: 'none' }))}
                                    testId="finish-option-none"
                                    leading={<span className="h-8 w-8 shrink-0 rounded-full bg-graphite-700 ring-1 ring-white/10" aria-hidden />}
                                    title="As cut"
                                    detail="Raw material, no coating"
                                />
                                {finishes.map((f) => (
                                    <OptionRow
                                        key={f.id}
                                        type="radio"
                                        name="finish"
                                        value={f.id}
                                        checked={config.finish === f.id}
                                        onChange={() => setConfig((c) => ({ ...c, finish: f.id }))}
                                        testId={`finish-option-${f.id}`}
                                        leading={<span className="h-8 w-8 shrink-0 rounded-full ring-1 ring-white/15" style={{ background: f.colorHex ?? '#4b5150' }} aria-hidden />}
                                        title={f.name}
                                        detail={f.leadTimeDaysAdded > 0 ? `${f.description} · +${plural(f.leadTimeDaysAdded, 'day')}` : f.description}
                                    />
                                ))}
                                {material && finishes.length === 0 && <p className="text-xs text-fg-subtle">No coatings are offered for {material.name}.</p>}
                            </div>
                        </OptionGroup>

                        {secondaryOps.length > 0 && (
                            <OptionGroup id="grp-services" title="Secondary operations" rule={`Optional · Up to ${secondaryOps.length}`} required={false} satisfied>
                                <div className="grid gap-2">
                                    {secondaryOps.map((s) => {
                                        const sel = config.services[s.id];
                                        const opt = serviceOptionList(s);
                                        const isBending = s.slug === 'bending';
                                        return (
                                            <div key={s.id} className="space-y-2">
                                                <OptionRow
                                                    type="checkbox"
                                                    name="services"
                                                    value={s.id}
                                                    checked={Boolean(sel)}
                                                    onChange={() => toggleService(s)}
                                                    testId={`service-option-${s.id}`}
                                                    title={s.name}
                                                    detail={isBending && hasBends ? `${plural(part.features?.bendCount ?? 0, 'bend line')} found in your file` : s.description}
                                                    meta={s.leadTimeDaysAdded > 0 ? `+${plural(s.leadTimeDaysAdded, 'day')}` : undefined}
                                                />
                                                {sel && (s.requiresFeatureCount || opt) && (
                                                    <div className="ml-3 flex flex-wrap items-end gap-3 border-l-2 border-graphite-700 pl-3">
                                                        {s.requiresFeatureCount && (
                                                            <div>
                                                                <p className="mb-1 text-xs text-fg-muted">Per part</p>
                                                                <QtyStepper
                                                                    size="sm"
                                                                    label={`${s.name} count per part`}
                                                                    testId={`service-count-${s.id}`}
                                                                    value={sel.featureCount ?? 1}
                                                                    max={500}
                                                                    onChange={(n) => setConfig((c) => ({ ...c, services: { ...c.services, [s.id]: { ...c.services[s.id], featureCount: n } } }))}
                                                                />
                                                            </div>
                                                        )}
                                                        {opt && (
                                                            <div className="min-w-[160px]">
                                                                <label className="mb-1 block text-xs text-fg-muted" htmlFor={`opt-${s.id}`}>
                                                                    {opt.label}
                                                                </label>
                                                                <SelectInput
                                                                    id={`opt-${s.id}`}
                                                                    className="h-10 text-sm"
                                                                    value={sel.option?.value ?? ''}
                                                                    aria-invalid={s.slug === 'tapping' && !sel.option ? true : undefined}
                                                                    onChange={(e) =>
                                                                        setConfig((c) => ({
                                                                            ...c,
                                                                            services: { ...c.services, [s.id]: { ...c.services[s.id], option: e.target.value ? { key: opt.key, value: e.target.value } : undefined } },
                                                                        }))
                                                                    }
                                                                >
                                                                    <option value="">Choose…</option>
                                                                    {opt.values.map((v) => (
                                                                        <option key={v} value={v}>
                                                                            {v}
                                                                        </option>
                                                                    ))}
                                                                </SelectInput>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </OptionGroup>
                        )}

                        <div className="flex items-center justify-between gap-3 border-t border-graphite-700 pt-5">
                            <div>
                                <p className="font-display text-lg font-bold">Quantity</p>
                                <p className="text-xs text-fg-subtle">Price per part drops as quantity grows</p>
                            </div>
                            <QtyStepper value={config.quantity} max={MAX_QUOTE_QUANTITY} onChange={(n) => setConfig((c) => ({ ...c, quantity: n }))} />
                        </div>
                    </div>

                    {quoteError && (
                        <Notice tone="error" title="We could not price this configuration" testId="quote-error">
                            {quoteError}
                        </Notice>
                    )}
                    {liveQuote ? (
                        <PricePanel quote={liveQuote} updating={quoting} onPickQuantity={(q) => setConfig((c) => ({ ...c, quantity: q }))} />
                    ) : request && !quoteError ? (
                        <div className="rounded-2xl bg-graphite-900 p-5 ring-1 ring-graphite-700" role="status" aria-live="polite">
                            <span className="sr-only">Pricing your part…</span>
                            <Skeleton className="h-5 w-32" />
                            <Skeleton className="mt-3 h-10 w-40" />
                            <Skeleton className="mt-4 h-32" />
                        </div>
                    ) : null}
                    {liveQuote?.status === 'REVIEW' && (
                        <Notice tone="warning" title="A partner shop needs to confirm this one">
                            This configuration is outside what we can price instantly. Try a different thickness or material for an instant binding quote.
                        </Notice>
                    )}

                    {/* Sticky CTA: fixed bar on mobile, inline on desktop */}
                    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-graphite-700 bg-graphite-950/95 p-3 backdrop-blur lg:static lg:border-0 lg:bg-transparent lg:p-0">
                        <div className="mx-auto max-w-7xl">
                            <Button size="lg" className="w-full" disabled={!cta.enabled} onClick={goCheckout} data-testid="checkout-cta" aria-live="polite">
                                {quoting && requiredMissing === 0 && !detailsMissing && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                                {cta.label}
                                {cta.enabled && <ArrowRight className="h-4 w-4" aria-hidden />}
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
