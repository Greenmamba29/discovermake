/**
 * Make AI "Make it in 3D" (text to CAD for adult buyers): the web API around the worker contract
 * in ./text-to-cad.ts.
 *
 *   GET  /api/text-to-cad                          -> MakeIt3dAvailability (entry on /make/ai)
 *   POST /api/text-to-cad                 {prompt} -> CreateMakeIt3dBuildResponse (a new build to make it in)
 *   GET  /api/builds/:buildId/text-to-cad          -> MakeIt3dStatus
 *   POST /api/builds/:buildId/text-to-cad {prompt} -> MakeIt3dResponse (a NEW DRAFT design version)
 *   POST /api/builds/:buildId/text-to-cad/quote    -> QuoteView (BINDING print quote once approved)
 *
 * Make AI writes a cadgen script for the buyer's words; the CAD worker gates and builds it in a
 * sandbox. The result is a DRAFT version: the buyer approves it before any quote. Kids never
 * reach this path (they use templates, and nothing they type goes to Make AI).
 */
import { z } from 'zod';
import { MAKE_AI_MAX_INPUT_CHARS } from './make-ai';
import { PrintMaterialOption } from './reconstruct';
import { TextToCadErrorCode, TextToCadGeometry } from './text-to-cad';

export const MakeIt3dPrompt = z
    .string()
    .trim()
    .min(8, 'Describe the object in a few words (at least 8 characters).')
    .max(MAKE_AI_MAX_INPUT_CHARS, `Keep the description under ${MAKE_AI_MAX_INPUT_CHARS} characters.`);

export const MakeIt3dRequest = z.object({ prompt: MakeIt3dPrompt });
export type MakeIt3dRequest = z.infer<typeof MakeIt3dRequest>;

export const MakeIt3dAvailability = z.object({ available: z.boolean(), reason: z.string().nullable() });
export type MakeIt3dAvailability = z.infer<typeof MakeIt3dAvailability>;

export const CreateMakeIt3dBuildResponse = z.object({ buildId: z.string(), displayId: z.string(), url: z.string() });
export type CreateMakeIt3dBuildResponse = z.infer<typeof CreateMakeIt3dBuildResponse>;

export const MakeIt3dArtifactView = z.object({
    kind: z.enum(['STEP', 'GLB', 'STL']),
    filename: z.string(),
    bytes: z.number().int().nonnegative(),
    sha256: z.string(),
    url: z.string(),
    expiresAt: z.string(),
});
export type MakeIt3dArtifactView = z.infer<typeof MakeIt3dArtifactView>;

/** The text-to-CAD record on the build's main part, with fresh signed URLs. */
export const MakeIt3dRecordView = z.object({
    /** The design version this geometry was generated in (a DRAFT until the buyer approves it). */
    version: z.number().int().positive(),
    prompt: z.string(),
    engine: z.object({ name: z.literal('cadgen'), version: z.string() }),
    scriptSha256: z.string(),
    geometry: TextToCadGeometry,
    /** Thinnest wall measured on the STL (mm); null when it could not be measured. */
    minWallMm: z.number().nullable(),
    warnings: z.array(z.string()),
    attempts: z.number().int().positive(),
    artifacts: z.array(MakeIt3dArtifactView),
    generatedAt: z.string(),
});
export type MakeIt3dRecordView = z.infer<typeof MakeIt3dRecordView>;

export const MakeIt3dStatus = z.object({
    available: z.boolean(),
    reason: z.string().nullable(),
    record: MakeIt3dRecordView.nullable(),
    /** The build's latest design version and whether the buyer approved it. */
    latestVersion: z.number().int().positive(),
    latestApproved: z.boolean(),
    /** The latest version carries the text-to-CAD geometry and is approved: it can be quoted. */
    quotable: z.boolean(),
    quoteId: z.string().nullable(),
    printMaterials: z.array(PrintMaterialOption),
});
export type MakeIt3dStatus = z.infer<typeof MakeIt3dStatus>;

/** What the buyer sees when a build fails, by code (plain words, no internals). */
export const MAKE_IT_3D_FAILURE_COPY: Record<z.infer<typeof TextToCadErrorCode> | 'NETWORK', string> = {
    GATE_REJECTED: "Make AI couldn't build that safely. Try describing it another way.",
    BUILD_FAILED: "Make AI couldn't turn that into a solid shape. Try a simpler description or give the main sizes.",
    TIMEOUT: 'Building the 3D model took too long. Try a simpler shape.',
    TOO_LARGE: 'That model came out too detailed to handle. Try a simpler shape.',
    UNAVAILABLE: '3D model building is not available right now. Try again later.',
    NETWORK: 'The 3D model service could not be reached. Try again in a minute.',
};

export const MakeIt3dResponse = z.discriminatedUnion('status', [
    z.object({ status: z.literal('generated'), version: z.number().int().positive(), record: MakeIt3dRecordView }),
    z.object({ status: z.literal('unavailable'), reason: z.string() }),
    z.object({
        status: z.literal('failed'),
        code: z.union([TextToCadErrorCode, z.literal('NETWORK')]),
        message: z.string(),
        /** The worker's plain reason for the last attempt (for BUILD_FAILED), safe to show. */
        detail: z.string().nullable(),
        attempts: z.number().int().nonnegative(),
    }),
]);
export type MakeIt3dResponse = z.infer<typeof MakeIt3dResponse>;

export const MakeIt3dQuoteRequest = z.object({
    printMaterialSlug: z.string().min(1).max(60),
    quantity: z.number().int().min(1).max(100).default(1),
});
export type MakeIt3dQuoteRequest = z.infer<typeof MakeIt3dQuoteRequest>;
