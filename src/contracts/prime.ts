/**
 * R3 "Prime" customer experience contracts (docs/architecture/r3-prime-experience.md).
 *
 * Membership:
 *   GET  /api/me/membership                    -> MembershipResponse (works signed out: membership null)
 *   POST /api/me/membership                    StartMembershipRequest  -> StartMembershipResponse   (signed in)
 *   PATCH /api/me/membership                   UpdateMembershipRequest -> MembershipResponse        (signed in)
 *   POST /api/me/membership/dev                DevMembershipSimulateRequest (PAYMENT_PROVIDER=dev only)
 *
 * Build cart (guest = dm_device cookie, user = signed-in id; merged on sign-in):
 *   GET    /api/me/cart                        -> CartView
 *   POST   /api/me/cart/items                  AddCartItemRequest -> CartView
 *   DELETE /api/me/cart/items/:itemId          -> CartView
 *   POST   /api/me/cart/items/:itemId/upsell   ApplyUpsellRequest -> CartView
 *   GET    /api/me/cart/upsells?quoteId=       -> UpsellsResponse  (priced by the quote engine)
 *   POST   /api/me/cart/preview                CartPreviewRequest -> CheckoutPreviewResponse
 *   POST   /api/me/cart/checkout               CartCheckoutRequest -> CartCheckoutResponse (201)
 *
 * Checkout extras:
 *   POST /api/checkout/preview                 CheckoutPreviewRequest -> CheckoutPreviewResponse
 *   POST /api/checkout/address                 AddressCheckRequest -> AddressCheckResponse
 *   POST /api/checkout/invoice                 InvoiceCheckoutRequest -> CartCheckoutResponse (201)
 *
 * Orders (buyer auth = order link token `x-order-token` / `?t=`, or the signed-in owner):
 *   GET  /api/orders/:id/tracking-map          -> TrackingMapView
 *   GET  /api/orders/:id/messages              -> OrderChatView
 *   POST /api/orders/:id/messages              PostMessageRequest -> OrderChatView
 *   POST /api/orders/:id/messages/upload       ImageUploadRequest -> ImageUploadResponse
 *   GET  /api/orders/:id/rating                -> OrderRatingResponse
 *   POST /api/orders/:id/rating                SubmitRatingRequest -> OrderRatingResponse
 *   POST /api/orders/:id/rating/upload         ImageUploadRequest -> ImageUploadResponse
 *
 * Money is integer cents; the client never sends amounts or upsell prices.
 */
import { z } from 'zod';
import { Address, Cents, Email, IsoDate, IsoDateTime, OrderId, QuoteId } from './common';
import { CheckoutTotals } from './checkout';
import { OrderStatus, PaymentProviderName, ShippingMethod } from './enums';
import { QuoteConfigSummary } from './quotes';
import { PartPreview } from './parts';

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

export const PRIME_PLANS = ['monthly', 'annual'] as const;
export const PrimePlan = z.enum(PRIME_PLANS);
export type PrimePlan = z.infer<typeof PrimePlan>;

/** trialing → active → past_due → canceled (incomplete = checkout started, not yet confirmed). */
export const MEMBERSHIP_STATUSES = ['incomplete', 'trialing', 'active', 'past_due', 'canceled'] as const;
export const MembershipStatus = z.enum(MEMBERSHIP_STATUSES);
export type MembershipStatus = z.infer<typeof MembershipStatus>;

export const PrimePlanView = z.object({
    plan: PrimePlan,
    label: z.string(),
    priceCents: Cents,
    currency: z.string(),
    interval: z.enum(['month', 'year']),
    /** Price per month (annual / 12, rounded) for comparison. */
    perMonthCents: Cents,
    /** Annual vs. 12 × monthly, 0..100. */
    savingsPct: z.number().int().min(0).max(100),
});
export type PrimePlanView = z.infer<typeof PrimePlanView>;

