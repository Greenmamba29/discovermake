/**
 * DiscoverMake Live (R4, workflow 06, ADR-0003).
 *
 * - **Channels** belong to a creator (user with the `creator` role) or a partner shop.
 * - **Shows** are scheduled or live sessions on a channel (`LIVE-123` display ids). A show
 *   has a video **source**: a LiveKit room (when LIVEKIT_* is configured) or an HLS/MP4
 *   URL (Owncast / MediaMTX / a recorded replay). Commerce never goes into the video.
 * - **Live Build Protocol**: every product, drop, Q&A and commerce change is a `LiveEvent`
 *   persisted with a per-show monotonic `seq` and `streamTsMs`, so replays are shoppable.
 *   Only the server emits commerce-affecting events; they carry an HMAC `sig`. Hosts send
 *   *intents* which the server validates and turns into signed events.
 * - Clients get a **snapshot** on join, then follow the event stream
 *   (`GET /api/live/shows/:id/events?after=<seq>` as Server-Sent Events, with a JSON
 *   polling fallback `?format=json`).
 *
 * Money is integer cents, as everywhere else.
 */
import { z } from 'zod';
import { Address, BuildId, Cents, IsoDateTime, OrderId, PartId, UserId } from './common';
import { PaymentProviderName, ShippingMethod } from './enums';

export const ChannelId = z.string().regex(/^chn_[A-Za-z0-9_-]+$/);
export const ShowId = z.string().regex(/^shw_[A-Za-z0-9_-]+$/);
export const DropId = z.string().regex(/^drp_[A-Za-z0-9_-]+$/);
export const SlotClaimId = z.string().regex(/^slc_[A-Za-z0-9_-]+$/);
/** R5: one-of-one live auctions and their bids; fair-queue entries for high-demand drops. */
export const AuctionId = z.string().regex(/^auc_[A-Za-z0-9_-]+$/);
export const AuctionBidId = z.string().regex(/^bid_[A-Za-z0-9_-]+$/);
export const DropQueueEntryId = z.string().regex(/^dqe_[A-Za-z0-9_-]+$/);
/** Public show id shown in the UI, e.g. `LIVE-984`. */
export const ShowDisplayId = z.string().regex(/^LIVE-\d+$/);

/** Absolute URL, or a same-origin path (committed replay fixtures under /public). */
const MediaUrl = z.string().refine((v) => isSameOriginPath(v) || z.string().url().safeParse(v).success, 'expected an absolute URL or a same-origin path');

/** `/media/replay.mp4`: one leading slash, no `..` segments, no backslashes or whitespace. */
function isSameOriginPath(v: string): boolean {
    return v.startsWith('/') && !v.startsWith('//') && !/[\\\s]/.test(v) && !v.split('/').some((seg) => seg === '..' || seg === '.');
}

export const CHANNEL_KINDS = ['creator', 'factory', 'campus'] as const;
export const ChannelKind = z.enum(CHANNEL_KINDS);

/** Live home chips (Whatnot pattern). */
export const CHANNEL_CATEGORIES = ['mega-builds', 'factory-floor', 'drops', 'workshop', 'materials', 'reconstruction'] as const;
export const ChannelCategory = z.enum(CHANNEL_CATEGORIES);

export const SHOW_STATUSES = ['SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED'] as const;
export const ShowStatus = z.enum(SHOW_STATUSES);

export const SHOW_FORMATS = ['creator_live', 'product_live', 'live_drop', 'build_live', 'factory_live'] as const;
export const ShowFormat = z.enum(SHOW_FORMATS);

export const VideoSource = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('livekit'), roomName: z.string() }),
    z.object({ kind: z.literal('hls'), url: z.string().url() }),
    z.object({ kind: z.literal('mp4'), url: MediaUrl }),
    z.object({ kind: z.literal('none') }),
]);
export type VideoSource = z.infer<typeof VideoSource>;

