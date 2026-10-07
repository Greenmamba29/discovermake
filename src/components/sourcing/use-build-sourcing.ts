'use client';

import { useQuery } from '@tanstack/react-query';
import type { BuildSourcingView } from '@/contracts';
import { ACTIVE_JOB_STATUSES, sourcingApi } from './api';

export const buildSourcingKey = (buildId: string) => ['build-sourcing', buildId] as const;

/** Newest job first. */
export function latestJob(view: BuildSourcingView | undefined) {
    if (!view || view.jobs.length === 0) return null;
    return [...view.jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export function activeJob(view: BuildSourcingView | undefined) {
    const job = latestJob(view);
    return job && ACTIVE_JOB_STATUSES.includes(job.status) ? job : null;
}

/** Polls the build's sourcing status: every 5 s while partners are being found, every 30 s otherwise. */
export function useBuildSourcing(buildId: string, opts: { activeMs?: number; idleMs?: number } = {}) {
    const { activeMs = 5_000, idleMs = 30_000 } = opts;
    return useQuery({
        queryKey: buildSourcingKey(buildId),
        queryFn: () => sourcingApi.buildSourcing(buildId),
        refetchInterval: (query) => (activeJob(query.state.data) ? activeMs : idleMs),
        refetchIntervalInBackground: false,
    });
}
