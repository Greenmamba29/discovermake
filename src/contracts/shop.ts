/**
 * Shop Console contracts (auth: httpOnly `dm_shop_session` cookie, see ADR-0008).
 *
 * POST   /api/shop/session                    ShopLoginRequest       -> ShopSessionResponse (sets cookie)
 * GET    /api/shop/session                                           -> ShopSessionResponse
 * DELETE /api/shop/session                                           -> OkResponse (clears cookie)
 * GET    /api/shop/jobs?status=OFFERED,ACCEPTED                      -> ShopJobListResponse
 * GET    /api/shop/jobs/:jobId                                       -> ShopJobDetail
 * POST   /api/shop/jobs/:jobId/accept                                -> ShopJobDetail
 * POST   /api/shop/jobs/:jobId/decline        DeclineJobRequest      -> ShopJobDetail
 * POST   /api/shop/jobs/:jobId/milestones     MilestoneRequest       -> MilestoneView (201)
 * POST   /api/shop/jobs/:jobId/uploads        QaUploadRequest        -> QaUploadResponse (201)
 * POST   /api/shop/jobs/:jobId/inspection     InspectionSubmitRequest -> InspectionResultView (201)
 * POST   /api/shop/jobs/:jobId/shipment       CreateShipmentRequest  -> ShipmentView (201)   (see shipments.ts)
 */
import { z } from 'zod';
import {
    CarrierProviderName,
    DeclineReason,
    InspectionCheckKind,
    InspectionOutcome,
    JobStatus,
    MilestoneKind,
} from './enums';
import { Address, Cents, IsoDate, IsoDateTime, JobId, ShopId } from './common';
import { PartPreview } from './parts';
import { ShipmentView } from './shipments';

export const SHOP_SESSION_COOKIE = 'dm_shop_session';

export const ShopLoginRequest = z.object({
    /** One-time-displayed console token (`dmshop_...`). Only its sha256 is stored. */
    token: z.string().trim().min(20).max(200),
});
export type ShopLoginRequest = z.infer<typeof ShopLoginRequest>;

export const ShopPrincipal = z.object({
    shopId: ShopId,
    name: z.string(),
    city: z.string(),
    region: z.string(),
});
export type ShopPrincipal = z.infer<typeof ShopPrincipal>;

export const ShopSessionResponse = z.object({
    shop: ShopPrincipal,
    expiresAt: IsoDateTime,
    /**
     * Carrier adapter configured on the server: `easypost` = DiscoverMake buys the label;
     * `manual` = the shop enters carrier + tracking (test double, never in production).
     */
    shippingMode: CarrierProviderName,
});
export type ShopSessionResponse = z.infer<typeof ShopSessionResponse>;

export const SHOP_NEXT_ACTIONS = [
    'ACCEPT_OR_DECLINE',
    'RECORD_MILESTONE',
    'SUBMIT_INSPECTION',
    'CREATE_SHIPMENT',
    'NONE',
] as const;
export const ShopNextAction = z.enum(SHOP_NEXT_ACTIONS);
export type ShopNextAction = z.infer<typeof ShopNextAction>;

export const ShopJobSummary = z.object({
    id: JobId,
    orderId: z.string(),
    orderNumber: z.string(),
    buildDisplayId: z.string(),
    status: JobStatus,
    isRework: z.boolean(),
    partFilename: z.string(),
    materialName: z.string(),
    thicknessLabel: z.string(),
    finishName: z.string().nullable(),
    quantity: z.number().int().positive(),
    shipBy: IsoDate,
    /** Only while OFFERED. */
    offerExpiresAt: IsoDateTime.nullable(),
    /** What the shop is paid for this job (shop cost from the quote snapshot). */
    payoutCents: Cents,
    nextAction: ShopNextAction,
    createdAt: IsoDateTime,
});
export type ShopJobSummary = z.infer<typeof ShopJobSummary>;

export const ShopJobListResponse = z.object({
    jobs: z.array(ShopJobSummary),
});
export type ShopJobListResponse = z.infer<typeof ShopJobListResponse>;

export const InspectionCheck = z.object({
    id: z.string(), // stable within a plan, e.g. "chk_bbox_w"
    kind: InspectionCheckKind,
    label: z.string(),
    nominalMm: z.number().nullable(),
    tolPlusMm: z.number().nonnegative().nullable(),
    tolMinusMm: z.number().nonnegative().nullable(),
    critical: z.boolean(),
    instructions: z.string(),
});
export type InspectionCheck = z.infer<typeof InspectionCheck>;

export const InspectionPlanView = z.object({
    id: z.string(),
    jobId: JobId,
    checks: z.array(InspectionCheck).min(1),
    /** Sample size per lot (R1: min(qty, 3) first-article + every 25th). */
    sampleSize: z.number().int().positive(),
    createdAt: IsoDateTime,
});
export type InspectionPlanView = z.infer<typeof InspectionPlanView>;

/**
 * Signed job packet (stored as `manufacturing_jobs.packet`; `signature` is
 * HMAC-SHA256(JOB_PACKET_SIGNING_SECRET, canonical JSON of the packet without `signature`)).
 * Before acceptance the console receives a REDACTED packet: `files` = [] and `shipTo` = null.
 */