/** What a member gets (server config; the paywall and checkout read the same numbers). */
export const PrimeBenefits = z.object({
    freeShippingThresholdCents: Cents,
    /** % off MATERIAL line items, never below cost. */
    materialDiscountPct: z.number().min(0).max(50),
    priorityQueue: z.boolean(),
    /** Consumed by the Delivery Promise engine (guaranteed-date eligibility). */
    guaranteedDates: z.boolean(),
    earlyAccess: z.boolean(),
});
export type PrimeBenefits = z.infer<typeof PrimeBenefits>;

export const MembershipView = z.object({
    id: z.string(),
    status: MembershipStatus,
    plan: PrimePlan,
    /** True while trialing or active: benefits apply. */
    isMember: z.boolean(),
    trialEndsAt: IsoDateTime.nullable(),
    currentPeriodEnd: IsoDateTime.nullable(),
    /** Next charge date (null when canceled or set to cancel). */
    renewsAt: IsoDateTime.nullable(),
    cancelAtPeriodEnd: z.boolean(),
    canceledAt: IsoDateTime.nullable(),
    provider: PaymentProviderName,
    /** Guaranteed-date eligibility for the promise engine. */
    guaranteedDates: z.boolean(),
    earlyAccess: z.boolean(),
    priorityQueue: z.boolean(),
});
export type MembershipView = z.infer<typeof MembershipView>;

export const TrialTimelineStep = z.object({
    key: z.enum(['today', 'reminder', 'trial_ends']),
    label: z.string(),
    date: IsoDate,
    description: z.string(),
});
export type TrialTimelineStep = z.infer<typeof TrialTimelineStep>;

export const MembershipResponse = z.object({
    signedIn: z.boolean(),
    membership: MembershipView.nullable(),
    /** False once this account has had a trial (a second trial is never offered). */
    trialAvailable: z.boolean(),
    trialDays: z.number().int().positive(),
    plans: z.array(PrimePlanView),
    benefits: PrimeBenefits,
    /** Today → reminder (2 days before) → trial ends, as real calendar dates from today. */
    trialTimeline: z.array(TrialTimelineStep),
});
export type MembershipResponse = z.infer<typeof MembershipResponse>;

export const StartMembershipRequest = z.object({ plan: PrimePlan });
export type StartMembershipRequest = z.infer<typeof StartMembershipRequest>;

export const StartMembershipResponse = z.object({
    /** Stripe Checkout (subscription mode) or, with the dev provider, the manage page. */
    redirectUrl: z.string().url(),
    membership: MembershipView.nullable(),
});
export type StartMembershipResponse = z.infer<typeof StartMembershipResponse>;

export const UpdateMembershipRequest = z.object({ action: z.enum(['cancel', 'resume']) });
export type UpdateMembershipRequest = z.infer<typeof UpdateMembershipRequest>;

/** Dev provider only: simulate what Stripe Billing would send. */
export const DevMembershipSimulateRequest = z.object({ action: z.enum(['end_trial', 'renew', 'payment_failed', 'cancel_now']) });
export type DevMembershipSimulateRequest = z.infer<typeof DevMembershipSimulateRequest>;

// ---------------------------------------------------------------------------
// Benefits at checkout
// ---------------------------------------------------------------------------

export const BENEFIT_CODES = ['FREE_SHIPPING', 'MATERIAL_DISCOUNT', 'PRIORITY_QUEUE', 'GUARANTEED_DATES'] as const;
export const BenefitCode = z.enum(BENEFIT_CODES);
export type BenefitCode = z.infer<typeof BenefitCode>;

export const AppliedBenefit = z.object({
    code: BenefitCode,
    label: z.string(),
    savingsCents: Cents,
});
export type AppliedBenefit = z.infer<typeof AppliedBenefit>;

export const CheckoutPreviewRequest = z.object({ quoteId: QuoteId, shippingMethod: ShippingMethod });
export type CheckoutPreviewRequest = z.infer<typeof CheckoutPreviewRequest>;

export const CheckoutPreviewResponse = z.object({
    totals: CheckoutTotals,
    /** Before membership benefits. */
    originalTotals: CheckoutTotals,
    benefits: z.array(AppliedBenefit),
    isMember: z.boolean(),
    /** For the "Prime members ship this free" card (non-members): what Prime would save here. */
    primeOffer: z
        .object({
            savingsCents: Cents,
            freeShippingThresholdCents: Cents,
            trialAvailable: z.boolean(),
        })
        .nullable(),
});
export type CheckoutPreviewResponse = z.infer<typeof CheckoutPreviewResponse>;

