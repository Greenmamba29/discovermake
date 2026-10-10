/**
 * Kids & Family contracts (docs/architecture/kids-family.md).
 *
 * Model (Amazon household / teen accounts): a signed-in grown-up is the account holder and the
 * only person who gives consent, pays and receives email. They add up to four kid profiles
 * (nickname, age band, preset avatar: nothing else about a child is ever collected), set the
 * controls per kid and a 4-digit grown-up PIN, then "Hand to <kid>" on their own device. The kid
 * designs one of the KID_TEMPLATES with bounded options and taps "Ask a grown-up"; the grown-up
 * approves and pays through their normal checkout (Prime benefits apply because they are the buyer).
 *
 * Kids mode is a separate signed cookie (`dm_kid`) plus a server-side lock on the grown-up's
 * session: while it is active the grown-up's account is unusable from that browser and every
 * route outside Kids mode is refused (src/lib/kids/policy.ts).
 */
import { z } from 'zod';
import { idOf, IsoDateTime } from './common';
import { OrderStatus } from './enums';
import { KID_COLORS, KID_TEMPLATE_IDS, KID_TEMPLATES, KidColor, KidLabel, KidTemplateId, type KidTemplateParams } from './text-to-cad';

export const KID_COOKIE = 'dm_kid';

export const KidProfileId = idOf('kidProfile');
export const KidDesignId = idOf('kidDesign');
export const KidRequestId = idOf('kidRequest');

export const KID_MAX_PROFILES = 4;
export const KID_DEFAULT_SPENDING_LIMIT_CENTS = 2500;
/** Highest per-request limit a grown-up can set ($200). */
export const KID_MAX_SPENDING_LIMIT_CENTS = 20_000;
export const KID_MIN_SPENDING_LIMIT_CENTS = 500;

export const KID_AGE_BANDS = ['6-9', '10-12', '13-17'] as const;
export const KidAgeBand = z.enum(KID_AGE_BANDS);
export type KidAgeBand = z.infer<typeof KidAgeBand>;

/** Preset avatars only: no photo upload exists anywhere in Family or Kids mode. */
export const KID_AVATARS = ['fox', 'owl', 'robot', 'rocket', 'cat', 'dino', 'star', 'whale'] as const;
export const KidAvatar = z.enum(KID_AVATARS);
export type KidAvatar = z.infer<typeof KidAvatar>;

export const KID_AVATAR_EMOJI: Record<KidAvatar, string> = { fox: '🦊', owl: '🦉', robot: '🤖', rocket: '🚀', cat: '🐱', dino: '🦕', star: '⭐', whale: '🐳' };

/** A nickname, never a real full name: letters, numbers and spaces, 12 at most. */
export const KidNickname = z
    .string()
    .trim()
    .min(1, 'Type a nickname.')
    .max(12, 'Use 12 characters or fewer.')
    .regex(/^[A-Za-z0-9 ]+$/, 'Use letters, numbers and spaces only.');

export const GrownUpPin = z.string().regex(/^\d{4}$/, 'Use exactly 4 digits.');

const AGE_MIN: Record<KidAgeBand, number> = { '6-9': 6, '10-12': 10, '13-17': 13 };
const TEMPLATE_MIN_AGE = { '6+': 6, '8+': 8, '10+': 10 } as const;

/** Age-appropriate templates by default: those whose minimum age is at most the band's youngest age. */
export function defaultTemplatesFor(band: KidAgeBand): KidTemplateId[] {
    return KID_TEMPLATE_IDS.filter((id) => TEMPLATE_MIN_AGE[KID_TEMPLATES[id].ages] <= AGE_MIN[band]);
}

/** Live viewing and Discover browsing default off for under-13s. */
export function defaultControlsFor(band: KidAgeBand): { liveViewing: boolean; discoverBrowsing: boolean; allowedTemplates: KidTemplateId[]; spendingLimitCents: number } {
    const teen = band === '13-17';
    return { liveViewing: teen, discoverBrowsing: teen, allowedTemplates: defaultTemplatesFor(band), spendingLimitCents: KID_DEFAULT_SPENDING_LIMIT_CENTS };
}

const SpendingLimit = z.number().int().min(KID_MIN_SPENDING_LIMIT_CENTS).max(KID_MAX_SPENDING_LIMIT_CENTS);
const AllowedTemplates = z.array(KidTemplateId).max(KID_TEMPLATE_IDS.length).transform((ids) => [...new Set(ids)]);

export const KidControls = z.object({
    spendingLimitCents: SpendingLimit,
    allowedTemplates: AllowedTemplates,
    liveViewing: z.boolean(),
    discoverBrowsing: z.boolean(),
});
export type KidControls = z.infer<typeof KidControls>;