export const ChannelView = z.object({
    id: ChannelId,
    handle: z.string(),
    name: z.string(),
    kind: ChannelKind,
    categories: z.array(ChannelCategory),
    bio: z.string().nullable(),
    ownerUserId: UserId.nullable(),
    followerCount: z.number().int().nonnegative(),
    viewerFollows: z.boolean(),
    createdAt: IsoDateTime,
});
export type ChannelView = z.infer<typeof ChannelView>;

/** A build featured on a show, with buyer-safe commerce numbers. */
export const FeaturedProduct = z.object({
    buildId: BuildId,
    designVersion: z.number().int().positive(),
    name: z.string(),
    /** Price per unit for the featured configuration (BINDING quote or drop price). */
    priceCents: Cents.nullable(),
    leadTimeDays: z.number().int().positive().nullable(),
    materialLabel: z.string().nullable(),
    makeability: z.number().int().min(0).max(100).nullable(),
    /** Whether Make This / Remix / Buy are possible right now. */
    canMakeThis: z.boolean(),
    canRemix: z.boolean(),
    canBuy: z.boolean(),
    /** Quote used by Buy (orderable BINDING quote), when there is one. */
    quoteId: z.string().nullable(),
    // ---- R4 extensions (additive) ----
    /** Human build id (DM-XXXXX). */
    displayId: z.string(),
    /** Part the configure sheet prices (latest analyzed part), when the build has one. */
    partId: PartId.nullable(),
    /** One-line spec, e.g. `6061 Aluminum · 0.090" · 152 g`. Only from quote / graph data. */
    specLine: z.string().nullable(),
    /** True when the build has an APPROVED design version (Make Mine clones it; Remix forks it). */
    hasApprovedVersion: z.boolean(),
});
export type FeaturedProduct = z.infer<typeof FeaturedProduct>;

export const DROP_STATUSES = ['SCHEDULED', 'OPEN', 'CLOSED', 'CONFIRMED', 'FAILED'] as const;
export const DropStatus = z.enum(DROP_STATUSES);

export const DropView = z.object({
    id: DropId,
    showId: ShowId.nullable(),
    buildId: BuildId,
    title: z.string(),
    priceCents: Cents,
    totalSlots: z.number().int().positive(),
    claimedSlots: z.number().int().nonnegative(),
    /** Production starts once this many slots are claimed (MOQ). */
    thresholdSlots: z.number().int().positive(),
    perBuyerLimit: z.number().int().positive(),
    status: DropStatus,
    opensAt: IsoDateTime,
    closesAt: IsoDateTime,
    viewerClaimedSlots: z.number().int().nonnegative(),
    // ---- R5 extensions (additive) ----
    /** High-demand drop: claims enter a fair queue (random tie-break within the same second) instead of racing. */
    fairQueue: z.boolean().optional(),
});
export type DropView = z.infer<typeof DropView>;

export const ShowView = z.object({
    id: ShowId,
    displayId: ShowDisplayId,
    channel: ChannelView,
    title: z.string(),
    format: ShowFormat,
    status: ShowStatus,
    scheduledFor: IsoDateTime,
    startedAt: IsoDateTime.nullable(),
    endedAt: IsoDateTime.nullable(),
    source: VideoSource,
    viewerCount: z.number().int().nonnegative(),
    likeCount: z.number().int().nonnegative(),
    thumbnailUrl: z.string().nullable(),
});
export type ShowView = z.infer<typeof ShowView>;

// ---------------------------------------------------------------------------
// Live Build Protocol
// ---------------------------------------------------------------------------

export const LIVE_EVENT_TYPES = [
    // product state (server-signed)
    'product.focus',
    'variant.focus',
    'material.change',
    'price.change',
    'inventory.change',
    // remix
    'remix.started',
    'remix.created',
    // drops (server-signed)
    'drop.started',
    'drop.ending',
    'drop.closed',
    'build_slot.claimed',
    // Q&A
    'question.created',
    'question.answered',
    'poll.created',
    'poll.result',
    // chat + presence
    'chat.message',
    'chat.removed',
    'reaction.like',
    'viewer.count',
    // production
    'machine.started',
    'machine.completed',
    'inspection.passed',
    'prototype.completed',
    // commerce (server-signed)
    'order.created',
    'order.completed',
    // show lifecycle
    'show.started',
    'show.ended',
    // ---- R5: live auctions (server-signed) ----
    'auction.started',
    'auction.bid',
    'auction.closed',
] as const;
export const LiveEventType = z.enum(LIVE_EVENT_TYPES);
export type LiveEventType = z.infer<typeof LiveEventType>;