// ---------------------------------------------------------------------------
// Build cart + upsells
// ---------------------------------------------------------------------------

export const UPSELL_KINDS = ['hardware_kit', 'spare_part', 'finish_upgrade'] as const;
export const UpsellKind = z.enum(UPSELL_KINDS);
export type UpsellKind = z.infer<typeof UpsellKind>;

export const UpsellOffer = z.object({
    kind: UpsellKind,
    title: z.string(),
    description: z.string(),
    /** Server-priced: offer quote subtotal − base quote subtotal. */
    deltaCents: z.number().int(),
    offerQuoteId: QuoteId,
    offerSubtotalCents: Cents,
});
export type UpsellOffer = z.infer<typeof UpsellOffer>;

export const UpsellsResponse = z.object({ baseQuoteId: QuoteId, offers: z.array(UpsellOffer) });
export type UpsellsResponse = z.infer<typeof UpsellsResponse>;

export const CartItemView = z.object({
    id: z.string(),
    quoteId: QuoteId,
    partId: z.string(),
    buildId: z.string(),
    summary: QuoteConfigSummary,
    preview: PartPreview.nullable(),
    unitPriceCents: Cents,
    subtotalCents: Cents,
    currency: z.string(),
    /** False when the quote expired or went stale: re-quote before checkout. */
    orderable: z.boolean(),
    standardShippingCents: Cents.nullable(),
    shipDate: IsoDate,
    upsells: z.array(UpsellKind),
    addedAt: IsoDateTime,
});
export type CartItemView = z.infer<typeof CartItemView>;

export const CartView = z.object({
    id: z.string().nullable(),
    items: z.array(CartItemView),
    count: z.number().int().nonnegative(),
    subtotalCents: Cents,
    currency: z.string(),
    /** True when the cart belongs to this device (signed out). */
    guest: z.boolean(),
});
export type CartView = z.infer<typeof CartView>;

export const AddCartItemRequest = z.object({ quoteId: QuoteId, upsell: UpsellKind.optional() });
export type AddCartItemRequest = z.infer<typeof AddCartItemRequest>;

export const ApplyUpsellRequest = z.object({ kind: UpsellKind });
export type ApplyUpsellRequest = z.infer<typeof ApplyUpsellRequest>;

export const CartPreviewRequest = z.object({ shippingMethod: ShippingMethod });
export type CartPreviewRequest = z.infer<typeof CartPreviewRequest>;

export const NET_TERMS = [15, 30] as const;

export const PaymentChoice = z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('card') }),
    z.object({
        mode: z.literal('invoice'),
        netDays: z.union([z.literal(15), z.literal(30)]),
        poNumber: z.string().trim().max(60).optional(),
    }),
]);
export type PaymentChoice = z.infer<typeof PaymentChoice>;

const BuyerDetails = z.object({
    email: Email,
    name: z.string().trim().min(1).max(120),
    phone: z.string().trim().max(32).optional(),
});

export const CartCheckoutRequest = z.object({
    shippingMethod: ShippingMethod,
    buyer: BuyerDetails,
    shippingAddress: Address,
    acceptTerms: z.literal(true),
    notes: z.string().trim().max(1000).optional(),
    payment: PaymentChoice.default({ mode: 'card' }),
});
export type CartCheckoutRequest = z.infer<typeof CartCheckoutRequest>;

/** Single-quote "Pay by invoice (ACH / wire)" for business buyers: company is required. */
export const InvoiceCheckoutRequest = z.object({
    quoteId: QuoteId,
    shippingMethod: ShippingMethod,
    buyer: BuyerDetails,
    shippingAddress: Address.extend({ company: z.string().trim().min(2).max(120) }),
    acceptTerms: z.literal(true),
    notes: z.string().trim().max(1000).optional(),
    netDays: z.union([z.literal(15), z.literal(30)]),
    poNumber: z.string().trim().max(60).optional(),
});
export type InvoiceCheckoutRequest = z.infer<typeof InvoiceCheckoutRequest>;

