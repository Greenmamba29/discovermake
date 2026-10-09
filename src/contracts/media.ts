/**
 * DiscoverMake Media (R5, workflows 07 / 08 / 09, docs/architecture/r5-media.md).
 *
 * - **Publishing**: a build owner publishes a build (private -> public) with a remix licence
 *   and a royalty % on remixes and Make This orders. Published builds appear in Discover, on
 *   the creator's channel and at `/b/:buildId`.
 * - **Creator economics**: royalties accrue on order payment (reversed on refund) through the
 *   ledger (`CREATOR_PAYABLE`, subledger `creator_earnings`); Build Slot / auction revenue of
 *   the creator's own Live drops feeds the same balance. Payouts reuse Stripe Connect (or ops
 *   mark them paid without Stripe).
 * - **Clips**: (show, startMs, endMs, title, featured build) pointing into the show's replay.
 * - **Discover feed**: For you · Live · New · Trending, Postgres FTS search, feed event logging.
 * - **Watch My Build**: the buyer's own production stream (Shop Console milestones + shop camera).
 *
 * Money is integer cents, as everywhere else.
 */
import { z } from 'zod';
import { InterestSlug } from './account';
import { BuildDisplayId, BuildId, Cents, IsoDateTime, OrderId, PartId, QuoteId, UserId } from './common';
import { OrderStatus, UniversalStatus } from './enums';
import { ChannelKind, ChannelView, ShowFormat, ShowId, ShowStatus, ShowView, VideoSource } from './live';

export const ClipId = z.string().regex(/^clp_[A-Za-z0-9_-]+$/);
export const CreatorPayoutId = z.string().regex(/^cpo_[A-Za-z0-9_-]+$/);

// ---------------------------------------------------------------------------
// Publishing + licences
// ---------------------------------------------------------------------------

export const BUILD_VISIBILITIES = ['private', 'public'] as const;
export const BuildVisibility = z.enum(BUILD_VISIBILITIES);
export type BuildVisibility = z.infer<typeof BuildVisibility>;

/**
 * Remix licence (workflow 08):
 *   none        all rights reserved: Make This (order the creator's design) only, no remix
 *   personal    remix for your own use: the remix can be ordered, never published or sold
 *   commercial  remix, publish and sell the remix; the creator earns the royalty on its orders
 * Make This (clone) orders and remix orders both pay the royalty to the direct parent's creator.
 */
export const REMIX_LICENSES = ['none', 'personal', 'commercial'] as const;
export const RemixLicense = z.enum(REMIX_LICENSES);
export type RemixLicense = z.infer<typeof RemixLicense>;

export const ROYALTY_PCT_MIN = 0;
export const ROYALTY_PCT_MAX = 30;
export const ROYALTY_PCT_DEFAULT = 10;

export const LICENSE_LABELS: Record<RemixLicense, string> = {
    none: 'All rights reserved',
    personal: 'Personal remix',
    commercial: 'Commercial remix',
};

export const LICENSE_TEXT: Record<RemixLicense, string> = {
    none: 'You can order this design as it is (Make This). Remixing is not allowed.',
    personal: 'You can remix this design for your own use. Remixes cannot be published or sold.',
    commercial: 'You can remix this design, publish and sell your remix. The creator earns a royalty on every order of it.',
};

/** Lowercase tag slug, e.g. `desk-setup`. Tags that are interest slugs seed the For You ranking. */
export const Tag = z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,30}$/, 'Tags use 2–31 lowercase letters, numbers or dashes');

/** POST /api/media/builds/:buildId/publish (the build owner). */
export const PublishBuildRequest = z.object({
    visibility: BuildVisibility,
    license: RemixLicense.default('personal'),
    royaltyPct: z.number().int().min(ROYALTY_PCT_MIN).max(ROYALTY_PCT_MAX).default(ROYALTY_PCT_DEFAULT),
    title: z.string().trim().min(3).max(100).optional(),
    description: z.string().trim().max(1000).optional(),
    tags: z.array(Tag).max(8).default([]),
    /** An image attachment of the build to use as the cover (else the part preview). */
    coverAttachmentId: z
        .string()
        .regex(/^att_[A-Za-z0-9_-]+$/)
        .nullable()
        .optional(),
});
export type PublishBuildRequest = z.infer<typeof PublishBuildRequest>;

