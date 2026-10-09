/**
 * Build Workspace contracts (R2 Stage 1): attachment tray (100-1), the Ask Make AI panel
 * (300-3) and the replacement-part quote from a Product Passport (1000-3).
 *
 * Attachments (signed upload, verified server-side):
 *   GET    /api/builds/:buildId/attachments                          -> BuildAttachmentList
 *   POST   /api/builds/:buildId/attachments  CreateAttachmentRequest -> CreateAttachmentResponse (201)
 *          (client PUTs the bytes to `upload.url` with exactly `upload.headers`)
 *   POST   /api/builds/:buildId/attachments/:attachmentId/complete   -> BuildAttachmentView (size + magic bytes + sha256)
 *   DELETE /api/builds/:buildId/attachments/:attachmentId            -> { ok: true }
 *   POST   /api/builds/:buildId/attachments/:attachmentId/use-as-part -> UseAttachmentAsPartResponse (DXF only)
 *
 * Ask Make AI (scoped to the build's latest design version):
 *   GET  /api/builds/:buildId/assistant                    -> AssistantStatus
 *   POST /api/builds/:buildId/assistant  { action: 'ask' } -> AssistantAskResponse
 *   POST /api/builds/:buildId/assistant  { action: 'confirm' | 'add_requirement' } -> BuildGraphView (201, a NEW version)
 *
 * Replacement part:
 *   POST /api/passport/:passportId/replacement  ReplacementRequest -> ReplacementResponse (201)
 *
 * Make AI never mutates the graph: a change request comes back as a proposal (an answer to an
 * open question, or a new requirement) that only the buyer's confirmation writes, and a
 * proposal may only carry numbers the buyer typed (workflow 01 rule 1).
 */
import { z } from 'zod';
import { BuildAttachmentId, BuildId, IsoDateTime, PartId, QuoteId } from './common';
import { BgNodeKey } from './build-graph';
import { RequirementCategory } from './make-ai';

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export const ATTACHMENT_KINDS = ['image', 'cad'] as const;
export const AttachmentKind = z.enum(ATTACHMENT_KINDS);
export type AttachmentKind = z.infer<typeof AttachmentKind>;

export const MAX_IMAGE_ATTACHMENT_BYTES = 15 * 1024 * 1024;
export const MAX_CAD_ATTACHMENT_BYTES = 50 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_BUILD = 40;
export const MAX_ATTACHMENT_FILENAME_CHARS = 200;

export type AttachmentFormat = {
    kind: AttachmentKind;
    /** Content types a client may declare for this extension (browsers often send octet-stream for CAD). */
    contentTypes: readonly string[];
    label: string;
};

/** The only accepted extensions, with their kind and accepted content types. */
export const ATTACHMENT_FORMATS: Record<string, AttachmentFormat> = {
    png: { kind: 'image', contentTypes: ['image/png'], label: 'PNG image' },
    jpg: { kind: 'image', contentTypes: ['image/jpeg'], label: 'JPEG image' },
    jpeg: { kind: 'image', contentTypes: ['image/jpeg'], label: 'JPEG image' },
    webp: { kind: 'image', contentTypes: ['image/webp'], label: 'WebP image' },
    heic: { kind: 'image', contentTypes: ['image/heic', 'image/heif'], label: 'HEIC photo' },
    dxf: { kind: 'cad', contentTypes: ['application/dxf', 'image/vnd.dxf', 'image/x-dxf', 'application/x-dxf', 'application/octet-stream'], label: 'DXF drawing' },
    step: { kind: 'cad', contentTypes: ['application/step', 'model/step', 'application/x-step', 'application/octet-stream'], label: 'STEP model' },
    stp: { kind: 'cad', contentTypes: ['application/step', 'model/step', 'application/x-step', 'application/octet-stream'], label: 'STEP model' },
    stl: { kind: 'cad', contentTypes: ['model/stl', 'application/sla', 'application/vnd.ms-pki.stl', 'application/octet-stream'], label: 'STL mesh' },
    svg: { kind: 'cad', contentTypes: ['image/svg+xml'], label: 'SVG drawing' },
};

export const ATTACHMENT_EXTENSIONS = Object.keys(ATTACHMENT_FORMATS);
/** `accept` attribute for the tray's file input. */
export const ATTACHMENT_ACCEPT = ATTACHMENT_EXTENSIONS.map((e) => `.${e}`).join(',');

export function attachmentExtension(filename: string): string {
    const m = /\.([A-Za-z0-9]+)\s*$/.exec(filename);
    return m ? m[1]!.toLowerCase() : '';
}

export function maxBytesFor(kind: AttachmentKind): number {
    return kind === 'image' ? MAX_IMAGE_ATTACHMENT_BYTES : MAX_CAD_ATTACHMENT_BYTES;
}

/** The content type a browser should declare when File.type is empty. */
export function defaultContentType(ext: string): string | null {
    return ATTACHMENT_FORMATS[ext]?.contentTypes[0] ?? null;
}

export const CreateAttachmentRequest = z.object({
    filename: z.string().trim().min(1).max(MAX_ATTACHMENT_FILENAME_CHARS),
    contentType: z.string().trim().toLowerCase().min(1).max(100),
    sizeBytes: z.number().int().positive().max(MAX_CAD_ATTACHMENT_BYTES),
});
export type CreateAttachmentRequest = z.infer<typeof CreateAttachmentRequest>;

