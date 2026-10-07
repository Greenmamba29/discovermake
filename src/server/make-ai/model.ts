/**
 * Make AI model + availability. Config comes only from env (src/server/env.ts):
 *   MAKE_AI_ENABLED               route flag (404 unless "true")
 *   GOOGLE_GENERATIVE_AI_API_KEY  Google AI Studio key (503 when unset)
 *   MAKE_AI_MODEL                 Gemini model id (default in env.ts)
 */
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';
import { env } from '../env';
import { ApiError } from '../http';

export function isMakeAiEnabled(): boolean {
    return env().MAKE_AI_ENABLED;
}

/** 404 unless MAKE_AI_ENABLED=true (the feature does not exist when off); 503 without an API key. */
export function assertMakeAiAvailable(): void {
    if (!isMakeAiEnabled()) throw new ApiError('NOT_FOUND', 'Not found', 404);
    if (!env().GOOGLE_GENERATIVE_AI_API_KEY) throw new ApiError('INTERNAL', 'Make AI is not configured', 503);
}

/** The env-configured Gemini model. The key is passed explicitly, never read from anywhere else. */
export function getMakeAiModel(): LanguageModel {
    const { GOOGLE_GENERATIVE_AI_API_KEY: apiKey, MAKE_AI_MODEL: modelId } = env();
    if (!apiKey) throw new ApiError('INTERNAL', 'Make AI is not configured', 503);
    return createGoogleGenerativeAI({ apiKey })(modelId);
}
