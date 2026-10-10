'use client';

/**
 * "Make it in 3D" in the Build Workspace (Object View): the buyer describes the object, Make AI
 * writes a cadgen model and the CAD worker builds it in its sandbox. The result is a NEW DRAFT
 * design version shown in the Object View. The buyer approves that version, then gets a BINDING
 * 3D-print quote from the print engine and goes to the existing checkout.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Printer, Sparkles, Truck } from 'lucide-react';
import type { BuildGraphView } from '@/contracts';
import type { MakeIt3dStatus } from '@/contracts/make-it-3d';
import { MakeIt3dFailureNotice, MakeIt3dForm, MakeIt3dProgress, type MakeIt3dFailure } from '@/components/make-it-3d/make-it-3d-form';
import { TrustChip } from '@/components/trust';
import { Button, ButtonLink } from '@/components/ui/button';
import { QtyStepper } from '@/components/ui/qty-stepper';
import { Skeleton } from '@/components/ui/skeleton';
import { Notice } from '@/components/ui/state';
import { errorMessage } from '@/lib/api';
import { money, shortDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PanelCard } from './panels';
import { cadQueryKey, textToCadQueryKey, workspaceApi } from './workspace-api';

/** The buyer's description: the Make it in 3D requirement, else the build's first stated requirement. */
function promptFrom(view: BuildGraphView): string {
    const req = view.nodes.find((n) => n.key === 'req:make-it-3d') ?? view.nodes.find((n) => n.type === 'REQUIREMENT' && n.source === 'user');
    const text = req && typeof req.data.text === 'string' ? req.data.text : req?.label;
    return text ?? '';
}

export function useMakeIt3dStatus(buildId: string) {
    return useQuery({ queryKey: textToCadQueryKey(buildId), queryFn: ({ signal }) => workspaceApi.textToCad(buildId, signal), retry: false, retryOnMount: false });
}