export const INVOICE_STATUSES = ['open', 'paid', 'overdue', 'void'] as const;
export const InvoiceStatus = z.enum(INVOICE_STATUSES);
export type InvoiceStatus = z.infer<typeof InvoiceStatus>;

export const InvoiceView = z.object({
    id: z.string(),
    status: InvoiceStatus,
    provider: PaymentProviderName,
    amountCents: Cents,
    currency: z.string(),
    netDays: z.number().int().positive(),
    dueDate: IsoDate,
    /** Stripe-hosted invoice page (bank transfer details); null for the dev provider. */
    hostedUrl: z.string().url().nullable(),
    orderIds: z.array(OrderId),
    orderNumbers: z.array(z.string()),
    company: z.string(),
    buyerEmail: z.string(),
    poNumber: z.string().nullable(),
    paidAt: IsoDateTime.nullable(),
    paidReference: z.string().nullable(),
    createdAt: IsoDateTime,
});
export type InvoiceView = z.infer<typeof InvoiceView>;

export const CartCheckoutResponse = z.object({
    checkoutId: z.string(),
    orders: z.array(
        z.object({
            orderId: OrderId,
            orderNumber: z.string(),
            /** Signed buyer link (shown once, like CheckoutResponse.orderUrl). */
            orderUrl: z.string().url(),
            totals: CheckoutTotals,
        }),
    ),
    totals: CheckoutTotals,
    benefits: z.array(AppliedBenefit),
    payment: z.object({
        provider: PaymentProviderName,
        providerRef: z.string(),
        /** Card: hosted payment page. Invoice: the confirmation page. */
        redirectUrl: z.string().url(),
    }),
    invoice: InvoiceView.nullable(),
    /** Signed page listing every order of this checkout. */
    confirmationUrl: z.string().url(),
});
export type CartCheckoutResponse = z.infer<typeof CartCheckoutResponse>;

export const AdminMarkWireRequest = z.object({ reference: z.string().trim().min(3).max(120) });
export const DevInvoiceSimulateRequest = z.object({ outcome: z.enum(['paid', 'overdue']) });

// ---------------------------------------------------------------------------
// Address validation
// ---------------------------------------------------------------------------

export const AddressCheckRequest = z.object({
    address: Address,
    shippingMethod: ShippingMethod.optional(),
    /** True when the order ships as LTL freight (the quote's STANDARD option is freight). */
    freight: z.boolean().optional(),
});
export type AddressCheckRequest = z.infer<typeof AddressCheckRequest>;

export const ADDRESS_WARNING_CODES = ['ZIP_STATE_MISMATCH', 'PO_BOX_FREIGHT', 'MISSING_UNIT', 'UNDELIVERABLE', 'CORRECTED'] as const;
export const AddressWarning = z.object({ code: z.enum(ADDRESS_WARNING_CODES), message: z.string() });
export type AddressWarning = z.infer<typeof AddressWarning>;

export const AddressCheckResponse = z.object({
    source: z.enum(['easypost', 'heuristic']),
    /** Non-blocking: the buyer may keep their address. */
    warnings: z.array(AddressWarning),
    suggestion: Address.nullable(),
});
export type AddressCheckResponse = z.infer<typeof AddressCheckResponse>;

// ---------------------------------------------------------------------------
// Tracking map
// ---------------------------------------------------------------------------

export const GeoPoint = z.object({ lat: z.number(), lng: z.number(), label: z.string() });
export type GeoPoint = z.infer<typeof GeoPoint>;

