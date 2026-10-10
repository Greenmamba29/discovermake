'use client';

import { useQuery } from '@tanstack/react-query';
import type { MeResponse, MyBuildsResponse, UpdatePreferencesRequest } from '@/contracts/account';
import { apiFetch } from '@/lib/api';

/**
 * Read-side account hooks for the app shell, Home and Discover (contracts/account.ts).
 * They degrade gracefully: any failure (including 404 before the account API is deployed,
 * or a network error) reads as "no data", so the shell never breaks on account problems.
 */

async function optional<T>(path: string): Promise<T | null> {
    try {
        return await apiFetch<T>(path);
    } catch {
        return null;
    }
}

export const ME_QUERY_KEY = ['me'] as const;

/** GET /api/me: viewer (or null when signed out) + this device's preferences. */
export function useMe() {
    return useQuery({ queryKey: ME_QUERY_KEY, queryFn: () => optional<MeResponse>('/api/me'), staleTime: 60_000, retry: false });
}

/** GET /api/me/builds?limit=N: signed-in user's builds, else this device's guest builds. */
export function useMyBuilds(limit: number) {
    return useQuery({ queryKey: ['me', 'builds', limit], queryFn: () => optional<MyBuildsResponse>(`/api/me/builds?limit=${limit}`), staleTime: 30_000, retry: false });
}

/** PUT /api/me/preferences, best effort: returns false instead of throwing. */
export async function savePreferences(body: UpdatePreferencesRequest): Promise<boolean> {
    try {
        await apiFetch('/api/me/preferences', { method: 'PUT', body });
        return true;
    } catch {
        return false;
    }
}
