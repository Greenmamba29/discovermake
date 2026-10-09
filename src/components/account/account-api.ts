'use client';

/**
 * Browser client for the R2 account routes (ADR-0009). Cookies (dm_session, dm_device) are
 * HttpOnly and travel automatically with same-origin requests.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BuildForkResponse } from '@/contracts/build-graph';
import type {
    EmailStartResponse,
    MeResponse,
    MyBuildsResponse,
    MyBuildsTab,
    Preferences,
    ReorderResponse,
    SignInResponse,
    UpdatePreferencesRequest,
    UpdateProfileRequest,
} from '@/contracts/account';
import type { OkResponse } from '@/contracts/common';
import { apiFetch } from '@/lib/api';

const enc = encodeURIComponent;

export const accountApi = {
    me: () => apiFetch<MeResponse>('/api/me'),
    updateProfile: (body: UpdateProfileRequest) => apiFetch<MeResponse>('/api/me', { method: 'PATCH', body }),
    updatePreferences: (body: UpdatePreferencesRequest) => apiFetch<Preferences>('/api/me/preferences', { method: 'PUT', body }),
    emailStart: (email: string) => apiFetch<EmailStartResponse>('/api/auth/email/start', { body: { email } }),
    emailVerify: (challengeId: string, code: string) => apiFetch<SignInResponse>('/api/auth/email/verify', { body: { challengeId, code } }),
    passkeyRegisterOptions: () => apiFetch<Record<string, unknown>>('/api/auth/passkey/register/options', { method: 'POST' }),
    passkeyRegisterVerify: (response: unknown, name?: string) => apiFetch<{ ok: true; passkeyId: string }>('/api/auth/passkey/register/verify', { body: { response, name } }),
    passkeyLoginOptions: () => apiFetch<Record<string, unknown> & { challengeId: string }>('/api/auth/passkey/login/options', { method: 'POST' }),
    passkeyLoginVerify: (challengeId: string, response: unknown) => apiFetch<SignInResponse>('/api/auth/passkey/login/verify', { body: { challengeId, response } }),
    deletePasskey: (id: string) => apiFetch<OkResponse>(`/api/me/passkeys/${enc(id)}`, { method: 'DELETE' }),
    signOut: () => apiFetch<OkResponse>('/api/auth/signout', { method: 'POST' }),
    myBuilds: (tab: MyBuildsTab) => apiFetch<MyBuildsResponse>(`/api/me/builds?tab=${enc(tab)}`),
    reorder: (buildId: string) => apiFetch<ReorderResponse>(`/api/me/builds/${enc(buildId)}/reorder`, { method: 'POST' }),
    remix: (buildId: string) => apiFetch<BuildForkResponse>(`/api/builds/${enc(buildId)}/remix`, { method: 'POST' }),
};

export const ME_QUERY_KEY = ['me'] as const;

export function useMe() {
    return useQuery({ queryKey: ME_QUERY_KEY, queryFn: accountApi.me, staleTime: 30_000 });
}

/** Refresh everything that depends on who is signed in. */
export function useInvalidateAccount() {
    const qc = useQueryClient();
    return () => Promise.all([qc.invalidateQueries({ queryKey: ME_QUERY_KEY }), qc.invalidateQueries({ queryKey: ['my-builds'] })]);
}

/** Absolute or relative API URL -> in-app path for router.push. */
export function toAppPath(url: string): string {
    try {
        const u = new URL(url, window.location.origin);
        return u.origin === window.location.origin ? `${u.pathname}${u.search}` : '/';
    } catch {
        return '/';
    }
}