export const TrackingMapView = z.object({
    from: GeoPoint,
    to: GeoPoint,
    /** Great-circle line, [lng, lat] pairs (GeoJSON order). */
    path: z.array(z.tuple([z.number(), z.number()])),
    /** 0..1 along the path (estimated from scans and dates). */
    progress: z.number().min(0).max(1),
    current: GeoPoint,
    /** One plain status sentence (Waymo rule). */
    statusSentence: z.string(),
    eta: IsoDate.nullable(),
    delivered: z.boolean(),
    carrier: z.object({
        carrier: z.string(),
        service: z.string(),
        trackingNumber: z.string(),
        trackingUrl: z.string().url().nullable(),
        lastScan: z.object({ message: z.string(), location: z.string().nullable(), at: IsoDateTime }).nullable(),
    }),
    /** Map tiles URL from NEXT_PUBLIC_MAP_STYLE_URL, or null for the offline SVG map. */
    styleUrl: z.string().url().nullable(),
});
export type TrackingMapView = z.infer<typeof TrackingMapView>;

// ---------------------------------------------------------------------------
// Order chat
// ---------------------------------------------------------------------------

export const MESSAGE_AUTHOR_KINDS = ['buyer', 'shop', 'ops', 'system'] as const;
export const MessageAuthorKind = z.enum(MESSAGE_AUTHOR_KINDS);
export type MessageAuthorKind = z.infer<typeof MessageAuthorKind>;

export const QUICK_REPLIES = ['where_is_my_order', 'approve_change', 'send_photo', 'hold_production'] as const;
export const QuickReply = z.enum(QUICK_REPLIES);
export type QuickReply = z.infer<typeof QuickReply>;

export const QUICK_REPLY_LABELS: Record<QuickReply, string> = {
    where_is_my_order: 'Where is my order?',
    approve_change: 'Approve change',
    send_photo: 'Send photo',
    hold_production: 'Hold production',
};

export const MAX_MESSAGE_CHARS = 2000;

export const OrderMessageView = z.object({
    id: z.string(),
    authorKind: MessageAuthorKind,
    authorLabel: z.string(),
    body: z.string(),
    quickReply: QuickReply.nullable(),
    /** Short-lived signed image URL. */
    attachmentUrl: z.string().url().nullable(),
    createdAt: IsoDateTime,
    mine: z.boolean(),
});
export type OrderMessageView = z.infer<typeof OrderMessageView>;

export const HOLD_STATUSES = ['requested', 'acknowledged', 'declined'] as const;
export const HoldStatus = z.enum(HOLD_STATUSES);

export const HoldRequestView = z.object({
    id: z.string(),
    orderId: OrderId,
    status: HoldStatus,
    note: z.string().nullable(),
    requestedAt: IsoDateTime,
    resolvedAt: IsoDateTime.nullable(),
});
export type HoldRequestView = z.infer<typeof HoldRequestView>;

export const OrderChatView = z.object({
    orderId: OrderId,
    orderNumber: z.string(),
    orderStatus: OrderStatus,
    viewer: z.enum(['buyer', 'shop', 'ops']),
    messages: z.array(OrderMessageView),
    /** Contextual chips above the composer (LinkedIn / Glovo pattern). */
    quickReplies: z.array(z.object({ key: QuickReply, label: z.string() })),
    unreadCount: z.number().int().nonnegative(),
    hold: HoldRequestView.nullable(),
});
export type OrderChatView = z.infer<typeof OrderChatView>;

export const PostMessageRequest = z
    .object({
        body: z.string().trim().max(MAX_MESSAGE_CHARS).optional(),
        quickReply: QuickReply.optional(),
        /** Key returned by the upload endpoint for this order. */
        attachmentKey: z.string().max(300).optional(),
    })
    .refine((v) => Boolean(v.body?.length || v.quickReply || v.attachmentKey), { message: 'Write a message, pick a quick reply or attach a photo.' });
export type PostMessageRequest = z.infer<typeof PostMessageRequest>;

export const IMAGE_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export const ImageUploadRequest = z.object({
    contentType: z.enum(IMAGE_CONTENT_TYPES),
    sizeBytes: z.number().int().positive().max(MAX_IMAGE_BYTES),
});
export type ImageUploadRequest = z.infer<typeof ImageUploadRequest>;

export const ImageUploadResponse = z.object({
    key: z.string(),
    upload: z.object({ url: z.string().url(), method: z.literal('PUT'), headers: z.record(z.string()), expiresAt: IsoDateTime }),
});
export type ImageUploadResponse = z.infer<typeof ImageUploadResponse>;

