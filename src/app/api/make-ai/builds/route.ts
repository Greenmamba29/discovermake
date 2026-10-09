/**
 * POST /api/make-ai/builds  { intentId } -> { buildId, displayId, created } (201 new, 200 existing), public.
 *
 * "Continue to Build" (workflow 01): turns a persisted Make AI intent into a Build with a
 * version 1 Build Graph. Idempotent per intent. Order of checks:
 *   404  unless MAKE_AI_ENABLED=true (no API key needed: the Materials Engineer is skipped without one)
 *   429  shares the Make AI per-IP budget (it may call the model for the Materials Engineer)
 *   400  malformed body; 404 unknown intent; 403 refused (regulated) intent
 * Emits `build.created`, `design.version_created`, `requirements.generated` and
 * `material.recommended` (when the Materials Engineer answered).
 */
import { z } from 'zod';
import { limitWrite } from '@/server/build-graph';
import { ApiError, json, MAX_JSON_BODY_BYTES, parseJson, route } from '@/server/http';
import { createBuildFromIntent, isMakeAiEnabled, makeAiRateLimiter } from '@/server/make-ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** `make_intents.id`: a UUIDv7 for intake rows (see src/server/make-ai/intake.ts). */
const MakeAiBuildRequest = z.object({ intentId: z.string().trim().min(1).max(64) });

export const POST = route(async (request) => {
    if (!isMakeAiEnabled()) throw new ApiError('NOT_FOUND', 'Not found', 404);
    const limited = await limitWrite(request, makeAiRateLimiter, 'Too many Make AI requests. Wait a minute and try again.');
    if (limited) return limited;
    const body = await parseJson(request, MakeAiBuildRequest, MAX_JSON_BODY_BYTES);
    const result = await createBuildFromIntent(body.intentId, { abortSignal: request.signal });
    return json(result, { status: result.created ? 201 : 200 });
});