export const CreatorRef = z.object({
    userId: UserId,
    displayName: z.string().nullable(),
    handle: z.string().nullable(),
    /** The creator's Live channel, when they have one (`/c/:handle`). */
    channelHandle: z.string().nullable(),
    channelName: z.string().nullable(),
});
export type CreatorRef = z.infer<typeof CreatorRef>;

export const PublicationView = z.object({
    buildId: BuildId,
    displayId: BuildDisplayId,
    visibility: BuildVisibility,
    license: RemixLicense,
    royaltyPct: z.number().int().min(ROYALTY_PCT_MIN).max(ROYALTY_PCT_MAX),
    title: z.string(),
    description: z.string().nullable(),
    tags: z.array(z.string()),
    interests: z.array(InterestSlug),
    coverUrl: z.string().nullable(),
    publishedAt: IsoDateTime.nullable(),
    updatedAt: IsoDateTime,
    creator: CreatorRef,
});
export type PublicationView = z.infer<typeof PublicationView>;

/** A published build as a card (Discover, channel grid, search). */
export const BuildCard = z.object({
    buildId: BuildId,
    displayId: BuildDisplayId,
    title: z.string(),
    tags: z.array(z.string()),
    interests: z.array(InterestSlug),
    license: RemixLicense,
    royaltyPct: z.number().int().nonnegative(),
    coverUrl: z.string().nullable(),
    /** Part preview (SVG path in 0..width x 0..height mm) when there is no cover image. */
    previewSvg: z.string().nullable(),
    previewSize: z.object({ widthMm: z.number().nonnegative(), heightMm: z.number().nonnegative() }).nullable(),
    /** Unit price of the latest orderable BINDING quote. */
    priceCents: Cents.nullable(),
    currency: z.string(),
    makeability: z.number().int().min(0).max(100).nullable(),
    orderable: z.boolean(),
    partId: PartId.nullable(),
    remixCount: z.number().int().nonnegative(),
    creator: CreatorRef,
    publishedAt: IsoDateTime,
});
export type BuildCard = z.infer<typeof BuildCard>;

/** Remix tree (lineage through `derived_from_build_id`). Private builds show as "a private remix". */
export type RemixNode = {
    buildId: string;
    displayId: string;
    title: string;
    origin: 'upload' | 'make_ai' | 'remix' | 'clone';
    public: boolean;
    creatorName: string | null;
    orders: number;
    children: RemixNode[];
};
export const RemixNode: z.ZodType<RemixNode> = z.lazy(() =>
    z.object({
        buildId: BuildId,
        displayId: z.string(),
        title: z.string(),
        origin: z.enum(['upload', 'make_ai', 'remix', 'clone']),
        public: z.boolean(),
        creatorName: z.string().nullable(),
        orders: z.number().int().nonnegative(),
        children: z.array(RemixNode),
    }),
);

/** GET /api/media/builds/:buildId: the public build page `/b/:buildId`. 404 unless public (or the owner's). */
export const PublicBuildView = z.object({
    card: BuildCard,
    description: z.string().nullable(),
    licenseText: z.string(),
    visibility: BuildVisibility,
    viewerIsOwner: z.boolean(),
    /** Make This (order the design as yours) is always possible when there is something to make. */
    canMakeThis: z.boolean(),
    /** Remix is allowed by the licence (personal / commercial) and there is something to fork. */
    canRemix: z.boolean(),
    quote: z
        .object({
            quoteId: QuoteId,
            unitPriceCents: Cents,
            quantity: z.number().int().positive(),
            leadTimeDays: z.number().int().positive(),
            materialLabel: z.string(),
            orderable: z.boolean(),
        })
        .nullable(),
    parent: z.object({ buildId: BuildId, displayId: z.string(), title: z.string(), public: z.boolean(), creatorName: z.string().nullable() }).nullable(),
    remixTree: RemixNode,
    clips: z.array(z.lazy(() => ClipCard)),
});
export type PublicBuildView = z.infer<typeof PublicBuildView>;

