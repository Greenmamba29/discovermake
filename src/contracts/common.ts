/**
 * Shared primitives for every R1 API contract.
 *
 * Wire conventions:
 * - JSON keys are camelCase.
 * - Money is ALWAYS integer cents (`Cents`) plus an ISO-4217 lowercase `currency` (R1: "usd").
 *   Clients never send amounts; they send ids and the server prices.
 * - Lengths are millimetres (`_mm` / `Mm` suffix) after unit normalization.
 * - Timestamps are ISO-8601 strings with offset (`IsoDateTime`); calendar dates are `YYYY-MM-DD` (`IsoDate`).
 */
import { z } from 'zod';
import { ActorKind } from './enums';

/** Readable prefixed ids. Keep in sync with `ID_PREFIXES` in `src/server/ids.ts`. */
export const ID_PREFIX = {
    build: 'bld',
    part: 'prt',
    material: 'mat',
    thickness: 'thk',
    process: 'prc',
    service: 'svc',
    shop: 'shop',
    capability: 'cap',
    shopService: 'ssv',
    rateCard: 'rc',
    shopToken: 'stk',
    shopSession: 'sss',
    quote: 'qte',
    order: 'ord',
    orderStatus: 'osh',
    payment: 'pay',
    job: 'job',
    milestone: 'mst',
    inspectionPlan: 'ipl',
    inspectionResult: 'irs',
    shipment: 'shp',
    passport: 'pps',
    ledger: 'led',
    payout: 'pout',
    webhook: 'whk',
    designVersion: 'dv',
    bgNode: 'bgn',
    bgEdge: 'bge',
    makeIntent: 'mki',
    sourcingJob: 'src',
    supplier: 'sup',
    supplierEvidence: 'sev',
    supplierOffer: 'off',
    negotiation: 'neg',
    sourcingDocument: 'sdoc',
    approval: 'apr',
    sourcingClient: 'scl',
    sourcingAudit: 'sau',
    user: 'usr',
    userSession: 'uss',
    authChallenge: 'ach',
    oauthAccount: 'oac',
    buildAttachment: 'att',
    channel: 'chn',
    show: 'shw',
    drop: 'drp',
    slotClaim: 'slc',
    liveEvent: 'lev',
    liveQuestion: 'lvq',
    livePoll: 'lpl',
    // R3 Prime
    supplierLeg: 'leg',
    promiseObservation: 'pob',
    promiseModel: 'pmd',
    buyerCredit: 'crd',
    shopStock: 'sst',
    jobBatch: 'bat',
    // R5 Media
    clip: 'clp',
    auction: 'auc',
    auctionBid: 'bid',
    creatorEarning: 'cre',
    creatorPayout: 'cpo',
    feedEvent: 'fev',
    dropQueueEntry: 'dqe',
} as const;
export type IdKind = keyof typeof ID_PREFIX;

/** zod schema for an id with the given prefix, e.g. `idOf('part')` accepts `prt_8f3k...`. */
export function idOf(kind: IdKind) {
    const prefix = ID_PREFIX[kind];
    return z
        .string()
        .min(prefix.length + 2)
        .max(64)
        .regex(new RegExp(`^${prefix}_[A-Za-z0-9_-]+$`), `expected a ${prefix}_ id`);
}

export const BuildId = idOf('build');
export const PartId = idOf('part');
export const MaterialId = idOf('material');
export const ThicknessOptionId = idOf('thickness');
export const ProcessId = idOf('process');
export const ServiceId = idOf('service');
export const ShopId = idOf('shop');
export const QuoteId = idOf('quote');
export const OrderId = idOf('order');
export const JobId = idOf('job');
export const ShipmentId = idOf('shipment');
export const PassportId = idOf('passport');
export const DesignVersionId = idOf('designVersion');
export const BgNodeId = idOf('bgNode');
export const UserId = idOf('user');
export const BuildAttachmentId = idOf('buildAttachment');
export const BgEdgeId = idOf('bgEdge');
export const SourcingJobId = idOf('sourcingJob');
export const SupplierId = idOf('supplier');
export const SupplierOfferId = idOf('supplierOffer');
export const ApprovalId = idOf('approval');

/** Human display id for a Build, e.g. `DM-7K3QX`. Display only: never an access credential. */
export const BuildDisplayId = z.string().regex(/^DM-[0-9A-Z]{5,8}$/);

/** Integer cents, never negative on the wire. */
export const Cents = z.number().int().nonnegative();
export type Cents = z.infer<typeof Cents>;

export const Currency = z.string().length(3).toLowerCase().default('usd');

export const IsoDateTime = z.string().datetime({ offset: true });
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const Email = z.string().trim().toLowerCase().email().max(254);

/** Postal address. R1 ships to US addresses only (country "US"). */
export const Address = z.object({
    name: z.string().trim().min(1).max(120),
    company: z.string().trim().max(120).optional(),
    line1: z.string().trim().min(1).max(200),
    line2: z.string().trim().max(200).optional(),
    city: z.string().trim().min(1).max(100),
    region: z.string().trim().length(2).toUpperCase(), // US state code
    postalCode: z.string().trim().regex(/^\d{5}(-\d{4})?$/, 'expected a US ZIP code'),
    country: z.literal('US'),
    phone: z.string().trim().max(32).optional(),
});
export type Address = z.infer<typeof Address>;

/** Who caused a state change. Serialized to `actor_id` as `${kind}:${id}` (see `actorId()`). */
export const Actor = z.object({
    kind: ActorKind,
    id: z.string().min(1).max(128),
});
export type Actor = z.infer<typeof Actor>;

export function actorId(actor: Actor): string {
    return `${actor.kind}:${actor.id}`;
}

export const SYSTEM_ACTOR: Actor = { kind: 'system', id: 'discovermake' };

/**
 * A pre-signed upload target. The client sends the file bytes with exactly
 * `method` + `headers` to `url`. Works for both S3 presigned PUTs and the local
 * driver (`/api/storage/local/...`).
 */
export const SignedUpload = z.object({
    url: z.string().url(),
    method: z.literal('PUT'),
    headers: z.record(z.string()),
    key: z.string(),
    expiresAt: IsoDateTime,
    maxBytes: z.number().int().positive(),
});
export type SignedUpload = z.infer<typeof SignedUpload>;

/** Error body returned by every API route on non-2xx responses. */
export const API_ERROR_CODES = [
    'BAD_REQUEST',
    'VALIDATION_FAILED',
    'UNAUTHORIZED',
    'FORBIDDEN',
    'NOT_FOUND',
    'CONFLICT', // e.g. illegal state transition, quote no longer orderable
    'PAYLOAD_TOO_LARGE',
    'UNSUPPORTED_MEDIA_TYPE',
    'RATE_LIMITED',
    'PAYMENT_ERROR',
    'NOT_IMPLEMENTED',
    'INTERNAL',
] as const;
export const ApiErrorCode = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

export const ApiErrorBody = z.object({
    error: z.object({
        code: ApiErrorCode,
        message: z.string(),
        details: z.unknown().optional(),
    }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

export const OkResponse = z.object({ ok: z.literal(true) });
export type OkResponse = z.infer<typeof OkResponse>;

/** Point in part space (mm). */
export const Point2 = z.tuple([z.number(), z.number()]);
export type Point2 = z.infer<typeof Point2>;
