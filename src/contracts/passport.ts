/**
 * Product Passport contracts (public, no auth; contains NO buyer PII).
 *
 * GET /api/passport/:passportId          -> PassportPublicView
 * GET /api/passport/:passportId/verify   -> PassportVerifyResponse
 *
 * Signing: `snapshot_hash` = sha256(canonical JSON of PassportSnapshot);
 * `signature` = HMAC-SHA256(PASSPORT_SIGNING_SECRET, snapshot_hash), hex.
 * Verification recomputes both from the stored snapshot.
 */
import { z } from 'zod';
import { InspectionOutcome, PassportStatus } from './enums';
import { BuildDisplayId, IsoDate, IsoDateTime, PassportId } from './common';

/** Stored verbatim in `passports.snapshot`. Every field comes from real order records. */
export const PassportSnapshot = z.object({
    snapshotVersion: z.literal(1),
    passportId: PassportId,
    orderNumber: z.string(),
    build: z.object({ id: z.string(), displayId: BuildDisplayId, name: z.string() }),
    designVersion: z.number().int().positive(),
    quoteId: z.string(),
    part: z.object({
        filename: z.string(),
        fileSha256: z.string(),
        bboxWidthMm: z.number(),
        bboxHeightMm: z.number(),
    }),
    material: z.object({ name: z.string(), thicknessLabel: z.string(), thicknessMm: z.number() }),
    process: z.string(),
    finish: z.string().nullable(),
    services: z.array(z.string()),
    quantity: z.number().int().positive(),
    shop: z.object({ id: z.string(), name: z.string(), city: z.string(), region: z.string() }),
    manufacturedAt: IsoDateTime, // first IN_PRODUCTION milestone
    milestones: z.array(z.object({ kind: z.string(), at: IsoDateTime })),
    qa: z.object({
        resultId: z.string(),
        outcome: InspectionOutcome,
        inspectedAt: IsoDateTime,
        inspectorName: z.string(),
        checks: z.array(
            z.object({
                label: z.string(),
                nominalMm: z.number().nullable(),
                measuredValue: z.number().nullable(),
                pass: z.boolean(),
            }),
        ),
    }),
    shipment: z.object({ carrier: z.string(), trackingNumber: z.string(), deliveredAt: IsoDateTime }),
    /** Lot id for traceability, e.g. "<orderNumber>-L1". */
    lot: z.string(),
    rulesetVersion: z.string(),
});
export type PassportSnapshot = z.infer<typeof PassportSnapshot>;

export const PassportPublicView = z.object({
    id: PassportId,
    status: PassportStatus,
    activatedAt: IsoDateTime.nullable(),
    /** Result of re-verifying hash + signature at read time. */
    verified: z.boolean(),
    snapshotHash: z.string(),
    signatureAlg: z.literal('HMAC-SHA256'),
    /** Public URL of /passport/:id (encode this in the packaging QR code). */
    verifyUrl: z.string().url(),
    snapshot: PassportSnapshot,
    manufacturedOn: IsoDate,
});
export type PassportPublicView = z.infer<typeof PassportPublicView>;

/** GET /api/passport/:id response: the public view plus a QR code (PNG data URL) of `verifyUrl`. */
export const PassportPublicResponse = PassportPublicView.extend({
    qrCodeDataUrl: z.string().startsWith('data:image/png;base64,'),
});
export type PassportPublicResponse = z.infer<typeof PassportPublicResponse>;

export const PassportVerifyResponse = z.object({
    id: PassportId,
    valid: z.boolean(),
    status: PassportStatus,
    snapshotHash: z.string(),
    computedHash: z.string(),
    signatureValid: z.boolean(),
    activatedAt: IsoDateTime.nullable(),
});
export type PassportVerifyResponse = z.infer<typeof PassportVerifyResponse>;
