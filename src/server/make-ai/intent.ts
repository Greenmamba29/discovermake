/**
 * createIntent(text): buyer description -> schema-validated CreationIntent.
 *
 * Uses the AI SDK v7 structured-output API: `generateText({ output: Output.object({ schema }) })`
 * (`generateObject` is deprecated in v7). The SDK validates the model's JSON against the zod
 * `CreationIntent` schema and throws `NoObjectGeneratedError` when it does not match; we then
 * re-parse and apply deterministic guards (`normalizeIntent`) that do not trust the model:
 *   - dimensions the buyer did not state are never presented as requirements;
 *   - a missing overall size always shows up as an unknown;
 *   - regulated requests carry a refusal note and no manufacturing guidance.
 */
import { generateText, NoObjectGeneratedError, NoOutputGeneratedError, Output, type LanguageModel } from 'ai';
import { CreationIntent, MakeAiIntakeRequest, type IntentUnknown } from '../../contracts/make-ai';
import { ApiError } from '../http';
import { getMakeAiModel } from './model';
import { buildIntakePrompt, MAKE_AI_SYSTEM_PROMPT } from './prompt';

/** Upper bound on generated tokens: a full CreationIntent is ~1.5k tokens. */
const MAX_OUTPUT_TOKENS = 4096;
const TIMEOUT_MS = 30_000;

export type CreateIntentOptions = {
    /** Override the model (tests). Defaults to the env-configured Gemini model. */
    model?: LanguageModel;
    abortSignal?: AbortSignal;
};

export type CreateIntentResult = { intent: CreationIntent; modelId: string };

/** The model answered, but not with a valid CreationIntent. */
export class MakeAiOutputError extends ApiError {
    constructor(cause?: unknown) {
        super('INTERNAL', 'Make AI could not turn that into a plan. Try describing it differently.', 502, undefined);
        this.name = 'MakeAiOutputError';
        if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
    }
}

/** The model provider failed (network, quota, auth). */
export class MakeAiUnavailableError extends ApiError {
    constructor(cause?: unknown) {
        super('INTERNAL', 'Make AI is unavailable right now. Try again in a moment.', 502, undefined);
        this.name = 'MakeAiUnavailableError';
        if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
    }
}

/**
 * Turn a buyer description (<= MAKE_AI_MAX_INPUT_CHARS) into a CreationIntent.
 * @throws ApiError VALIDATION_FAILED for empty/oversized text, MakeAiOutputError, MakeAiUnavailableError.
 */
export async function createIntent(text: string, opts: CreateIntentOptions = {}): Promise<CreateIntentResult> {
    const parsed = MakeAiIntakeRequest.safeParse({ text });
    if (!parsed.success) {
        throw new ApiError('VALIDATION_FAILED', parsed.error.issues[0]?.message ?? 'Invalid description', 400, parsed.error.flatten());
    }
    const model = opts.model ?? getMakeAiModel();
    const modelId = typeof model === 'string' ? model : model.modelId;

    let raw: unknown;
    try {
        const result = await generateText({
            model,
            instructions: MAKE_AI_SYSTEM_PROMPT,
            prompt: buildIntakePrompt(parsed.data.text),
            output: Output.object({
                schema: CreationIntent,
                name: 'CreationIntent',
                description: 'Structured intake of a physical product request for DiscoverMake.',
            }),
            temperature: 0.2,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            maxRetries: 1,
            timeout: TIMEOUT_MS,
            abortSignal: opts.abortSignal,
        });
        raw = result.output;
    } catch (err) {
        if (NoObjectGeneratedError.isInstance(err) || NoOutputGeneratedError.isInstance(err)) throw new MakeAiOutputError(err);
        if (err instanceof Error && err.name === 'AbortError') throw err;
        console.error('[make-ai] model call failed', err instanceof Error ? err.message : err);
        throw new MakeAiUnavailableError(err);
    }

    // Defence in depth: never hand unvalidated model output to the UI.
    const checked = CreationIntent.safeParse(raw);
    if (!checked.success) throw new MakeAiOutputError(checked.error);
    return { intent: normalizeIntent(checked.data), modelId };
}

const DIMENSION_WORDS = /\b(dimension|size|sized|width|wide|height|tall|length|long|depth|deep|thick|thickness|diameter|radius|gauge|ga|mm|cm|inch|inches|footprint|clearance|fit)\b/i;
const NUMBER = /\d/;

/**
 * Deterministic guards applied to every model answer (pure; exported for tests).
 * Never invents anything: it only moves, blanks or adds questions.
 */
export function normalizeIntent(input: CreationIntent): CreationIntent {
    const intent: CreationIntent = structuredClone(input);
    intent.refusal_note = blankToUndefined(intent.refusal_note);
    intent.unknowns = intent.unknowns.map((u) => ({ ...u, suggested_default: blankToUndefined(u.suggested_default) }));

    if (intent.risk_class === 'regulated') {
        // Out of scope: keep the classification, drop anything that reads like manufacturing guidance.
        intent.refusal_note ??= 'DiscoverMake does not make regulated items like this one, so we cannot plan or quote it.';
        intent.requirements = [];
        intent.unknowns = [];
        intent.materials_suggested = [];
        intent.processes_suggested = [];
        intent.constraints = [];
        intent.required_specialists = [];
        return CreationIntent.parse(intent);
    }

    // A dimension requirement must come from the buyer and carry a number; anything else
    // becomes a question instead of a guessed spec.
    const moved: IntentUnknown[] = [];
    intent.requirements = intent.requirements.filter((r) => {
        if (r.category !== 'dimension') return true;
        if (r.source === 'user' && NUMBER.test(r.text)) return true;
        moved.push({
            question: `Confirm the size: ${r.text}`.slice(0, 300),
            why_it_matters: 'Parts are cut to exact dimensions, so we need the real measurement rather than an estimate.',
        });
        return false;
    });
    const critical: IntentUnknown[] = [];
    const hasUserDimension = intent.requirements.some((r) => r.category === 'dimension');
    const asksDimension = [...moved, ...intent.unknowns].some((u) => DIMENSION_WORDS.test(u.question));
    if (!hasUserDimension && !asksDimension) {
        critical.push({
            question: 'What are the overall dimensions (length × width × height) and material thickness?',
            why_it_matters: 'Every cut, bend and price depends on real measurements; we never guess them.',
        });
    }
    // Dimension questions first so the 12-item cap can never drop them.
    intent.unknowns = [...critical, ...moved, ...intent.unknowns].slice(0, 12);
    // Re-number requirement ids so the list reads R1..Rn after filtering.
    intent.requirements = intent.requirements.map((r, i) => ({ ...r, id: `R${i + 1}` }));
    return CreationIntent.parse(intent);
}

function blankToUndefined(v: string | undefined): string | undefined {
    return v && v.trim() ? v.trim() : undefined;
}