/** Events only the server may emit; they always carry `sig`. */
export const SIGNED_LIVE_EVENTS = [
    'product.focus',
    'variant.focus',
    'material.change',
    'price.change',
    'inventory.change',
    'drop.started',
    'drop.ending',
    'drop.closed',
    'build_slot.claimed',
    'order.created',
    'order.completed',
    'show.started',
    'show.ended',
    'auction.started',
    'auction.bid',
    'auction.closed',
] as const satisfies readonly LiveEventType[];
export type SignedLiveEventType = (typeof SIGNED_LIVE_EVENTS)[number];
export const isSignedLiveEvent = (e: LiveEventType): e is SignedLiveEventType => (SIGNED_LIVE_EVENTS as readonly string[]).includes(e);

export const LIVE_ACTOR_KINDS = ['host', 'cohost', 'viewer', 'agent', 'system', 'machine'] as const;
export const LiveActorKind = z.enum(LIVE_ACTOR_KINDS);

export const LiveEventBase = z.object({
    v: z.literal(1),
    event: LiveEventType,
    showId: ShowId,
    seq: z.number().int().positive(),
    streamTsMs: z.number().int().nonnegative(),
    actor: z.object({ kind: LiveActorKind, id: z.string(), name: z.string().nullable() }),
    buildId: BuildId.optional(),
    designVersion: z.number().int().positive().optional(),
    payload: z.record(z.unknown()),
    at: IsoDateTime,
    /** HMAC-SHA256 (LIVE_EVENT_SIGNING_SECRET) over the canonical event without `sig`. */
    sig: z.string().optional(),
});
type LiveEventFields = Omit<z.infer<typeof LiveEventBase>, 'event' | 'sig'>;
/** The type mirrors the runtime rule: signed event types always carry `sig`. */
export type LiveEvent =
    | (LiveEventFields & { event: SignedLiveEventType; sig: string })
    | (LiveEventFields & { event: Exclude<LiveEventType, SignedLiveEventType>; sig?: string });

/** Commerce-affecting events (`SIGNED_LIVE_EVENTS`) are rejected without `sig`; servers and clients still verify it. */
export const LiveEvent = LiveEventBase.superRefine((e, ctx) => {
    if (isSignedLiveEvent(e.event) && !e.sig) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sig'], message: `${e.event} must be server-signed` });
    }
}) as unknown as z.ZodType<LiveEvent, z.ZodTypeDef, unknown>;

export const QuestionView = z.object({
    id: z.string(),
    mode: z.enum(['creator', 'make_ai']),
    text: z.string(),
    askedBy: z.string(),
    answer: z.string().nullable(),
    answeredBy: z.enum(['host', 'make_ai']).nullable(),
    createdAt: IsoDateTime,
});
export type QuestionView = z.infer<typeof QuestionView>;

export const LivePollId = z.string().regex(/^lpl_[A-Za-z0-9_-]+$/);

/** A poll with live counts (`poll.created` / `poll.result`). */
export const PollView = z.object({
    id: LivePollId,
    question: z.string(),
    options: z.array(z.object({ label: z.string(), votes: z.number().int().nonnegative() })),
    total: z.number().int().nonnegative(),
    status: z.enum(['OPEN', 'CLOSED']),
    viewerVote: z.number().int().nonnegative().nullable(),
    createdAt: IsoDateTime,
});
export type PollView = z.infer<typeof PollView>;

/**
 * Build Slot claim lifecycle:
 *   RESERVED   order PENDING_PAYMENT, slots held while the buyer authorizes payment
 *   AUTHORIZED funds held at the provider, not captured
 *   CAPTURED   drop CONFIRMED: captured, order PAID and dispatched
 *   RELEASED   drop FAILED (or cancelled): authorization released, order CANCELLED
 *   EXPIRED    payment never authorized within the hold window: slots returned
 */
