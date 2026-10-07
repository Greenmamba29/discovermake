'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowUpRight, ChevronLeft, Landmark } from 'lucide-react';
import type { ShopConnectLinkResponse, ShopPayoutStatusResponse } from '@/contracts/connect';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/state';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiClientError, apiFetch, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

export const SHOP_PAYOUTS_QUERY_KEY = ['shop-payouts-status'] as const;

type Stage = 'not_started' | 'incomplete' | 'in_review' | 'active';

function stageOf(s: ShopPayoutStatusResponse): Stage {
    if (!s.connected) return 'not_started';
    if (s.payoutsEnabled) return 'active';
    return s.detailsSubmitted ? 'in_review' : 'incomplete';
}

const STAGE_COPY: Record<Stage, { badge: string; tone: 'signal' | 'amber' | 'muted'; body: string; cta: string | null }> = {
    not_started: {
        badge: 'Not set up',
        tone: 'muted',
        body: 'Connect a bank account through Stripe to be paid automatically when your orders are delivered.',
        cta: 'Set up payouts',
    },
    incomplete: {
        badge: 'Setup incomplete',
        tone: 'amber',
        body: 'You started payout setup with Stripe. Finish it to receive payouts automatically.',
        cta: 'Continue setup',
    },
    in_review: {
        badge: 'In review',
        tone: 'amber',
        body: 'Stripe is reviewing your details. If Stripe asks for more information, continue setup.',
        cta: 'Continue setup',
    },
    active: {
        badge: 'Payouts active',
        tone: 'signal',
        body: 'Payouts for delivered orders are sent to your bank account through Stripe.',
        cta: null,
    },
};

const BADGE_TONE = {
    signal: 'bg-signal/15 text-signal',
    amber: 'bg-amber/15 text-amber',
    muted: 'bg-graphite-750 text-fg-muted',
} as const;

const DOT_TONE = { signal: 'bg-signal', amber: 'bg-amber', muted: 'bg-fg-subtle' } as const;

/** Live payout status for the signed-in shop (never cached: always refetched on mount). */
export function useShopPayoutStatus() {
    return useQuery({
        queryKey: SHOP_PAYOUTS_QUERY_KEY,
        queryFn: () => apiFetch<ShopPayoutStatusResponse>('/api/shop/payouts/status'),
        retry: false,
        staleTime: 0,
        refetchOnMount: 'always',
    });
}

/**
 * Shop Console "Payouts" card: Stripe Connect status plus "Set up payouts" /
 * "Continue setup", which sends the shop to Stripe's hosted onboarding.
 */
export function PayoutsCard({ className, showDetailsLink = true, redirectOnUnauthorized = false }: { className?: string; showDetailsLink?: boolean; redirectOnUnauthorized?: boolean }) {
    const router = useRouter();
    const { data, error, isLoading, refetch } = useShopPayoutStatus();
    const [starting, setStarting] = useState(false);
    const [startError, setStartError] = useState<string | null>(null);

    const status = error instanceof ApiClientError ? error.status : null;
    useEffect(() => {
        if (redirectOnUnauthorized && status === 401) router.replace('/shop');
    }, [redirectOnUnauthorized, status, router]);

    async function startOnboarding() {
        setStarting(true);
        setStartError(null);
        try {
            const { url } = await apiFetch<ShopConnectLinkResponse>('/api/shop/payouts/connect', { method: 'POST', body: {} });
            window.location.assign(url);
        } catch (err) {
            setStartError(errorMessage(err));
            setStarting(false);
        }
    }

    // Signed out: the surrounding page handles the redirect; render nothing.
    if (status === 401) return null;

    return (
        <section aria-labelledby="payouts-card-title" className={cn('rounded-2xl bg-graphite-900 p-5 ring-1 ring-graphite-700', className)} data-testid="payouts-card">
            <div className="flex items-start gap-3">
                <div className="rounded-xl bg-graphite-800 p-2 text-fg-muted ring-1 ring-graphite-700">
                    <Landmark className="h-5 w-5" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <h2 id="payouts-card-title" className="font-display text-lg font-bold">
                            Payouts
                        </h2>
                        {data && <StageBadge stage={stageOf(data)} />}
                    </div>
                    <PayoutsBody
                        loading={isLoading}
                        data={data}
                        error={error}
                        status={status}
                        starting={starting}
                        onStart={startOnboarding}
                        onRetry={() => refetch()}
                        showDetailsLink={showDetailsLink}
                    />
                    {startError && (
                        <Notice tone="error" className="mt-3" testId="payouts-start-error">
                            {startError}
                        </Notice>
                    )}
                </div>
            </div>
        </section>
    );
}