/** POST /api/media/builds/:buildId/make — Make This (`clone`) or Remix, licence enforced. */
export const MakeFromBuildRequest = z.object({
    kind: z.enum(['clone', 'remix']),
    name: z.string().trim().min(1).max(120).optional(),
    /** Where the request came from, for feed attribution (clip id, `discover`, `build_page`). */
    via: z.string().trim().max(64).optional(),
});
export type MakeFromBuildRequest = z.infer<typeof MakeFromBuildRequest>;
export const MakeFromBuildResponse = z.object({
    buildId: BuildId,
    displayId: BuildDisplayId,
    derivedFromBuildId: BuildId,
    /** The copied flat pattern (configure + quote it), when the source had one. */
    partId: PartId.nullable(),
    /** Where to continue: the part configurator, else the build workspace. */
    nextUrl: z.string(),
    license: RemixLicense,
    royaltyPct: z.number().int().nonnegative(),
});
export type MakeFromBuildResponse = z.infer<typeof MakeFromBuildResponse>;

/** GET /api/media/studio/publications (signed in): the creator's builds with their publish state. */
export const StudioPublicationRow = z.object({
    buildId: BuildId,
    displayId: BuildDisplayId,
    name: z.string(),
    status: UniversalStatus,
    origin: z.enum(['upload', 'make_ai', 'remix', 'clone']),
    derivedFromBuildId: BuildId.nullable(),
    publication: PublicationView.nullable(),
    /** False for remixes of a personal / all-rights-reserved design (they can be ordered, not published). */
    canPublish: z.boolean(),
    publishBlockedReason: z.string().nullable(),
    images: z.array(z.object({ id: z.string(), filename: z.string() })),
    previewSvg: z.string().nullable(),
    previewSize: z.object({ widthMm: z.number().nonnegative(), heightMm: z.number().nonnegative() }).nullable(),
});
export type StudioPublicationRow = z.infer<typeof StudioPublicationRow>;
export const StudioPublicationsResponse = z.object({ rows: z.array(StudioPublicationRow) });
export type StudioPublicationsResponse = z.infer<typeof StudioPublicationsResponse>;

// ---------------------------------------------------------------------------
// Clips + replays
// ---------------------------------------------------------------------------

export const CLIP_ORIGINS = ['host', 'system'] as const;
export const ClipOrigin = z.enum(CLIP_ORIGINS);
export const CLIP_MIN_MS = 3_000;
export const CLIP_MAX_MS = 120_000;

export const ClipCard = z.object({
    id: ClipId,
    showId: ShowId,
    showDisplayId: z.string(),
    showTitle: z.string(),
    title: z.string(),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    /** The replay the clip points into (the player seeks; no transcoding). */
    source: VideoSource,
    channel: z.object({ handle: z.string(), name: z.string(), kind: ChannelKind }),
    /** The product pinned on the clip (Make Mine / Buy chips). */
    build: z
        .object({
            buildId: BuildId,
            displayId: z.string(),
            title: z.string(),
            priceCents: Cents.nullable(),
            quoteId: QuoteId.nullable(),
            partId: PartId.nullable(),
            canBuy: z.boolean(),
            published: z.boolean(),
        })
        .nullable(),
    /** Offset inside the clip where the product is pinned (its `product.focus`), in ms. */
    productAtMs: z.number().int().nonnegative(),
    origin: ClipOrigin,
    createdAt: IsoDateTime,
});
export type ClipCard = z.infer<typeof ClipCard>;

/** A window suggested from the Live Build Protocol log (`product.focus` / `drop.started`). */
export const ClipSuggestion = z.object({
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    title: z.string(),
    buildId: BuildId.nullable(),
    reason: z.enum(['product.focus', 'drop.started', 'auction.started']),
    eventSeq: z.number().int().positive(),
});
export type ClipSuggestion = z.infer<typeof ClipSuggestion>;

