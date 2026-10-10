/**
 * Browser-side calls for the Build Workspace. Responses are validated against the
 * Build Graph contracts before they reach the UI.
 */
import { BuildForkResponse, BuildGraphDiff, BuildGraphView } from '@/contracts';
import { BuildCadGenerated, BuildCadResponse, type CadSpecInput } from '@/contracts/cad';
import type { RequirementCategory } from '@/contracts/make-ai';
import {
    AssistantAskResponse,
    AssistantStatus,
    BuildAttachmentList,
    BuildAttachmentView,
    CreateAttachmentResponse,
    UseAttachmentAsPartResponse,
    type AssistantProposal,
    type CreateAttachmentRequest,
} from '@/contracts/workspace';
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

    // ---- Ask Make AI (300-3) ----
    assistantStatus: async (buildId: string, signal?: AbortSignal) => AssistantStatus.parse(await apiFetch<unknown>(`/api/builds/${enc(buildId)}/assistant`, { signal })),
    ask: async (buildId: string, message: string) => AssistantAskResponse.parse(await apiFetch<unknown>(`/api/builds/${enc(buildId)}/assistant`, { body: { action: 'ask', message } })),
    confirmProposal: async (buildId: string, basedOnVersion: number, proposal: AssistantProposal) =>
        BuildGraphView.parse(await apiFetch<unknown>(`/api/builds/${enc(buildId)}/assistant`, { body: { action: 'confirm', basedOnVersion, proposal } })),
    addRequirement: async (buildId: string, basedOnVersion: number, text: string, category: RequirementCategory) =>
        BuildGraphView.parse(await apiFetch<unknown>(`/api/builds/${enc(buildId)}/assistant`, { body: { action: 'add_requirement', basedOnVersion, text, category } })),

    // ---- Attachments (100-1) ----
    attachments: async (buildId: string, signal?: AbortSignal) => BuildAttachmentList.parse(await apiFetch<unknown>(`/api/builds/${enc(buildId)}/attachments`, { signal })),
    createAttachment: async (buildId: string, body: CreateAttachmentRequest) => CreateAttachmentResponse.parse(await apiFetch<unknown>(`/api/builds/${enc(buildId)}/attachments`, { body })),
    completeAttachment: async (buildId: string, attachmentId: string) =>
        BuildAttachmentView.parse(await apiFetch<unknown>(`/api/builds/${enc(buildId)}/attachments/${enc(attachmentId)}/complete`, { method: 'POST' })),
    removeAttachment: async (buildId: string, attachmentId: string) => apiFetch<{ ok: true }>(`/api/builds/${enc(buildId)}/attachments/${enc(attachmentId)}`, { method: 'DELETE' }),
    useAttachmentAsPart: async (buildId: string, attachmentId: string) =>
        UseAttachmentAsPartResponse.parse(await apiFetch<unknown>(`/api/builds/${enc(buildId)}/attachments/${enc(attachmentId)}/use-as-part`, { method: 'POST' })),
};

export const assistantQueryKey = (buildId: string) => ['build-assistant', buildId] as const;
export const attachmentsQueryKey = (buildId: string) => ['build-attachments', buildId] as const;

export const cadQueryKey = (buildId: string) => ['build-cad', buildId] as const;

export const graphQueryKey = (buildId: string, version: number | null) => ['build-graph', buildId, version ?? 'current'] as const;