export const JobPacket = z.object({
    packetVersion: z.literal(1),
    jobId: JobId,
    orderNumber: z.string(),
    buildDisplayId: z.string(),
    quoteId: z.string(),
    designVersion: z.number().int().positive(),
    part: z.object({
        filename: z.string(),
        bboxWidthMm: z.number(),
        bboxHeightMm: z.number(),
        cutLengthMm: z.number(),
        pierceCount: z.number().int(),
        holeCount: z.number().int(),
        bendCount: z.number().int(),
        /** sha256 of the exact DXF bytes the quote was priced on (verify the download against it). */
        fileSha256: z.string().nullable(),
        /** Flat pattern as SVG path data (evenodd), covered by the packet signature. */
        flatPatternSvgPath: z.string().nullable(),
    }),
    material: z.object({
        id: z.string(),
        name: z.string(),
        thicknessOptionId: z.string(),
        thicknessMm: z.number(),
        thicknessLabel: z.string(),
    }),
    process: z.object({ id: z.string(), name: z.string() }),
    finish: z.object({ id: z.string(), name: z.string(), colorName: z.string().nullable() }).nullable(),
    services: z.array(
        z.object({
            id: z.string(),
            name: z.string(),
            featureCount: z.number().int().nullable(),
            options: z.record(z.string()),
        }),
    ),
    quantity: z.number().int().positive(),
    qaNotes: z.array(z.string()),
    packing: z.object({
        instructions: z.string(),
        shippingMethod: z.string(),
    }),
    buyerNotes: z.string().nullable(),
    shipBy: IsoDate,
    shipTo: Address.nullable(),
    files: z.array(
        z.object({
            kind: z.enum(['SOURCE_DXF']),
            filename: z.string(),
            /** Signed, expiring download URL (generated per request, never stored). */
            url: z.string().url(),
            expiresAt: IsoDateTime,
        }),
    ),
    issuedAt: IsoDateTime,
    signature: z.string(),
});
export type JobPacket = z.infer<typeof JobPacket>;

export const DeclineJobRequest = z.object({
    reason: DeclineReason,
    note: z.string().trim().max(500).optional(),
});
export type DeclineJobRequest = z.infer<typeof DeclineJobRequest>;

export const MilestoneRequest = z.object({
    kind: MilestoneKind,
    note: z.string().trim().max(500).optional(),
    /** Storage keys returned by POST /api/shop/jobs/:jobId/uploads. */
    photoKeys: z.array(z.string().max(300)).max(10).optional(),
});
export type MilestoneRequest = z.infer<typeof MilestoneRequest>;

export const MilestoneView = z.object({
    id: z.string(),
    jobId: JobId,
    kind: MilestoneKind,
    label: z.string(), // "Cutting"
    note: z.string().nullable(),
    occurredAt: IsoDateTime,
});
export type MilestoneView = z.infer<typeof MilestoneView>;

export const QaUploadRequest = z.object({
    filename: z.string().trim().min(1).max(255),
    contentType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
    sizeBytes: z.number().int().positive().max(15 * 1024 * 1024),
});
export type QaUploadRequest = z.infer<typeof QaUploadRequest>;

export const QaUploadResponse = z.object({
    key: z.string(),
    upload: z.object({
        url: z.string().url(),
        method: z.literal('PUT'),
        headers: z.record(z.string()),
        expiresAt: IsoDateTime,
    }),
});
export type QaUploadResponse = z.infer<typeof QaUploadResponse>;

export const InspectionMeasurement = z.object({
    checkId: z.string(),
    /** Required for DIMENSION / HOLE_DIAMETER / FLATNESS / BEND_ANGLE checks. */
    measuredValue: z.number().optional(),
    /** Shop's own pass/fail for VISUAL / FINISH / COUNT; recomputed server-side for measured checks. */
    pass: z.boolean(),
    note: z.string().trim().max(300).optional(),
});
export type InspectionMeasurement = z.infer<typeof InspectionMeasurement>;

/**
 * The shop does NOT choose the outcome: the server computes PASS only if every
 * check in the plan has a measurement and every critical check passes
 * (measured checks are re-evaluated against nominal ± tolerance).
 */
export const InspectionSubmitRequest = z.object({
    measurements: z.array(InspectionMeasurement).min(1).max(100),
    photoKeys: z.array(z.string().max(300)).min(1).max(10),
    inspectorName: z.string().trim().min(1).max(120),
    notes: z.string().trim().max(1000).optional(),
});
export type InspectionSubmitRequest = z.infer<typeof InspectionSubmitRequest>;

export const InspectionResultView = z.object({
    id: z.string(),
    planId: z.string(),
    jobId: JobId,
    outcome: InspectionOutcome,
    measurements: z.array(InspectionMeasurement),
    photoCount: z.number().int().nonnegative(),
    inspectorName: z.string(),
    notes: z.string().nullable(),
    /** Set when outcome = FAIL: the automatically opened rework job. */
    reworkJobId: z.string().nullable(),
    createdAt: IsoDateTime,
});
export type InspectionResultView = z.infer<typeof InspectionResultView>;

export const ShopJobDetail = ShopJobSummary.extend({
    packet: JobPacket,
    preview: PartPreview.nullable(),
    milestones: z.array(MilestoneView),
    inspectionPlan: InspectionPlanView.nullable(),
    inspectionResults: z.array(InspectionResultView),
    shipment: ShipmentView.nullable(),
    declineReason: DeclineReason.nullable(),
    acceptedAt: IsoDateTime.nullable(),
});
export type ShopJobDetail = z.infer<typeof ShopJobDetail>;
