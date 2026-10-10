/** Browser client for the Kids mode and Family routes. */
import type { CreateKidProfileRequest, FamilyView, KidDesignView, KidProfileView, KidThingView, UpdateKidProfileRequest } from '@/contracts/kids';
import type { KidTemplateId } from '@/contracts/text-to-cad';
import { apiFetch } from '@/lib/api';

const enc = encodeURIComponent;

export const kidsApi = {
    design: (template: KidTemplateId, params: Record<string, unknown>) => apiFetch<KidDesignView>('/api/kids/designs', { method: 'POST', body: { template, params } }),
    price: (designId: string) => apiFetch<KidDesignView>(`/api/kids/designs/${enc(designId)}/price`, { method: 'POST' }),
    ask: (designId: string) => apiFetch<KidThingView>('/api/kids/requests', { method: 'POST', body: { designId } }),
    exit: (pin: string) => apiFetch<{ url: string }>('/api/kids/exit', { method: 'POST', body: { pin } }),
};

export const familyApi = {
    get: () => apiFetch<FamilyView>('/api/family'),
    addKid: (body: CreateKidProfileRequest) => apiFetch<KidProfileView>('/api/family/kids', { method: 'POST', body }),
    updateKid: (kidId: string, body: UpdateKidProfileRequest) => apiFetch<KidProfileView>(`/api/family/kids/${enc(kidId)}`, { method: 'PATCH', body }),
    deleteKid: (kidId: string) => apiFetch<{ deleted: true }>(`/api/family/kids/${enc(kidId)}`, { method: 'DELETE' }),
    setPin: (pin: string) => apiFetch<{ pinSet: true }>('/api/family/pin', { method: 'PUT', body: { pin } }),
    handOff: (kidId: string) => apiFetch<{ url: string }>(`/api/family/kids/${enc(kidId)}/hand-off`, { method: 'POST' }),
    approve: (requestId: string) => apiFetch<{ checkoutUrl: string }>(`/api/family/requests/${enc(requestId)}/approve`, { method: 'POST' }),
    decline: (requestId: string, note?: string) => apiFetch<{ declined: true }>(`/api/family/requests/${enc(requestId)}/decline`, { method: 'POST', body: note ? { note } : {} }),
};