export const SLOT_CLAIM_STATUSES = ['RESERVED', 'AUTHORIZED', 'CAPTURED', 'RELEASED', 'EXPIRED'] as const;
export const SlotClaimStatus = z.enum(SLOT_CLAIM_STATUSES);
export type SlotClaimStatus = z.infer<typeof SlotClaimStatus>;

/** The signed-in viewer's own claims on the current drop. `orderUrl` is the signed buyer link. */
export const ViewerClaim = z.object({
    claimId: SlotClaimId,
    orderId: OrderId,
    quantity: z.number().int().positive(),
    status: SlotClaimStatus,
    orderUrl: z.string().nullable(),
    expiresAt: IsoDateTime,
});
export type ViewerClaim = z.infer<typeof ViewerClaim>;

/** GET /api/live/shows/:showId — snapshot for late joiners. */
export const ShowSnapshot = z.object({
    show: ShowView,
    featured: FeaturedProduct.nullable(),
    drop: DropView.nullable(),
    questions: z.array(QuestionView),
    recentChat: z.array(LiveEvent),
    lastSeq: z.number().int().nonnegative(),
    viewerRole: z.enum(['host', 'cohost', 'viewer', 'anonymous']),
    // ---- R4 extensions (additive) ----
    poll: PollView.nullable(),
    slowModeSeconds: z.number().int().nonnegative(),
    /** Set while the viewer is muted by the host. */
    viewerMutedUntil: IsoDateTime.nullable(),
    viewerLiked: z.boolean(),
    viewerClaims: z.array(ViewerClaim),
    /** Replays (ENDED shows) only: the whole event log, so the overlay replays in sync with `currentTime`. */
    replayEvents: z.array(LiveEvent).nullable(),
    // ---- R5 extensions (additive) ----
    /** The show's current (open, else latest) auction. */
    auction: z.lazy(() => AuctionView).nullable().optional(),
});
export type ShowSnapshot = z.infer<typeof ShowSnapshot>;

/** GET /api/live — live home. */
export const LiveHomeResponse = z.object({
    live: z.array(ShowView),
    upcoming: z.array(ShowView),
    replays: z.array(ShowView),
    categories: z.array(ChannelCategory),
});
export type LiveHomeResponse = z.infer<typeof LiveHomeResponse>;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** POST /api/live/channels (creator role) — create or update the viewer's channel. */
export const UpsertChannelRequest = z.object({
    name: z.string().trim().min(2).max(60),
    handle: z.string().trim().regex(/^[a-z0-9_]{3,24}$/),
    kind: ChannelKind.default('creator'),
    categories: z.array(ChannelCategory).max(3).default([]),
    bio: z.string().trim().max(280).optional(),
});

/** POST /api/live/shows (channel owner). */
export const CreateShowRequest = z.object({
    title: z.string().trim().min(3).max(100),
    format: ShowFormat,
    scheduledFor: IsoDateTime,
    /** Optional external source (Owncast/MediaMTX HLS); LiveKit rooms are created automatically. */
    hlsUrl: z.string().url().optional(),
    featuredBuildIds: z.array(BuildId).max(10).default([]),
});

/** POST /api/live/shows/:id/token → join credentials. */
export const LiveTokenResponse = z.object({
    source: VideoSource,
    /** LiveKit server URL + JWT (only for livekit sources). */
    livekit: z.object({ url: z.string(), token: z.string() }).nullable(),
    role: z.enum(['host', 'cohost', 'viewer']),
    expiresAt: IsoDateTime,
});
export type LiveTokenResponse = z.infer<typeof LiveTokenResponse>;