export function MakeIt3dPanel({ view, isCurrent, compact = false }: { view: BuildGraphView; isCurrent: boolean; compact?: boolean }) {
    const buildId = view.build.id;
    const qc = useQueryClient();
    const status = useMakeIt3dStatus(buildId);
    const [outcome, setOutcome] = useState<MakeIt3dFailure | null>(null);
    const refresh = () =>
        Promise.all([
            qc.invalidateQueries({ queryKey: textToCadQueryKey(buildId) }),
            qc.invalidateQueries({ queryKey: ['build-graph', buildId] }),
            qc.invalidateQueries({ queryKey: cadQueryKey(buildId) }),
        ]);
    const make = useMutation({
        mutationFn: (prompt: string) => workspaceApi.makeIn3D(buildId, prompt),
        onMutate: () => setOutcome(null),
        onSuccess: async (res) => {
            if (res.status !== 'generated') setOutcome(res);
            else await refresh();
        },
    });
    const approve = useMutation({
        mutationFn: (version: number) => workspaceApi.approve(buildId, version),
        onSuccess: refresh,
    });

    const s = status.data ?? null;
    const record = s?.record ?? null;
    return (
        <PanelCard title="Make it in 3D" icon={<Sparkles className="h-5 w-5" />} testId="make3d-panel">
            {status.isPending ? (
                <Skeleton className="h-24 w-full" />
            ) : status.isError ? (
                <Notice tone="error">{errorMessage(status.error)}</Notice>
            ) : (
                <div className="space-y-4">
                    {record && (
                        <div className="space-y-1 text-sm" data-testid="make3d-record">
                            <p>
                                <span className="font-semibold">Made with Make AI</span>
                                <span className="text-fg-muted"> · version {record.version} · cadgen {record.engine.version}</span>
                            </p>
                            <p className="text-fg-muted">“{record.prompt}”</p>
                            {record.minWallMm !== null && <p className="text-xs text-fg-subtle">Thinnest wall about {record.minWallMm.toFixed(1)} mm.</p>}
                            {record.warnings.length > 0 && (
                                <ul className="list-disc pl-5 text-xs text-amber">
                                    {record.warnings.map((w) => (
                                        <li key={w}>{w}</li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}

                    {record && s && <ApproveAndQuote status={s} buildId={buildId} approving={approve.isPending} approveError={approve.isError ? errorMessage(approve.error) : null} onApprove={(v) => approve.mutate(v)} />}

                    {!s?.available && !record ? (
                        <Notice tone="info" title="Make it in 3D is not available" testId="make3d-unavailable">
                            {s?.reason}
                        </Notice>
                    ) : null}

                    {make.isPending && <MakeIt3dProgress />}
                    {outcome && !make.isPending && <MakeIt3dFailureNotice outcome={outcome} />}
                    {make.error && <Notice tone="error">{errorMessage(make.error)}</Notice>}

                    {isCurrent && (s?.available || outcome) && !compact ? (
                        <div className={cn(record && 'border-t border-graphite-700 pt-4')}>
                            {record && <p className="mb-2 text-sm text-fg-muted">Want a different shape? Describe it again; you get a new version to approve.</p>}
                            <MakeIt3dForm initialPrompt={record?.prompt ?? promptFrom(view)} busy={make.isPending} submitLabel={record ? 'Make it again' : 'Make it in 3D'} onSubmit={(p) => make.mutate(p)} />
                        </div>
                    ) : null}
                </div>
            )}
        </PanelCard>
    );
}

function ApproveAndQuote({ status, buildId, approving, approveError, onApprove }: { status: MakeIt3dStatus; buildId: string; approving: boolean; approveError: string | null; onApprove: (v: number) => void }) {
    const record = status.record!;
    const onLatest = record.version === status.latestVersion;
    if (!status.latestApproved) {
        return (
            <div className="rounded-xl bg-graphite-850 p-4 ring-1 ring-inset ring-graphite-700" data-testid="make3d-approve-step">
                <p className="text-sm font-semibold">Check it, then approve it</p>
                <p className="mt-1 text-sm text-fg-muted">
                    Look at the model and its sizes. When it is right, approve version {status.latestVersion} to get a binding 3D-print price.
                    {!onLatest && ' (It carries the model from version ' + record.version + '.)'}
                </p>
                {approveError && <p className="mt-2 text-sm text-ember" role="alert">{approveError}</p>}
                <Button className="mt-3" onClick={() => onApprove(status.latestVersion)} loading={approving} data-testid="make3d-approve">
                    <CheckCircle2 className="h-4 w-4" aria-hidden /> Approve version {status.latestVersion}
                </Button>
            </div>
        );
    }
    return <QuoteCard status={status} buildId={buildId} />;
}

function QuoteCard({ status, buildId }: { status: MakeIt3dStatus; buildId: string }) {
    const qc = useQueryClient();
    const [material, setMaterial] = useState(status.printMaterials.find((m) => m.slug === 'petg')?.slug ?? status.printMaterials[0]?.slug ?? 'petg');
    const [quantity, setQuantity] = useState(1);
    const existing = useQuery({ queryKey: ['quote', status.quoteId], queryFn: ({ signal }) => workspaceApi.getQuote(status.quoteId!, signal), enabled: Boolean(status.quoteId) });
    const quote = useMutation({
        mutationFn: () => workspaceApi.quoteTextToCad(buildId, material, quantity),
        onSuccess: async (q) => {
            qc.setQueryData(['quote', q.id], q);
            await qc.invalidateQueries({ queryKey: textToCadQueryKey(buildId) });
        },
    });
    const q = quote.data ?? existing.data ?? null;
    const selectedName = status.printMaterials.find((m) => m.slug === material)?.name;
    const stale = q !== null && (q.summary.materialName !== selectedName || q.config.quantity !== quantity);
    return (
        <section aria-labelledby="make3d-quote-heading" className="rounded-xl bg-graphite-850 p-4 ring-1 ring-inset ring-graphite-700" data-testid="make3d-quote-card">
            <h3 id="make3d-quote-heading" className="flex items-center gap-2 text-sm font-semibold">
                <Printer className="h-4 w-4" aria-hidden /> Approved · 3D-print it
            </h3>
            <fieldset className="mt-3" disabled={quote.isPending}>
                <legend className="text-sm font-medium">Material</legend>
                <div className="mt-2 grid gap-2">
                    {status.printMaterials.map((m) => (
                        <label key={m.slug} className={cn('flex cursor-pointer items-start gap-2 rounded-lg p-2.5 text-sm ring-1 ring-inset', material === m.slug ? 'bg-signal/10 ring-signal' : 'ring-graphite-700 hover:ring-graphite-500')} data-testid={`make3d-material-${m.slug}`}>
                            <input type="radio" name="make3d-material" value={m.slug} checked={material === m.slug} onChange={() => setMaterial(m.slug)} className="mt-1 accent-signal" />
                            <span className="h-4 w-4 shrink-0 rounded-full ring-1 ring-graphite-600" style={{ backgroundColor: m.swatchHex }} aria-hidden />
                            <span className="min-w-0">
                                <span className="font-semibold">{m.name}</span> <span className="text-xs text-fg-subtle">{m.process}</span>
                                <span className="block text-xs text-fg-muted">{m.description}</span>
                            </span>
                        </label>
                    ))}
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">Quantity</span>
                    <QtyStepper value={quantity} onChange={setQuantity} min={1} max={100} label="Quantity" testId="make3d-qty" size="sm" />
                </div>
                {(!q || stale) && (
                    <Button className="mt-3 w-full" onClick={() => quote.mutate()} loading={quote.isPending} data-testid="make3d-get-quote">
                        {q ? 'Update the quote' : 'Get a binding quote'}
                    </Button>
                )}
            </fieldset>
            {quote.error && <Notice tone="error" className="mt-3">{errorMessage(quote.error)}</Notice>}
            {status.quoteId && existing.isPending && !quote.data && <Skeleton className="mt-4 h-24 w-full" />}
            {q && (
                <div className={cn('mt-4 border-t border-graphite-700 pt-4', stale && 'opacity-60')} data-testid="make3d-quote">
                    <TrustChip level={q.trustLevel} showOrderable />
                    <p className="mt-3 flex items-baseline justify-between gap-2">
                        <span className="font-display text-2xl font-extrabold" data-testid="make3d-total">
                            {money(q.subtotalCents, q.currency)}
                        </span>
                        <span className="text-sm text-fg-muted">
                            {q.config.quantity} × {money(q.unitPriceCents, q.currency)}
                        </span>
                    </p>
                    <p className="mt-1 text-xs text-fg-muted">
                        {q.summary.materialName} · {q.summary.thicknessLabel} · {q.route.machineLabel ?? q.route.processName}
                    </p>
                    <p className="mt-2 flex items-center gap-1.5 text-sm">
                        <Truck className="h-4 w-4 text-fg-muted" aria-hidden /> Ships {shortDate(q.shipDate)} · {q.leadTimeDays} business days
                    </p>
                    {q.dfm.violations.length > 0 && (
                        <ul className="mt-3 space-y-1 text-xs text-amber">
                            {q.dfm.violations.map((v) => (
                                <li key={v.ruleId}>{v.message}</li>
                            ))}
                        </ul>
                    )}
                    {q.orderable && !stale ? (
                        <ButtonLink href={`/checkout/${q.id}`} size="lg" className="mt-4 w-full" data-testid="make3d-checkout">
                            Checkout
                        </ButtonLink>
                    ) : !stale ? (
                        <p className="mt-4 text-sm text-fg-muted">This price needs a partner to confirm it before it can be ordered.</p>
                    ) : null}
                </div>
            )}
        </section>
    );
}
