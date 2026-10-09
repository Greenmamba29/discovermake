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
import { BuildId, Cents, IsoDateTime, OrderId, UserId } from './common';

export const ChannelId = z.string().regex(/^chn_[A-Za-z0-9_-]+$/);
export const ShowId = z.string().regex(/^shw_[A-Za-z0-9_-]+$/);
export const DropId = z.string().regex(/^drp_[A-Za-z0-9_-]+$/);
export const SlotClaimId = z.string().regex(/^slc_[A-Za-z0-9_-]+$/);

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
    z.object({ kind: z.literal('mp4'), url: z.string() }),
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
});
export type DropView = z.infer<typeof DropView>;

export const ShowView = z.object({
    id: ShowId,
    displayId: z.string(),
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
] as const;
export const LiveEventType = z.enum(LIVE_EVENT_TYPES);
export type LiveEventType = z.infer<typeof LiveEventType>;

/** Events only the server may emit; they always carry `sig`. */
export const SIGNED_LIVE_EVENTS: readonly LiveEventType[] = [
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
];

export const LIVE_ACTOR_KINDS = ['host', 'cohost', 'viewer', 'agent', 'system', 'machine'] as const;
export const LiveActorKind = z.enum(LIVE_ACTOR_KINDS);

export const LiveEvent = z.object({
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
export type LiveEvent = z.infer<typeof LiveEvent>;

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

/** GET /api/live/shows/:showId — snapshot for late joiners. */
export const ShowSnapshot = z.object({
    show: ShowView,
    featured: FeaturedProduct.nullable(),
    drop: DropView.nullable(),
    questions: z.array(QuestionView),
    recentChat: z.array(LiveEvent),
    lastSeq: z.number().int().nonnegative(),
    viewerRole: z.enum(['host', 'cohost', 'viewer', 'anonymous']),
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
        priceCents: Cents.min(100),
        totalSlots: z.number().int().min(1).max(10_000),
        thresholdSlots: z.number().int().min(1),
        perBuyerLimit: z.number().int().min(1).max(50).default(2),
        durationMinutes: z.number().int().min(5).max(60 * 24 * 7),
    }),
    z.object({ intent: z.literal('close_drop') }),
    z.object({ intent: z.literal('answer_question'), questionId: z.string(), answer: z.string().trim().min(1).max(1000) }),
    z.object({ intent: z.literal('create_poll'), question: z.string().trim().min(3).max(140), options: z.array(z.string().trim().min(1).max(60)).min(2).max(4) }),
    z.object({ intent: z.literal('remove_chat'), eventSeq: z.number().int().positive() }),
    z.object({ intent: z.literal('mute_viewer'), viewerId: z.string(), minutes: z.number().int().min(1).max(1440) }),
    z.object({ intent: z.literal('slow_mode'), seconds: z.number().int().min(0).max(300) }),
    z.object({ intent: z.literal('machine_milestone'), event: z.enum(['machine.started', 'machine.completed', 'inspection.passed', 'prototype.completed']), note: z.string().max(200).optional() }),
]);
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
export const ClaimSlotsRequest = z.object({ quantity: z.number().int().min(1).max(50) });
export const ClaimSlotsResponse = z.object({
    claimId: SlotClaimId,
    orderId: OrderId,
    checkoutUrl: z.string().nullable(),
    drop: DropView,
});
export type ClaimSlotsResponse = z.infer<typeof ClaimSlotsResponse>;

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
