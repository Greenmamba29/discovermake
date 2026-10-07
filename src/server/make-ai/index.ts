/**
 * Make AI (spec §7.5, workflow 01 seed): "What do you want to make?" -> CreationIntent.
 *
 *   assertMakeAiAvailable()   404 unless MAKE_AI_ENABLED=true, 503 without GOOGLE_GENERATIVE_AI_API_KEY
 *   createIntent(text)        Gemini structured output, zod-validated + deterministic guards
 *   runIntake(text)           createIntent + `make_ai.intent_created` event
 *
 * Output is an AI estimate, never a quote: binding prices only come from the DXF quote engine.
 */
export { assertMakeAiAvailable, getMakeAiModel, isMakeAiEnabled } from './model';
export { createIntent, normalizeIntent, MakeAiOutputError, MakeAiUnavailableError, type CreateIntentOptions, type CreateIntentResult } from './intent';
export { runIntake } from './intake';
export { clientIp, FixedWindowRateLimiter, MakeAiRateLimiter, makeAiRateLimiter, MAKE_AI_GLOBAL_RATE_LIMIT, MAKE_AI_RATE_LIMIT, type RateLimitDecision } from './rate-limit';
export { MAKE_AI_PROMPT_VERSION, MAKE_AI_SYSTEM_PROMPT } from './prompt';