/** POST /api/live/shows/:id/intents (host/cohost) — validated by the server, emitted as signed events. */
export const HostIntent = z.discriminatedUnion('intent', [
    z.object({ intent: z.literal('start_show') }),
    z.object({ intent: z.literal('end_show') }),
    z.object({ intent: z.literal('feature_product'), buildId: BuildId }),
    z.object({
        intent: z.literal('start_drop'),
        buildId: BuildId,
        /** Build Slots are paid (authorize, then capture): at least $1.00, above card minimums. Free give-aways are not drops. */
        priceCents: Cents.min(100),
        totalSlots: z.number().int().min(1).max(10_000),
        thresholdSlots: z.number().int().min(1),
        perBuyerLimit: z.number().int().min(1).max(50).default(2),
        durationMinutes: z.number().int().min(5).max(60 * 24 * 7),
        /** R5: high-demand drop. Claims join a fair queue (POST /api/live/drops/:id/queue) instead of racing. */
        fairQueue: z.boolean().optional(),
    }),
    z.object({ intent: z.literal('close_drop') }),
    z.object({ intent: z.literal('answer_question'), questionId: z.string(), answer: z.string().trim().min(1).max(1000) }),
    z.object({ intent: z.literal('create_poll'), question: z.string().trim().min(3).max(140), options: z.array(z.string().trim().min(1).max(60)).min(2).max(4) }),
    z.object({ intent: z.literal('remove_chat'), eventSeq: z.number().int().positive() }),
    z.object({ intent: z.literal('mute_viewer'), viewerId: z.string(), minutes: z.number().int().min(1).max(1440) }),
    z.object({ intent: z.literal('slow_mode'), seconds: z.number().int().min(0).max(300) }),
    z.object({ intent: z.literal('machine_milestone'), event: z.enum(['machine.started', 'machine.completed', 'inspection.passed', 'prototype.completed']), note: z.string().max(200).optional() }),
    // ---- R5: one-of-one live auction (Whatnot Custom + Bid) ----
    z.object({
        intent: z.literal('start_auction'),
        buildId: BuildId,
        /** First bid; must cover the binding unit price at quantity 1 (creators cannot sell below cost). */
        startingBidCents: Cents.min(100),
        /** Bid ladder: every bid beats the current one by at least this much. */
        minIncrementCents: Cents.min(100).max(1_000_000).default(500),
        durationSeconds: z.number().int().min(20).max(60 * 60 * 24),
    }),
    z.object({ intent: z.literal('close_auction') }),
]).superRefine((v, ctx) => {
    if (v.intent === 'start_drop' && v.thresholdSlots > v.totalSlots) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['thresholdSlots'], message: 'thresholdSlots cannot exceed totalSlots' });
    }
});
export type HostIntent = z.infer<typeof HostIntent>;

/** POST /api/live/shows/:id/chat (signed in; slow mode + keyword filter + mute enforced). */
export const ChatRequest = z.object({ text: z.string().trim().min(1).max(300) });

/** POST /api/live/shows/:id/questions — Ask Creator queues; Ask Make AI answers from the build graph. */
export const AskRequest = z.object({ mode: z.enum(['creator', 'make_ai']), text: z.string().trim().min(3).max(500) });
export const AskResponse = z.object({ question: QuestionView });

/** POST /api/live/shows/:id/like */
export const LikeResponse = z.object({ likeCount: z.number().int().nonnegative() });

/**
 * POST /api/live/drops/:dropId/claims { quantity } (signed in) → a BUILD_SLOT order in
 * PENDING_PAYMENT with payment authorized-not-captured (dev provider in tests). Fair queue:
 * claims are serialized per drop (row lock), never exceed totalSlots or perBuyerLimit.
 * When the drop closes: claimed ≥ threshold → CONFIRMED (capture, orders proceed to
 * production as one batch); else FAILED (every authorization released).
 */
