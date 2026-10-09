/**
 * Browser client for the Media routes (src/app/api/media/**, auctions, fair queue, Watch My Build).
 */
import type {
    AuctionView,
    ChannelMediaPage,
    ClaimSlotsRequest,
    ClipCard,
    CreateClipRequest,
    CreatorPayoutView,
    CreatorPayoutsResponse,
    DropQueueResponse,
    FeedEventInput,
    FeedResponse,
    FeedTab,
    InsightRange,
    InsightsView,
    MakeFromBuildResponse,
    PlaceBidRequest,
    PlaceBidResponse,
    PublicBuildView,
    PublicationView,
    PublishBuildRequest,
    SearchResponse,
    ShowClipsResponse,
    StudioPublicationsResponse,
    WatchMyBuildView,
} from '@/contracts';
import { apiFetch } from '@/lib/api';

const enc = encodeURIComponent;

export const mediaApi = {
    feed: (tab: FeedTab, cursor?: string | null) => apiFetch<FeedResponse>(`/api/media/feed?tab=${tab}${cursor ? `&cursor=${enc(cursor)}` : ''}`),
    feedEvents: (events: FeedEventInput[]) => apiFetch<{ recorded: number }>('/api/media/feed/events', { body: { events } }),
    search: (q: string) => apiFetch<SearchResponse>(`/api/media/search?q=${enc(q)}`),
    build: (buildId: string) => apiFetch<PublicBuildView>(`/api/media/builds/${enc(buildId)}`),
    make: (buildId: string, kind: 'clone' | 'remix', via?: string) => apiFetch<MakeFromBuildResponse>(`/api/media/builds/${enc(buildId)}/make`, { body: { kind, ...(via ? { via } : {}) } }),
    publish: (buildId: string, body: PublishBuildRequest) => apiFetch<PublicationView>(`/api/media/builds/${enc(buildId)}/publish`, { body }),
    channel: (handle: string) => apiFetch<ChannelMediaPage>(`/api/media/channels/${enc(handle)}`),
    clip: (clipId: string) => apiFetch<ClipCard>(`/api/media/clips/${enc(clipId)}`),
    showClips: (showId: string) => apiFetch<ShowClipsResponse>(`/api/media/shows/${enc(showId)}/clips`),
    createClip: (showId: string, body: CreateClipRequest) => apiFetch<ClipCard>(`/api/media/shows/${enc(showId)}/clips`, { body }),
    insights: (range: InsightRange) => apiFetch<InsightsView>(`/api/media/studio/insights?range=${range}`),
    publications: () => apiFetch<StudioPublicationsResponse>('/api/media/studio/publications'),
    payouts: () => apiFetch<CreatorPayoutsResponse>('/api/media/studio/payouts'),
    requestPayout: () => apiFetch<CreatorPayoutView>('/api/media/studio/payouts', { method: 'POST' }),
    connect: () => apiFetch<{ url: string }>('/api/media/studio/payouts/connect', { method: 'POST' }),
    watch: (orderId: string, token: string | null) => apiFetch<WatchMyBuildView>(`/api/orders/${enc(orderId)}/watch${token ? `?t=${enc(token)}` : ''}`),
    auction: (auctionId: string) => apiFetch<AuctionView>(`/api/live/auctions/${enc(auctionId)}`),
    bid: (auctionId: string, body: PlaceBidRequest) => apiFetch<PlaceBidResponse>(`/api/live/auctions/${enc(auctionId)}/bids`, { body }),
    joinQueue: (dropId: string, body: ClaimSlotsRequest) => apiFetch<DropQueueResponse>(`/api/live/drops/${enc(dropId)}/queue`, { body }),
    queueStatus: (dropId: string) => apiFetch<DropQueueResponse>(`/api/live/drops/${enc(dropId)}/queue`),
};

/** Fire-and-forget feed logging (impressions are batched by the caller). */
export function logFeedEvents(events: FeedEventInput[]): void {
    if (!events.length) return;
    void mediaApi.feedEvents(events).catch(() => undefined);
}
