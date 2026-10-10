/**
 * Make AI (spec §7.5, workflow 01 seed): "What do you want to make?" -> CreationIntent.
 *
 *   assertMakeAiAvailable()   404 unless MAKE_AI_ENABLED=true, 503 without GOOGLE_GENERATIVE_AI_API_KEY
 *   createIntent(text)        Gemini structured output, zod-validated + deterministic guards
 *   runIntake(text)           createIntent + persisted `make_intents` row + `make_ai.intent_created` event
 *   createBuildFromIntent(id) "Continue to Build": intent -> Build + version 1 Build Graph (idempotent)
 *   recommendMaterials(...)   Materials Engineer (spec §15), structured output constrained to the catalog
 *
 * Output is an AI estimate, never a quote: binding prices only come from the DXF quote engine.
 */
export { assertMakeAiAvailable, getMakeAiModel, isMakeAiEnabled } from './model';
export { createIntent, normalizeIntent, MakeAiOutputError, MakeAiUnavailableError, type CreateIntentOptions, type CreateIntentResult } from './intent';
export { runIntake } from './intake';
export { createBuildFromIntent, isRefusedIntent, type CreateBuildFromIntentResult } from './builds';
export {
    buildMaterialsPrompt,
    COST_EFFECTS,
    LEAD_TIME_EFFECTS,
    materialRecommendationSchema,
    MATERIALS_ENGINEER_PROMPT_VERSION,
    MATERIALS_ENGINEER_SYSTEM_PROMPT,
    NEEDS_SOURCING,
    normalizeRecommendation,
    recommendMaterials,
    runMaterialsEngineer,
    type MaterialRecommendation,
    type MaterialsEngineerOptions,
} from './materials';
export { clientIp, FixedWindowRateLimiter, MakeAiRateLimiter, makeAiRateLimiter, MAKE_AI_GLOBAL_RATE_LIMIT, MAKE_AI_RATE_LIMIT, type RateLimitDecision } from './rate-limit';
export { MAKE_AI_PROMPT_VERSION, MAKE_AI_SYSTEM_PROMPT } from './prompt';
