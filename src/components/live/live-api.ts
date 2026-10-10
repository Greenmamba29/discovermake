/**
 * Browser client for the Live routes (src/app/api/live/**). Uses the shared apiFetch so
 * errors surface as ApiClientError with the server's plain-language message.
 */
import type {
    BuildForkResponse,
    BuildView,
    ChannelPageResponse,
    ChannelView,
    ClaimSlotsRequest,
    ClaimSlotsResponse,
    ControlRoomView,
    FollowChannelResponse,
    HostIntent,
    HostIntentResponse,
    LiveEvent,
    LiveHomeResponse,
    LiveTokenResponse,
    PollView,
    QuestionView,
    ShowSnapshot,
    ShowView,
    StudioOverview,
    UpdateShowRequest,
} from '@/contracts';
import { apiFetch } from '@/lib/api';

const enc = encodeURIComponent;

export type CreateShowInput = { title: string; format: ShowView['format']; scheduledFor: string; hlsUrl?: string; featuredBuildIds: string[] };
export type UpsertChannelInput = { name: string; handle: string; kind: ChannelView['kind']; categories: ChannelView['categories']; bio?: string };

export const liveApi = {
    home: (category?: string | null) => apiFetch<LiveHomeResponse>(`/api/live${category ? `?category=${enc(category)}` : ''}`),
    snapshot: (showId: string) => apiFetch<ShowSnapshot>(`/api/live/shows/${enc(showId)}`),
    token: (showId: string) => apiFetch<LiveTokenResponse>(`/api/live/shows/${enc(showId)}/token`, { method: 'POST' }),
    eventsSince: (showId: string, after: number) => apiFetch<{ events: LiveEvent[]; lastSeq: number }>(`/api/live/shows/${enc(showId)}/events?after=${after}&format=json`),
    chat: (showId: string, text: string) => apiFetch<{ event: LiveEvent }>(`/api/live/shows/${enc(showId)}/chat`, { body: { text } }),
    ask: (showId: string, mode: 'creator' | 'make_ai', text: string) => apiFetch<{ question: QuestionView }>(`/api/live/shows/${enc(showId)}/questions`, { body: { mode, text } }),
    like: (showId: string) => apiFetch<{ likeCount: number }>(`/api/live/shows/${enc(showId)}/like`, { method: 'POST' }),
    vote: (showId: string, pollId: string, optionIndex: number) => apiFetch<{ poll: PollView }>(`/api/live/shows/${enc(showId)}/polls/${enc(pollId)}/votes`, { body: { optionIndex } }),
    follow: (handle: string, follow: boolean) => apiFetch<FollowChannelResponse>(`/api/live/channels/${enc(handle)}/follow`, { method: follow ? 'POST' : 'DELETE' }),
    channel: (handle: string) => apiFetch<ChannelPageResponse>(`/api/live/channels/${enc(handle)}`),
    claim: (dropId: string, body: ClaimSlotsRequest, idempotencyKey: string) =>
        apiFetch<ClaimSlotsResponse>(`/api/live/drops/${enc(dropId)}/claims`, { body, headers: { 'idempotency-key': idempotencyKey } }),
    // Creator Studio
    studio: () => apiFetch<StudioOverview>('/api/live/studio'),
    upsertChannel: (body: UpsertChannelInput) => apiFetch<ChannelView>('/api/live/channels', { body }),
    createShow: (body: CreateShowInput) => apiFetch<ShowView>('/api/live/shows', { body }),
    updateShow: (showId: string, body: UpdateShowRequest) => apiFetch<ShowView>(`/api/live/shows/${enc(showId)}`, { method: 'PATCH' as never, body }),
    control: (showId: string) => apiFetch<ControlRoomView>(`/api/live/shows/${enc(showId)}/control`),
    intent: (showId: string, body: HostIntent) => apiFetch<HostIntentResponse>(`/api/live/shows/${enc(showId)}/intents`, { body }),
    becomeCreator: (handle: string) => apiFetch<unknown>('/api/me', { method: 'PATCH' as never, body: { becomeCreator: true, handle } }),
    // Existing build APIs used from the stream
    build: (buildId: string) => apiFetch<BuildView>(`/api/builds/${enc(buildId)}`),
    clone: (buildId: string) => apiFetch<BuildForkResponse>(`/api/builds/${enc(buildId)}/clone`, { body: {} }),
    remix: (buildId: string, name: string) => apiFetch<BuildForkResponse>(`/api/builds/${enc(buildId)}/remix`, { body: { name } }),
};