export const ClaimSlotsRequest = z.object({
    quantity: z.number().int().min(1).max(50),
    // ---- R4 extensions: a real order needs a ship-to; the buyer email comes from the signed-in viewer ----
    buyer: z.object({ name: z.string().trim().min(1).max(120), phone: z.string().trim().max(32).optional() }),
    shippingAddress: Address,
    shippingMethod: ShippingMethod.default('STANDARD'),
    /** Terms acknowledgement, incl. "charged only if the drop reaches its threshold". Must be literally true. */
    acceptTerms: z.literal(true),
});
export type ClaimSlotsRequest = z.infer<typeof ClaimSlotsRequest>;
export const ClaimSlotsResponse = z.object({
    claimId: SlotClaimId,
    orderId: OrderId,
    /** Where the buyer authorizes the payment hold (Stripe Checkout with manual capture, or the dev pay page). */
    checkoutUrl: z.string().nullable(),
    drop: DropView,
    // ---- R4 extensions (additive) ----
    status: SlotClaimStatus,
    /** Signed buyer link to the order tracker (shown once; only its HMAC is stored). */
    orderUrl: z.string().url(),
    payment: z.object({ provider: PaymentProviderName, providerRef: z.string() }),
    totalCents: Cents,
    /** The slots are held until then; an unauthorized claim expires and its slots return to the drop. */
    expiresAt: IsoDateTime,
});
export type ClaimSlotsResponse = z.infer<typeof ClaimSlotsResponse>;

// ---------------------------------------------------------------------------
// R5: fair queue for high-demand drops
// ---------------------------------------------------------------------------

/**
 * POST /api/live/drops/:dropId/queue ClaimSlotsRequest -> DropQueueResponse (signed in).
 * GET  /api/live/drops/:dropId/queue -> the viewer's entry (position while QUEUED).
 *
 * Entries are ordered by (enqueue second, random tie-break, id) and admitted one by one under
 * the drop row lock once their second has passed; an admitted entry is an ordinary RESERVED
 * claim (authorize the hold at `claim.checkoutUrl`). REJECTED entries carry the reason
 * (sold out, per-buyer limit, drop closed).
 */
export const DROP_QUEUE_STATUSES = ['QUEUED', 'ADMITTED', 'REJECTED'] as const;
export const DropQueueStatus = z.enum(DROP_QUEUE_STATUSES);
export type DropQueueStatus = z.infer<typeof DropQueueStatus>;
export const DropQueueResponse = z.object({
    entryId: DropQueueEntryId,
    dropId: DropId,
    status: DropQueueStatus,
    /** 1 = next to be admitted. Null once the entry left the queue. */
    position: z.number().int().positive().nullable(),
    queueLength: z.number().int().nonnegative(),
    quantity: z.number().int().positive(),
    claim: z
        .object({
            claimId: SlotClaimId,
            orderId: OrderId,
            checkoutUrl: z.string().nullable(),
            status: SlotClaimStatus,
            payment: z.object({ provider: PaymentProviderName, providerRef: z.string() }).nullable(),
            totalCents: Cents,
        })
        .nullable(),
    reason: z.string().nullable(),
    drop: DropView,
});
export type DropQueueResponse = z.infer<typeof DropQueueResponse>;

// ---------------------------------------------------------------------------
// R5: live auctions (one-of-ones)
// ---------------------------------------------------------------------------

/**
 *   OPEN      taking bids until `endsAt` (a bid in the last 10 s adds 15 s: anti-snipe)
 *   SOLD      closed with a winner: the winner's authorized hold was captured, every other hold released
 *   UNSOLD    closed without an authorized bid: every hold released
 *   CANCELLED the host cancelled it before any bid
 */
export const AUCTION_STATUSES = ['OPEN', 'SOLD', 'UNSOLD', 'CANCELLED'] as const;
export const AuctionStatus = z.enum(AUCTION_STATUSES);
export type AuctionStatus = z.infer<typeof AuctionStatus>;

/** PLACED counts on the ladder; WON / LOST / VOID after close (VOID = never authorized). */
export const AUCTION_BID_STATUSES = ['PLACED', 'WON', 'LOST', 'VOID'] as const;
export const AuctionBidStatus = z.enum(AUCTION_BID_STATUSES);
export type AuctionBidStatus = z.infer<typeof AuctionBidStatus>;

export const ANTI_SNIPE_WINDOW_MS = 10_000;
export const ANTI_SNIPE_EXTENSION_MS = 15_000;