export const AttachmentStatus = z.enum(['pending', 'ready']);
export type AttachmentStatus = z.infer<typeof AttachmentStatus>;

export const BuildAttachmentView = z.object({
    id: BuildAttachmentId,
    buildId: BuildId,
    designVersion: z.number().int().positive(),
    kind: AttachmentKind,
    filename: z.string(),
    contentType: z.string(),
    sizeBytes: z.number().int().nonnegative(),
    /** null until the upload is verified (size + magic bytes). */
    sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
    status: AttachmentStatus,
    /** Signed, expiring download URL (ready attachments only). */
    url: z.string().url().nullable(),
    /** Signed inline URL for a thumbnail (png/jpg/webp only; HEIC and CAD show an icon). */
    thumbnailUrl: z.string().url().nullable(),
    /** A DXF that can run through the instant-quote flow. */
    usableAsPart: z.boolean(),
    /** Set once "Use as a part" ran. */
    partId: PartId.nullable(),
    createdAt: IsoDateTime,
});
export type BuildAttachmentView = z.infer<typeof BuildAttachmentView>;

export const BuildAttachmentList = z.object({
    attachments: z.array(BuildAttachmentView),
    limits: z.object({ imageBytes: z.number().int(), cadBytes: z.number().int(), perBuild: z.number().int() }),
});
export type BuildAttachmentList = z.infer<typeof BuildAttachmentList>;

export const CreateAttachmentResponse = z.object({
    attachment: BuildAttachmentView,
    upload: z.object({
        url: z.string().url(),
        method: z.literal('PUT'),
        headers: z.record(z.string()),
        key: z.string(),
        expiresAt: IsoDateTime,
        maxBytes: z.number().int().positive(),
    }),
});
export type CreateAttachmentResponse = z.infer<typeof CreateAttachmentResponse>;

export const UseAttachmentAsPartResponse = z.object({
    partId: PartId,
    /** Part status after analysis (READY parts go straight to the configurator). */
    status: z.string(),
    url: z.string(),
});
export type UseAttachmentAsPartResponse = z.infer<typeof UseAttachmentAsPartResponse>;

// ---------------------------------------------------------------------------
// Ask Make AI
// ---------------------------------------------------------------------------

export const ASSISTANT_MAX_MESSAGE_CHARS = 1000;
export const ASSISTANT_MAX_BODY_BYTES = 16 * 1024;

export const AssistantStatus = z.object({
    available: z.boolean(),
    /** Plain-language reason when unavailable. */
    reason: z.string().nullable(),
    /** The latest design version the panel is scoped to. */
    version: z.number().int().positive(),
});
export type AssistantStatus = z.infer<typeof AssistantStatus>;

export const AssistantProposal = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('answer_question'), unknownKey: BgNodeKey, question: z.string().max(300), value: z.string().trim().min(1).max(200) }),
    z.object({ kind: z.literal('add_requirement'), text: z.string().trim().min(3).max(300), category: RequirementCategory }),
]);
export type AssistantProposal = z.infer<typeof AssistantProposal>;

export const AssistantAskRequest = z.object({
    action: z.literal('ask'),
    message: z.string().trim().min(2, 'Ask a question or describe a change.').max(ASSISTANT_MAX_MESSAGE_CHARS, `Keep it under ${ASSISTANT_MAX_MESSAGE_CHARS} characters.`),
});

export const AssistantConfirmRequest = z.object({
    action: z.literal('confirm'),
    /** The version the proposal was made against; must still be the latest (409 otherwise). */
    basedOnVersion: z.number().int().positive(),
    proposal: AssistantProposal,
});

export const AssistantAddRequirementRequest = z.object({
    action: z.literal('add_requirement'),
    basedOnVersion: z.number().int().positive(),
    text: z.string().trim().min(3, 'Describe the requirement.').max(300, 'Keep it under 300 characters.'),
    category: RequirementCategory.default('other'),
});

export const AssistantRequest = z.discriminatedUnion('action', [AssistantAskRequest, AssistantConfirmRequest, AssistantAddRequirementRequest]);
export type AssistantRequest = z.input<typeof AssistantRequest>;

export const AssistantAskResponse = z.discriminatedUnion('status', [
    z.object({
        status: z.literal('answered'),
        version: z.number().int().positive(),
        answer: z.string(),
        /** A change for the buyer to confirm; null for plain questions or when a guard dropped it. */
        proposal: AssistantProposal.nullable(),
        /** Why a proposal was dropped (e.g. it carried a number the buyer never gave). */
        guardNote: z.string().nullable(),
        /** Graph nodes the answer is grounded on. */
        citedKeys: z.array(z.string()),
        model: z.string(),
        estimateOnly: z.literal(true),
    }),
    z.object({ status: z.literal('unavailable'), version: z.number().int().positive(), reason: z.string() }),
]);
export type AssistantAskResponse = z.infer<typeof AssistantAskResponse>;

// ---------------------------------------------------------------------------
// Replacement part from a Product Passport
// ---------------------------------------------------------------------------

export const ReplacementRequest = z.object({ quantity: z.number().int().min(1).max(100).default(1) });
export type ReplacementRequest = z.input<typeof ReplacementRequest>;

export const ReplacementResponse = z.object({
    quoteId: QuoteId,
    partId: PartId,
    /** Where to send the buyer: the configurator, prefilled from the replacement quote. */
    url: z.string(),
    status: z.string(),
    trustLevel: z.string(),
});
export type ReplacementResponse = z.infer<typeof ReplacementResponse>;
