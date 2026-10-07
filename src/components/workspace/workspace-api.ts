/**
 * Browser-side calls for the Build Workspace. Responses are validated against the
 * Build Graph contracts before they reach the UI.
 */
import { BuildForkResponse, BuildGraphDiff, BuildGraphView } from '@/contracts';
import { BuildCadGenerated, BuildCadResponse, type CadSpecInput } from '@/contracts/cad';
import { apiFetch } from '@/lib/api';

const enc = encodeURIComponent;

export type WorkspaceAnswer = { unknownKey: string; value: string };

export const workspaceApi = {
    graph: async (buildId: string, version?: number | null, signal?: AbortSignal) =>
        BuildGraphView.parse(await apiFetch<unknown>(`/api/builds/${enc(buildId)}/graph${version ? `?version=${version}` : ''}`, { signal })),
    diff: async (buildId: string, from: number, to: number, signal?: AbortSignal) =>
        BuildGraphDiff.parse(await apiFetch<unknown>(`/api/builds/${enc(buildId)}/graph/diff?from=${from}&to=${to}`, { signal })),
    answer: async (buildId: string, answers: WorkspaceAnswer[]) => BuildGraphView.parse(await apiFetch<unknown>(`/api/builds/${enc(buildId)}/answers`, { body: { answers } })),
    approve: async (buildId: string, version: number) => BuildGraphView.parse(await apiFetch<unknown>(`/api/builds/${enc(buildId)}/versions/${version}/approve`, { method: 'POST' })),
    cad: async (buildId: string, signal?: AbortSignal) => BuildCadGenerated.nullable().parse(await apiFetch<unknown>(`/api/builds/${enc(buildId)}/cad`, { signal })),
    generateCad: async (buildId: string, spec?: CadSpecInput) => BuildCadResponse.parse(await apiFetch<unknown>(`/api/builds/${enc(buildId)}/cad`, { body: spec ? { spec } : {} })),
    fork: async (buildId: string, kind: 'remix' | 'clone') => BuildForkResponse.parse(await apiFetch<unknown>(`/api/builds/${enc(buildId)}/${kind}`, { method: 'POST' })),
};

export const cadQueryKey = (buildId: string) => ['build-cad', buildId] as const;

export const graphQueryKey = (buildId: string, version: number | null) => ['build-graph', buildId, version ?? 'current'] as const;