export const ViewerBid = z.object({
    bidId: AuctionBidId,
    amountCents: Cents,
    status: AuctionBidStatus,
    /** The hold for this bid is authorized at the provider (only authorized bids can win). */
    authorized: z.boolean(),
    checkoutUrl: z.string().nullable(),
    orderUrl: z.string().nullable(),
});
export type ViewerBid = z.infer<typeof ViewerBid>;

export const AuctionView = z.object({
    id: AuctionId,
    showId: ShowId.nullable(),
    buildId: BuildId,
    title: z.string(),
    currency: z.string(),
    startingBidCents: Cents,
    minIncrementCents: Cents,
    currentBidCents: Cents.nullable(),
    /** The smallest bid accepted right now (ladder). */
    nextMinimumBidCents: Cents,
    bidCount: z.number().int().nonnegative(),
    leadingBidder: z.string().nullable(),
    status: AuctionStatus,
    endsAt: IsoDateTime,
    originalEndsAt: IsoDateTime,
    extensions: z.number().int().nonnegative(),
    closedAt: IsoDateTime.nullable(),
    winner: z.string().nullable(),
    viewerIsLeading: z.boolean(),
    /** The viewer's highest bid on this auction. */
    viewerBid: ViewerBid.nullable(),
});
export type AuctionView = z.infer<typeof AuctionView>;

/** POST /api/live/auctions/:auctionId/bids (signed in): a bid authorizes a hold for its amount + shipping. */
export const PlaceBidRequest = z.object({
    amountCents: Cents.min(100),
    buyer: z.object({ name: z.string().trim().min(1).max(120), phone: z.string().trim().max(32).optional() }),
    shippingAddress: Address,
    shippingMethod: ShippingMethod.default('STANDARD'),
    /** "Charged only if I win; every other hold is released at close." Must be literally true. */
    acceptTerms: z.literal(true),
});
export type PlaceBidRequest = z.infer<typeof PlaceBidRequest>;
export const PlaceBidResponse = z.object({
    bidId: AuctionBidId,
    orderId: OrderId,
    amountCents: Cents,
    totalCents: Cents,
    /** Where the bidder authorizes the hold (Stripe manual capture, or the dev pay page). */
    checkoutUrl: z.string().nullable(),
    orderUrl: z.string().url(),
    extended: z.boolean(),
    auction: AuctionView,
    payment: z.object({ provider: PaymentProviderName, providerRef: z.string() }),
});
export type PlaceBidResponse = z.infer<typeof PlaceBidResponse>;

/** POST|GET /api/admin/live/auctions/close (admin or cron): close every auction past its end. */
export const CloseAuctionsResponse = z.object({ closed: z.number().int().nonnegative() });
export type CloseAuctionsResponse = z.infer<typeof CloseAuctionsResponse>;

/** Go-live checklist (Creator Studio). */
export const GoLiveChecklist = z.object({
    items: z.array(
        z.object({
            key: z.enum(['channel', 'featured_product', 'orderable_quote', 'video_source', 'moderation', 'payouts']),
            label: z.string(),
            done: z.boolean(),
            hint: z.string().nullable(),
        }),
    ),
    ready: z.boolean(),
});
export type GoLiveChecklist = z.infer<typeof GoLiveChecklist>;

// ---------------------------------------------------------------------------
// R4 extensions: Creator Studio, control room, channel page
// ---------------------------------------------------------------------------

/** PATCH /api/live/shows/:id (channel owner): schedule details, source, featured builds (until the show ends). */
export const UpdateShowRequest = z.object({
    title: z.string().trim().min(3).max(100).optional(),
    format: ShowFormat.optional(),
    scheduledFor: IsoDateTime.optional(),
    hlsUrl: z.string().url().nullable().optional(),
    featuredBuildIds: z.array(BuildId).max(10).optional(),
});
export type UpdateShowRequest = z.infer<typeof UpdateShowRequest>;

/** POST /api/live/shows/:id/polls/:pollId/votes (signed in, one vote per viewer). */
export const PollVoteRequest = z.object({ optionIndex: z.number().int().min(0).max(3) });
export const PollVoteResponse = z.object({ poll: PollView });

