'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Search } from 'lucide-react';
import type { BuildSourcingView, RouteOfferView, TrustLevel } from '@/contracts';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Notice } from '@/components/ui/state';
import { errorMessage } from '@/lib/api';
import { plural } from '@/lib/format';
import { sourcingApi } from './api';
import { RouteOfferCard } from './route-offer-card';
import { SourcingProgress } from './sourcing-progress';
import { SourcingRequestForm } from './sourcing-request-form';
import { activeJob, buildSourcingKey, latestJob, useBuildSourcing } from './use-build-sourcing';

const TRUST_RANK: Record<TrustLevel, number> = { BINDING: 0, SUPPLIER_CONFIRMED: 1, SUPPLIER_ESTIMATE: 2, AI_ESTIMATE: 3 };
const STATUS_RANK: Record<RouteOfferView['status'], number> = { SELECTED: 0, ACTIVE: 1, STALE: 2, WITHDRAWN: 3, REJECTED: 4 };

/** Live offers first, then by trust (confirmed before estimates), then cheapest. */
export function sortOffers(offers: readonly RouteOfferView[]): RouteOfferView[] {
    return [...offers].sort(
        (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || TRUST_RANK[a.trustLevel] - TRUST_RANK[b.trustLevel] || a.totalCents - b.totalCents,
    );
}

function useSelectOffer(buildId: string) {
    const qc = useQueryClient();
    const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
    const select = async (offerId: string) => {
        setNotice(null);
        try {
            await sourcingApi.selectOffer(buildId, offerId);
            setNotice({ tone: 'success', text: "Thanks. We'll confirm this route with you before anything is ordered." });
        } catch (err) {
            setNotice({ tone: 'error', text: errorMessage(err) });
        } finally {
            await qc.invalidateQueries({ queryKey: buildSourcingKey(buildId) });
        }
    };
    return { select, notice };
}

function OfferList({ buildId, view }: { buildId: string; view: BuildSourcingView }) {
    const { select, notice } = useSelectOffer(buildId);
    const offers = sortOffers(view.offers);
    const committed = offers.find((o) => o.selection && (o.selection.status === 'PENDING' || o.selection.status === 'APPROVED'));
    const blocked = committed ? (committed.selection!.status === 'PENDING' ? 'Another route is waiting for confirmation.' : 'You already confirmed a route.') : null;
    return (
        <div className="space-y-3">
            {notice && (
                <Notice tone={notice.tone} testId="sourcing-select-notice">
                    {notice.text}
                </Notice>
            )}
            <ul className="space-y-3" aria-label="Partner offers">
                {offers.map((o) => (
                    <li key={o.id}>
                        <RouteOfferCard offer={o} onSelect={select} selectBlockedReason={committed && committed.id !== o.id ? blocked : null} />
                    </li>
                ))}
            </ul>
            <p className="text-xs text-fg-subtle">
                Partner offers are not checkout prices. Choosing one asks DiscoverMake to confirm it; we&apos;ll confirm the route with you before anything is ordered.
            </p>
        </div>
    );
}

/**
 * Buyer sourcing panel for a build: "Find manufacturing partners" form, the Uber-style
 * "Finding manufacturing partners…" state while a job is active, then offer cards with
 * trust labels and the select action. Polls GET /api/builds/:buildId/sourcing.
 */
export function BuildSourcingPanel({ buildId, partId, defaultQuantity }: { buildId: string; partId?: string; defaultQuantity?: number }) {
    const qc = useQueryClient();
    const q = useBuildSourcing(buildId);
    const [formOpen, setFormOpen] = useState(false);
    const view = q.data;
    const active = activeJob(view);
    const latest = latestJob(view);
    const offers = view?.offers ?? [];
    const lastEndedBadly = latest && (latest.status === 'FAILED' || latest.status === 'CANCELLED');
    const showForm = !active && Boolean(view) && (!latest || formOpen || (offers.length === 0 && lastEndedBadly));

    return (
        <section aria-labelledby="sourcing-heading" className="space-y-4" data-testid="build-sourcing-panel">
            <div className="flex items-end justify-between gap-3">
                <div>
                    <p className="eyebrow">Manufacturing partners</p>
                    <h2 id="sourcing-heading" className="mt-1 font-display text-xl font-bold">
                        {offers.length > 0 ? `${plural(offers.length, 'partner offer')}` : 'Partner quotes'}
                    </h2>
                </div>
                {view && (
                    <Button variant="ghost" size="sm" onClick={() => q.refetch()} aria-label="Refresh partner offers">
                        <RefreshCw className={q.isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} aria-hidden />
                    </Button>
                )}
            </div>

            {q.isLoading ? (
                <div role="status" aria-live="polite" className="space-y-2">
                    <span className="sr-only">Loading partner offers…</span>
                    <Skeleton className="h-24" />
                </div>
            ) : q.error && !view ? (
                <Notice tone="error" title="Couldn't load partner offers" action={<Button size="sm" variant="secondary" onClick={() => q.refetch()}>Try again</Button>}>
                    {errorMessage(q.error)}
                </Notice>
            ) : null}

            {active && <SourcingProgress job={active} offerCount={offers.length} />}

            {view && !active && latest?.status === 'COMPLETE' && offers.length === 0 && (
                <Notice tone="info" title="No partner could quote this yet">
                    Try a different quantity, date or region, or add notes about what matters most.
                </Notice>
            )}
            {view && !active && lastEndedBadly && offers.length === 0 && (
                <Notice tone="warning" title="That search stopped">
                    {latest!.status === 'CANCELLED' ? 'The last request was cancelled.' : 'We could not finish the last request.'} You can send a new one below.
                </Notice>
            )}

            {view && offers.length > 0 && <OfferList buildId={buildId} view={view} />}

            {showForm ? (
                <div className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700 sm:p-5">
                    <SourcingRequestForm
                        buildId={buildId}
                        partId={partId}
                        defaultQuantity={defaultQuantity}
                        onCreated={() => {
                            setFormOpen(false);
                            void qc.invalidateQueries({ queryKey: buildSourcingKey(buildId) });
                        }}
                        onCancel={latest ? () => setFormOpen(false) : undefined}
                    />
                </div>
            ) : (
                view &&
                !active && (
                    <Button variant="secondary" size="sm" onClick={() => setFormOpen(true)} data-testid="sourcing-request-again">
                        <Search className="h-4 w-4" aria-hidden /> Request new partner quotes
                    </Button>
                )
            )}
        </section>
    );
}

/**
 * Extra Manufacturing Route options under an orderable shop quote. Renders nothing until a
 * partner offer exists, so the R1 route screen is unchanged for builds that were never sourced.
 */
export function SupplierRouteOptions({ buildId }: { buildId: string }) {
    const q = useBuildSourcing(buildId);
    const view = q.data;
    if (!view || view.offers.length === 0) return null;
    return (
        <section aria-labelledby="supplier-routes-heading" className="space-y-3" data-testid="supplier-route-options">
            <div>
                <p className="eyebrow">More manufacturing routes</p>
                <h2 id="supplier-routes-heading" className="mt-1 font-display text-xl font-bold">
                    Partner offers
                </h2>
                <p className="mt-1 text-sm text-fg-muted">Each offer carries its trust level. Only a binding quote goes straight to checkout.</p>
            </div>
            <OfferList buildId={buildId} view={view} />
        </section>
    );
}