/** Replay chapter (from the event log), shareable as `/live/:showId?t=<seconds>`. */
export const ReplayChapter = z.object({
    atMs: z.number().int().nonnegative(),
    title: z.string(),
    kind: z.enum(['show.started', 'product.focus', 'drop.started', 'drop.closed', 'auction.started', 'auction.closed', 'milestone']),
    buildId: BuildId.nullable(),
});
export type ReplayChapter = z.infer<typeof ReplayChapter>;

/** GET /api/media/shows/:showId/clips — clips, suggestions (host only) and chapters. */
export const ShowClipsResponse = z.object({
    showId: ShowId,
    status: ShowStatus,
    clips: z.array(ClipCard),
    suggestions: z.array(ClipSuggestion),
    chapters: z.array(ReplayChapter),
    viewerIsHost: z.boolean(),
});
export type ShowClipsResponse = z.infer<typeof ShowClipsResponse>;

/** POST /api/media/shows/:showId/clips (host of an ENDED show). */
export const CreateClipRequest = z
    .object({
        startMs: z.number().int().nonnegative(),
        endMs: z.number().int().positive(),
        title: z.string().trim().min(3).max(100),
        buildId: BuildId.nullable().optional(),
    })
    .refine((c) => c.endMs - c.startMs >= CLIP_MIN_MS && c.endMs - c.startMs <= CLIP_MAX_MS, { message: `Clips are ${CLIP_MIN_MS / 1000}–${CLIP_MAX_MS / 1000} s long`, path: ['endMs'] });
export type CreateClipRequest = z.infer<typeof CreateClipRequest>;

// ---------------------------------------------------------------------------
// Discover feed + search
// ---------------------------------------------------------------------------

export const FEED_TABS = ['for_you', 'live', 'new', 'trending'] as const;
export const FeedTab = z.enum(FEED_TABS);
export type FeedTab = z.infer<typeof FeedTab>;

export const FeedShowCard = z.object({
    show: ShowView,
    format: ShowFormat,
});

export const FeedItem = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('build'), id: BuildId, score: z.number(), build: BuildCard }),
    z.object({ kind: z.literal('clip'), id: ClipId, score: z.number(), clip: ClipCard }),
    z.object({ kind: z.literal('show'), id: ShowId, score: z.number(), show: ShowView }),
]);
export type FeedItem = z.infer<typeof FeedItem>;

/** GET /api/media/feed?tab=for_you&cursor=<opaque>&limit=12 */
export const FeedResponse = z.object({
    tab: FeedTab,
    items: z.array(FeedItem),
    /** Opaque keyset cursor for the next page (null at the end). */
    nextCursor: z.string().nullable(),
    /** What seeded For You: the signed-in user's or this device's onboarding picks. */
    seededBy: z.object({ source: z.enum(['user', 'device', 'none']), interests: z.array(InterestSlug) }),
});
export type FeedResponse = z.infer<typeof FeedResponse>;

/** Logged for a future learned ranker (workflow 06: heuristic first, learned at ~100K sessions). */
export const FEED_EVENT_KINDS = ['impression', 'click', 'make_this', 'remix', 'share', 'play'] as const;
export const FeedEventKind = z.enum(FEED_EVENT_KINDS);
export const FeedEventInput = z.object({
    kind: FeedEventKind,
    itemKind: z.enum(['build', 'clip', 'show']),
    itemId: z.string().min(3).max(64).regex(/^(bld|clp|shw)_[A-Za-z0-9_-]+$/),
    tab: FeedTab.or(z.enum(['search', 'channel', 'build_page', 'clip_page'])).default('for_you'),
    position: z.number().int().min(0).max(10_000).optional(),
    score: z.number().finite().optional(),
});
export type FeedEventInput = z.infer<typeof FeedEventInput>;
/** POST /api/media/feed/events { events } -> { recorded } (signed in or a guest device; rate limited). */
export const FeedEventsRequest = z.object({ events: z.array(FeedEventInput).min(1).max(50) });
export type FeedEventsRequest = z.infer<typeof FeedEventsRequest>;

/** GET /api/media/search?q= — Postgres full-text search (+ trigram fuzzy matching when pg_trgm is installed). */
export const SearchResponse = z.object({
    q: z.string(),
    builds: z.array(BuildCard),
    channels: z.array(ChannelView),
    clips: z.array(ClipCard),
    mode: z.enum(['fts', 'fts+trgm']),
});
export type SearchResponse = z.infer<typeof SearchResponse>;

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