/** POST /api/live/shows/:id/chat → the persisted event. */
export const ChatResponse = z.object({ event: LiveEvent });

export const StudioViewer = z.object({
    id: UserId,
    displayName: z.string().nullable(),
    handle: z.string().nullable(),
    isCreator: z.boolean(),
});
export type StudioViewer = z.infer<typeof StudioViewer>;

/** GET /api/live/studio (signed in): Creator Studio home. */
export const StudioOverview = z.object({
    viewer: StudioViewer,
    channel: ChannelView.nullable(),
    shows: z.array(ShowView),
    /** Go-live checklist for `nextShowId` (or the channel-only checklist when there is no show yet). */
    checklist: GoLiveChecklist,
    nextShowId: ShowId.nullable(),
});
export type StudioOverview = z.infer<typeof StudioOverview>;

export const LiveStats = z.object({
    viewerCount: z.number().int().nonnegative(),
    peakViewers: z.number().int().nonnegative(),
    likeCount: z.number().int().nonnegative(),
    chatCount: z.number().int().nonnegative(),
    questionCount: z.number().int().nonnegative(),
    openQuestionCount: z.number().int().nonnegative(),
    slotsClaimed: z.number().int().nonnegative(),
    orderCount: z.number().int().nonnegative(),
    /** Build Slot revenue held or captured, before shipping. */
    slotRevenueCents: Cents,
});
export type LiveStats = z.infer<typeof LiveStats>;

/** GET /api/live/shows/:id/control (host/cohost): the control room. */
export const ControlRoomView = z.object({
    snapshot: ShowSnapshot,
    featuredBuilds: z.array(FeaturedProduct),
    checklist: GoLiveChecklist,
    stats: LiveStats,
    mutes: z.array(z.object({ userId: z.string(), until: IsoDateTime })),
    hlsUrl: z.string().nullable(),
    livekitConfigured: z.boolean(),
});
export type ControlRoomView = z.infer<typeof ControlRoomView>;

/** GET /api/live/channels/:handle: channel page (Whatnot seller profile). */
export const ChannelPageResponse = z.object({
    channel: ChannelView,
    live: z.array(ShowView),
    upcoming: z.array(ShowView),
    replays: z.array(ShowView),
});
export type ChannelPageResponse = z.infer<typeof ChannelPageResponse>;

/** POST|DELETE /api/live/channels/:handle/follow (signed in). */
export const FollowChannelResponse = z.object({ following: z.boolean(), followerCount: z.number().int().nonnegative() });
export type FollowChannelResponse = z.infer<typeof FollowChannelResponse>;

/** POST|GET /api/admin/live/drops/close (admin or cron): close every drop past its deadline. */
export const CloseDropsResponse = z.object({ closed: z.number().int().nonnegative(), expiredClaims: z.number().int().nonnegative() });
export type CloseDropsResponse = z.infer<typeof CloseDropsResponse>;

/** Display id for a show number, e.g. 984 -> "LIVE-984". */
export function showDisplayId(n: number): string {
    return `LIVE-${n}`;
}

export type ChannelKind = z.infer<typeof ChannelKind>;
export type ChannelCategory = z.infer<typeof ChannelCategory>;
export type ShowStatus = z.infer<typeof ShowStatus>;
export type ShowFormat = z.infer<typeof ShowFormat>;
export type DropStatus = z.infer<typeof DropStatus>;
export type LiveActorKind = z.infer<typeof LiveActorKind>;
export type HostIntentName = HostIntent['intent'];
export type ChatResponse = z.infer<typeof ChatResponse>;
export type LikeResponse = z.infer<typeof LikeResponse>;
export type AskResponse = z.infer<typeof AskResponse>;
export type PollVoteResponse = z.infer<typeof PollVoteResponse>;
export const HostIntentResponse = z.object({ event: LiveEvent.nullable(), drop: DropView.optional(), auction: AuctionView.optional() });
export type HostIntentResponse = z.infer<typeof HostIntentResponse>;
