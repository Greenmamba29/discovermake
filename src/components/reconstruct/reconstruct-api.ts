/**
 * Browser-side calls for Reconstruct (R6). Responses are validated against the contracts.
 * Photos go through the attachment routes (signed upload + magic-byte checks).
 */
import { QuoteView } from '@/contracts/quotes';
import {
    CreateReconstructResponse,
    ReconstructGenerateResponse,
    ReconstructView,
    SegmentResponse,
    type CaliperReading,
    type CreateReconstructRequest,
    type PhotoMeasurements,
    type UpdateReconstructRequest,
} from '@/contracts/reconstruct';
import { defaultContentType, attachmentExtension } from '@/contracts/workspace';
import { apiFetch, putSigned } from '@/lib/api';
import { workspaceApi } from '@/components/workspace/workspace-api';

const enc = encodeURIComponent;

export const reconstructQueryKey = (buildId: string) => ['reconstruct', buildId] as const;

export const reconstructApi = {
    create: async (body: CreateReconstructRequest) => CreateReconstructResponse.parse(await apiFetch<unknown>('/api/reconstruct', { body })),
    view: async (buildId: string, signal?: AbortSignal) => ReconstructView.parse(await apiFetch<unknown>(`/api/reconstruct/${enc(buildId)}`, { signal })),
    update: async (buildId: string, body: UpdateReconstructRequest) => ReconstructView.parse(await apiFetch<unknown>(`/api/reconstruct/${enc(buildId)}`, { method: 'PATCH', body })),
    saveMeasurements: async (buildId: string, photos: PhotoMeasurements[]) => ReconstructView.parse(await apiFetch<unknown>(`/api/reconstruct/${enc(buildId)}/measurements`, { method: 'PUT', body: { photos } })),
    confirm: async (buildId: string, readings: CaliperReading[]) => ReconstructView.parse(await apiFetch<unknown>(`/api/reconstruct/${enc(buildId)}/dimensions`, { body: { readings } })),
    generate: async (buildId: string) => ReconstructGenerateResponse.parse(await apiFetch<unknown>(`/api/reconstruct/${enc(buildId)}/generate`, { method: 'POST' })),
    quote: async (buildId: string, printMaterialSlug: string, quantity: number) => QuoteView.parse(await apiFetch<unknown>(`/api/reconstruct/${enc(buildId)}/quote`, { body: { printMaterialSlug, quantity } })),
    getQuote: async (quoteId: string, signal?: AbortSignal) => QuoteView.parse(await apiFetch<unknown>(`/api/quotes/${enc(quoteId)}`, { signal })),
    segment: async (buildId: string, attachmentId: string) => SegmentResponse.parse(await apiFetch<unknown>(`/api/reconstruct/${enc(buildId)}/segment`, { body: { attachmentId } })),

    /** Upload one photo to the build: create -> signed PUT (with progress) -> verify (size + magic bytes). */
    uploadPhoto: async (buildId: string, file: File, onProgress?: (f: number) => void) => {
        const contentType = file.type || defaultContentType(attachmentExtension(file.name)) || 'image/jpeg';
        const created = await workspaceApi.createAttachment(buildId, { filename: file.name || 'photo.jpg', contentType, sizeBytes: file.size });
        await putSigned(created.upload, file, onProgress);
        return workspaceApi.completeAttachment(buildId, created.attachment.id);
    },
};