/** GET /api/media/channels/:handle — channel page `/c/:handle` (Whatnot seller profile). */
export const ChannelMediaPage = z.object({
    channel: ChannelView,
    ownerName: z.string().nullable(),
    viewerIsOwner: z.boolean(),
    live: z.array(ShowView),
    upcoming: z.array(ShowView),
    replays: z.array(ShowView),
    builds: z.array(BuildCard),
    clips: z.array(ClipCard),
    stats: z.object({ followers: z.number().int().nonnegative(), publishedBuilds: z.number().int().nonnegative(), shows: z.number().int().nonnegative() }),
});
export type ChannelMediaPage = z.infer<typeof ChannelMediaPage>;

// ---------------------------------------------------------------------------
// Creator economics: earnings, balance, payouts
// ---------------------------------------------------------------------------

/**
 * Subledger rows (`creator_earnings`), each mirrored by a balanced ledger transaction:
 *   REMIX_ROYALTY / MAKE_THIS_ROYALTY   order of a remix / clone of the creator's published build
 *   DROP_REVENUE / AUCTION_REVENUE      the creator's share of their own Live drop / auction orders
 *   *_REVERSAL                          the order was refunded (negative amount)
 */
export const CREATOR_EARNING_KINDS = ['REMIX_ROYALTY', 'MAKE_THIS_ROYALTY', 'DROP_REVENUE', 'AUCTION_REVENUE', 'ROYALTY_REVERSAL', 'REVENUE_REVERSAL'] as const;
export const CreatorEarningKind = z.enum(CREATOR_EARNING_KINDS);
export type CreatorEarningKind = z.infer<typeof CreatorEarningKind>;

export const CreatorEarningView = z.object({
    id: z.string(),
    kind: CreatorEarningKind,
    /** Signed: reversals are negative. */
    amountCents: z.number().int(),
    currency: z.string(),
    orderNumber: z.string(),
    buildId: BuildId,
    buildTitle: z.string(),
    sourceBuildId: BuildId.nullable(),
    createdAt: IsoDateTime,
});
export type CreatorEarningView = z.infer<typeof CreatorEarningView>;

export const CREATOR_PAYOUT_STATUSES = ['PENDING', 'PAID', 'FAILED', 'CANCELLED'] as const;
export const CreatorPayoutView = z.object({
    id: CreatorPayoutId,
    amountCents: Cents,
    currency: z.string(),
    status: z.enum(CREATOR_PAYOUT_STATUSES),
    method: z.enum(['stripe_connect', 'manual']),
    providerRef: z.string().nullable(),
    createdAt: IsoDateTime,
    paidAt: IsoDateTime.nullable(),
});
export type CreatorPayoutView = z.infer<typeof CreatorPayoutView>;

export const CreatorBalance = z.object({
    /** Earned minus reversals minus every payout that is not FAILED / CANCELLED. Can be negative after a clawback. */
    availableCents: z.number().int(),
    /** Payouts created but not settled yet. */
    inTransitCents: Cents,
    lifetimeEarnedCents: z.number().int(),
    paidOutCents: Cents,
    currency: z.string(),
});
export type CreatorBalance = z.infer<typeof CreatorBalance>;

/** GET /api/media/studio/payouts (signed in). */
export const CreatorPayoutsResponse = z.object({
    balance: CreatorBalance,
    minimumPayoutCents: Cents,
    earnings: z.array(CreatorEarningView),
    payouts: z.array(CreatorPayoutView),
    connect: z.object({
        /** Stripe is configured on this deployment (else payouts are settled manually by ops). */
        stripeConfigured: z.boolean(),
        connected: z.boolean(),
        payoutsEnabled: z.boolean(),
    }),
});
export type CreatorPayoutsResponse = z.infer<typeof CreatorPayoutsResponse>;

/** POST /api/admin/creator-payouts/:payoutId/paid (ops) — settle a manual creator payout. */
export const MarkCreatorPayoutPaidRequest = z.object({ reference: z.string().trim().min(1).max(200) });