/** POST /api/family/kids. Controls default from the age band. Strict: no other field about a child is accepted. */
export const CreateKidProfileRequest = z
    .object({ nickname: KidNickname, ageBand: KidAgeBand, avatar: KidAvatar })
    .merge(KidControls.partial())
    .strict();
export type CreateKidProfileRequest = z.input<typeof CreateKidProfileRequest>;

/** PATCH /api/family/kids/:kidId */
export const UpdateKidProfileRequest = z
    .object({ nickname: KidNickname, ageBand: KidAgeBand, avatar: KidAvatar })
    .merge(KidControls)
    .partial()
    .strict();
export type UpdateKidProfileRequest = z.input<typeof UpdateKidProfileRequest>;

/** PUT /api/family/pin (signed-in grown-up; replaces any earlier PIN). */
export const SetPinRequest = z.object({ pin: GrownUpPin }).strict();

export const KidProfileView = z.object({
    id: KidProfileId,
    nickname: z.string(),
    ageBand: KidAgeBand,
    avatar: KidAvatar,
    spendingLimitCents: z.number().int(),
    allowedTemplates: z.array(KidTemplateId),
    liveViewing: z.boolean(),
    discoverBrowsing: z.boolean(),
    pendingRequests: z.number().int().nonnegative(),
    createdAt: IsoDateTime,
});
export type KidProfileView = z.infer<typeof KidProfileView>;

export const KID_REQUEST_STATUSES = ['pending', 'approved', 'declined'] as const;
export const KidRequestStatus = z.enum(KID_REQUEST_STATUSES);
export type KidRequestStatus = z.infer<typeof KidRequestStatus>;

/** What the kid sees on "My things" (from the request and the grown-up's real order). */
export const KID_STAGES = ['waiting', 'making', 'on_its_way', 'here', 'not_this_time', 'stopped'] as const;
export const KidStage = z.enum(KID_STAGES);
export type KidStage = z.infer<typeof KidStage>;

export const KID_STAGE_COPY: Record<KidStage, string> = {
    waiting: 'Waiting for a grown-up',
    making: 'Yes! It’s being made',
    on_its_way: 'On its way',
    here: 'Here!',
    not_this_time: 'Not this time',
    stopped: 'This one was stopped',
};

/** Order status -> kid stage (null: no paid order yet, the request decides). */
export function kidStageForOrder(status: OrderStatus | null): KidStage | null {
    switch (status) {
        case null:
        case 'PENDING_PAYMENT':
        case 'PAYMENT_FAILED':
            return null;
        case 'PAID':
        case 'DISPATCHED':
        case 'ACCEPTED':
        case 'IN_PRODUCTION':
        case 'QA_FAILED':
        case 'QA_PASSED':
            return 'making';
        case 'SHIPPED':
            return 'on_its_way';
        case 'DELIVERED':
        case 'COMPLETE':
            return 'here';
        case 'CANCELLED':
        case 'REFUNDED':
            return 'stopped';
    }
}

export function kidStageFor(request: { status: KidRequestStatus }, orderStatus: OrderStatus | null): KidStage {
    if (request.status === 'declined') return 'not_this_time';
    return kidStageForOrder(orderStatus) ?? 'waiting';
}

/** Kid-visible options of a design (the label is the kid's own words: shown only in the family). */
export const KidDesignOptions = z.object({
    label: z.string().optional(),
    color: KidColor,
    size: z.enum(['small', 'big']).optional(),
    angle: z.enum(['low', 'medium', 'tall']).optional(),
    shape: z.enum(['rounded', 'arrow', 'star']).optional(),
    cups: z.number().int().optional(),
});
export type KidDesignOptions = z.infer<typeof KidDesignOptions>;

export const FamilyRequestView = z.object({
    id: KidRequestId,
    kidId: KidProfileId,
    kidNickname: z.string(),
    kidAvatar: KidAvatar,
    template: KidTemplateId,
    templateTitle: z.string(),
    options: KidDesignOptions,
    priceCents: z.number().int(),
    currency: z.string(),
    quoteId: z.string(),
    status: KidRequestStatus,
    note: z.string().nullable(),
    stage: KidStage,
    order: z.object({ orderId: z.string(), orderNumber: z.string(), status: OrderStatus }).nullable(),
    /** Signed GLB link for the 3D preview when the workshop made one. */
    glbUrl: z.string().nullable(),
    createdAt: IsoDateTime,
    decidedAt: IsoDateTime.nullable(),
});
export type FamilyRequestView = z.infer<typeof FamilyRequestView>;

export const FAMILY_ACTIVITY_KINDS = ['kid_added', 'kid_updated', 'kid_removed', 'pin_set', 'kids_mode_started', 'kids_mode_ended', 'request_created', 'request_approved', 'request_declined'] as const;
export const FamilyActivityKind = z.enum(FAMILY_ACTIVITY_KINDS);
export type FamilyActivityKind = z.infer<typeof FamilyActivityKind>;