function StageBadge({ stage }: { stage: Stage }) {
    const { badge, tone } = STAGE_COPY[stage];
    return (
        <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.08em]', BADGE_TONE[tone])} data-testid="payouts-stage" data-stage={stage}>
            <span className={cn('h-1.5 w-1.5 rounded-full', DOT_TONE[tone])} aria-hidden />
            {badge}
        </span>
    );
}

function PayoutsBody({
    loading,
    data,
    error,
    status,
    starting,
    onStart,
    onRetry,
    showDetailsLink,
}: {
    loading: boolean;
    data: ShopPayoutStatusResponse | undefined;
    error: unknown;
    status: number | null;
    starting: boolean;
    onStart: () => void;
    onRetry: () => void;
    showDetailsLink: boolean;
}) {
    if (loading) {
        return (
            <div className="mt-2 space-y-2" role="status" aria-live="polite">
                <span className="sr-only">Loading payout status…</span>
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-9 w-36" />
            </div>
        );
    }
    if (status === 503) {
        return <p className="mt-1 text-sm text-fg-muted">Online payout setup is not enabled yet. DiscoverMake ops settle your payouts directly for each delivered order.</p>;
    }
    if (error || !data) {
        return (
            <div className="mt-1">
                <p className="text-sm text-fg-muted" role="alert">
                    Could not load payout status. {errorMessage(error)}
                </p>
                <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
                    Try again
                </Button>
            </div>
        );
    }
    const stage = stageOf(data);
    const copy = STAGE_COPY[stage];
    return (
        <div className="mt-1">
            <p className="text-sm text-fg-muted">{copy.body}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
                {copy.cta && (
                    <Button size="sm" variant={stage === 'in_review' ? 'secondary' : 'primary'} loading={starting} onClick={onStart} data-testid="payouts-start">
                        {copy.cta}
                        {!starting && <ArrowUpRight className="h-4 w-4" aria-hidden />}
                    </Button>
                )}
                {showDetailsLink && (
                    <Link href="/shop/payouts" className="rounded-md text-sm font-medium text-fg-muted underline-offset-4 hover:text-fg hover:underline">
                        Payout details
                    </Link>
                )}
            </div>
            {copy.cta && <p className="mt-2 text-xs text-fg-subtle">You will finish setup on Stripe and come back here.</p>}
        </div>
    );
}

/**
 * `/shop/payouts`: where Stripe sends the shop back. `return` = the shop left Stripe's
 * onboarding (finished or not; the live status says which); `refresh` = the one-time
 * link expired or was already used, so a new one is needed.
 */
export function ShopPayoutsView({ returnStatus }: { returnStatus: 'return' | 'refresh' | null }) {
    const { data } = useShopPayoutStatus();
    const stage = data ? stageOf(data) : null;
    return (
        <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
            <Link href="/shop/jobs" className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-fg-muted hover:text-fg">
                <ChevronLeft className="h-4 w-4" aria-hidden /> Jobs
            </Link>
            <p className="eyebrow mt-4">Shop Console</p>
            <h1 className="mt-1 font-display font-wide text-3xl font-extrabold">Payouts</h1>
            <p className="mt-2 text-sm text-fg-muted">DiscoverMake pays your shop for each delivered order. Payouts go out through Stripe once your account is set up.</p>

            <div className="mt-6 space-y-4" aria-live="polite">
                {returnStatus === 'refresh' && (
                    <Notice tone="warning" title="Your setup link expired" testId="payouts-refresh-notice">
                        Setup links from Stripe work once and expire after a few minutes. Continue setup to get a fresh link; anything you already entered is saved.
                    </Notice>
                )}
                {returnStatus === 'return' && stage === 'active' && (
                    <Notice tone="success" title="Payouts are active" testId="payouts-return-notice">
                        Your Stripe account is ready. Payouts for delivered orders now go straight to your bank.
                    </Notice>
                )}
                {returnStatus === 'return' && stage === 'in_review' && (
                    <Notice tone="info" title="Thanks, your details are with Stripe" testId="payouts-return-notice">
                        Stripe is verifying your information. This page shows the latest status each time you open it.
                    </Notice>
                )}
                {returnStatus === 'return' && (stage === 'incomplete' || stage === 'not_started') && (
                    <Notice tone="warning" title="Setup is not finished" testId="payouts-return-notice">
                        Stripe still needs some information before it can send payouts. Continue setup to finish.
                    </Notice>
                )}
                <PayoutsCard showDetailsLink={false} redirectOnUnauthorized />
            </div>
        </div>
    );
}