/** Shop Console flags per job order: Prime priority + unread chat. GET /api/shop/flags */
export const ShopJobFlagsResponse = z.object({
    orders: z.record(z.object({ priority: z.boolean(), unread: z.number().int().nonnegative() })),
});
export type ShopJobFlagsResponse = z.infer<typeof ShopJobFlagsResponse>;

// ---------------------------------------------------------------------------
// Ratings + UGC
// ---------------------------------------------------------------------------

export const RATING_TAGS = ['quality', 'fit', 'finish', 'packaging', 'on_time'] as const;
export const RatingTag = z.enum(RATING_TAGS);
export type RatingTag = z.infer<typeof RatingTag>;
export const RATING_TAG_LABELS: Record<RatingTag, string> = { quality: 'Quality', fit: 'Fit', finish: 'Finish', packaging: 'Packaging', on_time: 'On time' };

export const RATING_STATUSES = ['pending', 'approved', 'rejected'] as const;
export const RatingStatus = z.enum(RATING_STATUSES);
export type RatingStatus = z.infer<typeof RatingStatus>;

export const MAX_CAPTION_CHARS = 280;

export const SubmitRatingRequest = z.object({
    stars: z.number().int().min(1).max(5),
    tags: z
        .array(RatingTag)
        .max(RATING_TAGS.length)
        .refine((t) => new Set(t).size === t.length, 'Each tag once')
        .default([]),
    caption: z.string().trim().max(MAX_CAPTION_CHARS).optional(),
    photoKey: z.string().max(300).optional(),
});
export type SubmitRatingRequest = z.input<typeof SubmitRatingRequest>;

export const RatingView = z.object({
    id: z.string(),
    orderId: OrderId,
    stars: z.number().int().min(1).max(5),
    tags: z.array(RatingTag),
    caption: z.string().nullable(),
    photoUrl: z.string().url().nullable(),
    status: RatingStatus,
    rejectReason: z.string().nullable(),
    createdAt: IsoDateTime,
    moderatedAt: IsoDateTime.nullable(),
});
export type RatingView = z.infer<typeof RatingView>;

export const OrderRatingResponse = z.object({
    eligible: z.boolean(),
    /** Why not (e.g. "You can rate once the order is delivered."). */
    reason: z.string().nullable(),
    rating: RatingView.nullable(),
    shop: z.object({ name: z.string(), rating: z.number().nullable(), ratingCount: z.number().int().nonnegative() }).nullable(),
});
export type OrderRatingResponse = z.infer<typeof OrderRatingResponse>;

export const ModerateRatingRequest = z.object({ decision: z.enum(['approve', 'reject']), reason: z.string().trim().max(300).optional() });
export type ModerateRatingRequest = z.infer<typeof ModerateRatingRequest>;

export const AdminRatingItem = RatingView.extend({ orderNumber: z.string(), shopName: z.string(), buyerName: z.string() });
export type AdminRatingItem = z.infer<typeof AdminRatingItem>;

export const AdminHoldItem = HoldRequestView.extend({ orderNumber: z.string(), orderStatus: OrderStatus, shopName: z.string().nullable() });
export type AdminHoldItem = z.infer<typeof AdminHoldItem>;

/** GET /api/admin/prime -> the ops queue for R3 (moderation, holds, invoices, chats). */
export const AdminPrimeQueueResponse = z.object({
    ratings: z.array(AdminRatingItem),
    holds: z.array(AdminHoldItem),
    invoices: z.array(InvoiceView),
    chats: z.array(z.object({ orderId: OrderId, orderNumber: z.string(), lastMessageAt: IsoDateTime, unread: z.number().int().nonnegative(), preview: z.string() })),
});
export type AdminPrimeQueueResponse = z.infer<typeof AdminPrimeQueueResponse>;

export const ResolveHoldRequest = z.object({ decision: z.enum(['acknowledge', 'decline']), note: z.string().trim().max(500).optional() });
export type ResolveHoldRequest = z.infer<typeof ResolveHoldRequest>;