export const FamilyActivityView = z.object({ id: z.string(), kind: FamilyActivityKind, summary: z.string(), createdAt: IsoDateTime });
export type FamilyActivityView = z.infer<typeof FamilyActivityView>;

/** GET /api/family */
export const FamilyView = z.object({
    pinSet: z.boolean(),
    maxKids: z.number().int(),
    kids: z.array(KidProfileView),
    requests: z.array(FamilyRequestView),
    activity: z.array(FamilyActivityView),
    primeMember: z.boolean(),
    /** Prime free standard shipping applies from this order subtotal (the member's own rule). */
    freeShippingThresholdCents: z.number().int(),
});
export type FamilyView = z.infer<typeof FamilyView>;

/** POST /api/family/requests/:id/decline */
export const DeclineKidRequest = z.object({ note: z.string().trim().max(140).optional() }).strict();
/** POST /api/family/requests/:id/approve -> the grown-up's normal checkout. */
export const ApproveKidRequestResponse = z.object({ checkoutUrl: z.string() });

// ---------------------------------------------------------------------------
// Kids mode (the kid's side)
// ---------------------------------------------------------------------------

export const KidTemplateCard = z.object({ id: KidTemplateId, title: z.string(), blurb: z.string() });

/** GET /api/kids/me */
export const KidHomeView = z.object({
    kid: z.object({ nickname: z.string(), avatar: KidAvatar }),
    templates: z.array(KidTemplateCard),
    canDiscover: z.boolean(),
    canWatchLive: z.boolean(),
    spendingLimitCents: z.number().int(),
});
export type KidHomeView = z.infer<typeof KidHomeView>;

/** POST /api/kids/designs: one template and its bounded options (no free text but the label). */
export const CreateKidDesignRequest = z.object({ template: KidTemplateId, params: z.record(z.unknown()) }).strict();

export const KID_DESIGN_STATUSES = ['new', 'offline', 'failed', 'priced', 'unpriceable'] as const;
export const KidDesignStatus = z.enum(KID_DESIGN_STATUSES);
export type KidDesignStatus = z.infer<typeof KidDesignStatus>;

export const KidDesignView = z.object({
    id: KidDesignId,
    template: KidTemplateId,
    templateTitle: z.string(),
    options: KidDesignOptions,
    status: KidDesignStatus,
    /** Only when priced (a BINDING print quote): never an estimate. */
    priceCents: z.number().int().nullable(),
    currency: z.string(),
    limitCents: z.number().int(),
    withinLimit: z.boolean(),
    glbUrl: z.string().nullable(),
    /** Kid words for what happened (offline workshop, too big, ...). */
    message: z.string().nullable(),
    requestId: KidRequestId.nullable(),
});
export type KidDesignView = z.infer<typeof KidDesignView>;

/** POST /api/kids/requests */
export const CreateKidAskRequest = z.object({ designId: KidDesignId }).strict();

export const KidThingView = z.object({
    id: KidRequestId,
    template: KidTemplateId,
    templateTitle: z.string(),
    options: KidDesignOptions,
    priceCents: z.number().int(),
    stage: KidStage,
    stageText: z.string(),
    note: z.string().nullable(),
    createdAt: IsoDateTime,
});
export type KidThingView = z.infer<typeof KidThingView>;

/** GET /api/kids/things */
export const KidThingsView = z.object({ items: z.array(KidThingView) });
export type KidThingsView = z.infer<typeof KidThingsView>;

/** POST /api/kids/exit */
export const ExitKidsModeRequest = z.object({ pin: GrownUpPin }).strict();

/** Kid-visible options of a parsed template params object. */
export function kidDesignOptions(template: KidTemplateId, params: Record<string, unknown>): KidDesignOptions {
    const p = params as Partial<KidTemplateParams<'name_keychain'> & KidTemplateParams<'phone_stand'> & KidTemplateParams<'bookmark'> & KidTemplateParams<'desk_tidy'>>;
    const out: KidDesignOptions = { color: (KID_COLORS as readonly string[]).includes(String(p.color)) ? (p.color as KidColor) : 'blue' };
    if (typeof p.label === 'string' && KidLabel.safeParse(p.label).success) out.label = p.label.trim();
    if (template === 'name_keychain' && p.size) out.size = p.size;
    if (template === 'phone_stand' && p.angle) out.angle = p.angle;
    if (template === 'bookmark' && p.shape) out.shape = p.shape;
    if (template === 'desk_tidy' && typeof p.cups === 'number') out.cups = p.cups;
    return out;
}

/** Kid words for a price: "$12.40". */
export function kidPrice(cents: number): string {
    return `$${(cents / 100).toFixed(2)}`;
}