// ---------------------------------------------------------------------------
// Creator dashboards (`/studio/insights`)
// ---------------------------------------------------------------------------

export const INSIGHT_RANGES = ['7d', '30d', '90d', 'all'] as const;
export const InsightRange = z.enum(INSIGHT_RANGES);
export type InsightRange = z.infer<typeof InsightRange>;

export const InsightsView = z.object({
    range: InsightRange,
    from: IsoDateTime.nullable(),
    to: IsoDateTime,
    currency: z.string(),
    totals: z.object({
        earningsCents: z.number().int(),
        royaltiesCents: z.number().int(),
        liveRevenueCents: z.number().int(),
        orders: z.number().int().nonnegative(),
        remixes: z.number().int().nonnegative(),
        showViews: z.number().int().nonnegative(),
        likes: z.number().int().nonnegative(),
        /** Build Slots claimed per 100 unique viewers across the range's shows (null without viewers). */
        slotConversionPct: z.number().nonnegative().nullable(),
    }),
    /** One point per day (UTC) in the range (the last 30 days for `all`). */
    series: z.array(z.object({ date: z.string(), royaltiesCents: z.number().int(), liveRevenueCents: z.number().int(), orders: z.number().int().nonnegative() })),
    /** DoorDash product mix: share of earnings per build. */
    productMix: z.array(z.object({ buildId: BuildId, title: z.string(), earningsCents: z.number().int(), sharePct: z.number(), orders: z.number().int().nonnegative() })),
    /** Square best sellers. */
    topBuilds: z.array(z.object({ buildId: BuildId, title: z.string(), orders: z.number().int().nonnegative(), earningsCents: z.number().int(), remixes: z.number().int().nonnegative(), published: z.boolean() })),
    remixTree: z.array(RemixNode),
    shows: z.array(
        z.object({
            showId: ShowId,
            displayId: z.string(),
            title: z.string(),
            status: ShowStatus,
            startedAt: IsoDateTime.nullable(),
            peakViewers: z.number().int().nonnegative(),
            uniqueViewers: z.number().int().nonnegative(),
            likes: z.number().int().nonnegative(),
            slotsClaimed: z.number().int().nonnegative(),
            slotConversionPct: z.number().nonnegative().nullable(),
            revenueCents: z.number().int(),
            clips: z.number().int().nonnegative(),
        }),
    ),
});
export type InsightsView = z.infer<typeof InsightsView>;

// ---------------------------------------------------------------------------
// Watch My Build
// ---------------------------------------------------------------------------

export const WATCH_POST_KINDS = ['paid', 'accepted', 'material_staged', 'cutting', 'bending', 'finishing', 'qa', 'packed', 'qa_passed', 'qa_failed', 'shipped', 'delivered'] as const;
export const WatchPostKind = z.enum(WATCH_POST_KINDS);
export type WatchPostKind = z.infer<typeof WatchPostKind>;

export const WatchPost = z.object({
    id: z.string(),
    kind: WatchPostKind,
    label: z.string(),
    note: z.string().nullable(),
    at: IsoDateTime,
    actor: z.enum(['shop', 'carrier', 'system']),
    /** Short-lived signed URLs of the shop's photos for this step. */
    photoUrls: z.array(z.string()),
});
export type WatchPost = z.infer<typeof WatchPost>;

/** GET /api/orders/:orderId/watch (signed order token, or the signed-in buyer). Wrong token -> 404. */
export const WatchMyBuildView = z.object({
    orderId: OrderId,
    orderNumber: z.string(),
    status: OrderStatus,
    buildId: BuildId,
    buildTitle: z.string(),
    shopName: z.string().nullable(),
    posts: z.array(WatchPost),
    /** A live camera show on the shop's channel linked to this job (format `build_live`). */
    camera: z.object({ showId: ShowId, title: z.string(), status: ShowStatus, source: VideoSource, channelName: z.string() }).nullable(),
    inProduction: z.boolean(),
});
export type WatchMyBuildView = z.infer<typeof WatchMyBuildView>;
