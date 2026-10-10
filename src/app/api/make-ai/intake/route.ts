/**
 * POST /api/make-ai/intake  MakeAiIntakeRequest -> MakeAiIntakeResponse (200), public.
 *
 * Flag-gated Make AI intake (spec §7.5): turns "What do you want to make?" into a
 * CreationIntent. Order of checks:
 *   404  unless MAKE_AI_ENABLED=true
 *   503  when GOOGLE_GENERATIVE_AI_API_KEY is unset
 *   429  over 10 requests / minute / IP (in-memory placeholder, Retry-After header)
 *   413  body over MAX_JSON_BODY_BYTES; 400 empty or > 2,000 character description
 *   502  model failed or answered with something that is not a valid CreationIntent
 * Emits `make_ai.intent_created`. The response is an AI estimate, not a quote.
 */
import { MakeAiIntakeRequest } from '@/contracts/make-ai';
import { errorResponse, json, MAX_JSON_BODY_BYTES, parseJson, route } from '@/server/http';
import { assertMakeAiAvailable, clientIp, makeAiRateLimiter, runIntake } from '@/server/make-ai';
import { assertNotKidMode } from '@/server/kids/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const POST = route(async (request) => {
    await assertNotKidMode(request);
    assertMakeAiAvailable();

    const decision = await makeAiRateLimiter.hit(clientIp(request));
    if (!decision.allowed) {
        const res = errorResponse('RATE_LIMITED', 'Too many Make AI requests. Wait a minute and try again.', 429);
        res.headers.set('retry-after', String(decision.retryAfterSeconds));
        return res;
    }

    const body = await parseJson(request, MakeAiIntakeRequest, MAX_JSON_BODY_BYTES);
    const result = await runIntake(body.text, { abortSignal: request.signal });
    return json(result);
});
